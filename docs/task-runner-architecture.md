# Tasks et exécutions Codex — V1

## Situation actuelle

AgentTasker possède une interface locale Next.js, des projets enregistrés dans
SQLite et une configuration versionnée `.tasker/`. La V1 relie maintenant ces
éléments à une véritable exécution Codex App Server, dans un worktree isolé.

## Problème précis

Une définition de tâche doit rester portable, tandis que sa planification effective,
ses processus, ses événements et ses résultats doivent survivre localement aux
requêtes et aux redémarrages. Le checkout de travail de l’utilisateur ne peut pas
servir de workspace d’exécution.

## Situation visée

Une chaîne unique et déterministe : définition → Run QUEUED → Worker → fetch de la
base distante → worktree → Codex → validations → commit → historique. Pour une
Task, le Run exécute un travail autonome. Pour une Sequence, le même Run exécute
ses SequenceSteps dans l’ordre et dans un worktree partagé; voir
[l’architecture des Sequences](sequence-architecture.md). Le serveur reste
responsable de chaque transition ; le navigateur observe et contrôle.

## Configuration et état

- `.tasker/tasks/<id>/task.toml` : version 1, ID stable, nom, activation,
  `expect_changes`, planification.
- `.tasker/tasks/<id>/instructions.md` : instructions propres à la tâche.
- `.tasker/instructions.md` : instructions de projet.
- `.tasker/LESSONS.md` : mémoire opérationnelle versionnée du projet; elle
  rassemble seulement des règles durables tirées d'erreurs comprises.
- `.tasker/agents/main.toml` : configuration native de Codex.
- `.tasker/project.toml` : `[git].base_branch`, `[git].remote` (défaut `origin`),
  `push`, `create_pull_request`, `pull_request_draft` et les réglages `[execution]`
  de préparation, validation et délais. Les anciens projets restent en publication
  désactivée tant que l’utilisateur ne l’active pas explicitement dans Settings.
- SQLite : `runs`, `run_events`, `sequence_step_runs`, `scheduler_state`, `runner_lock`. Les migrations
  Drizzle sont appliquées au démarrage ; leur échec bloque l’ouverture de la base.

La définition et les instructions ne sont pas recopiées en base. Un Run conserve
le nom historique, les réglages agent et d’exécution résolus, les coordonnées Git,
les timestamps, le PID du sous-processus actif, le code de sortie, le résultat final,
le diff, l’horodatage du push, l’URL de PR et l’erreur. Les instructions et réglages
sont lus au démarrage effectif du worker, pas au clic de mise en file. Les éditer
pendant l’attente affecte donc les Runs encore en file. Les réglages déjà chargés
restent stables pour le Run courant. L’historique contient naturellement les sorties
de l’agent, qui peuvent citer du contexte ; ce n’est pas une seconde définition.

Voir [le format des tâches](task-configuration.md) et
[la séparation de persistance](tasker-persistence-architecture.md).

## Scheduler, queue et verrou

`src/instrumentation.ts` démarre le service dans le runtime Node du serveur, jamais
pendant le build. Aucun cron, service externe ou ordonnanceur OS n’est créé.
Le service est conservé dans `globalThis` lors du rechargement des modules.

Le scheduler vérifie toutes les deux secondes les tâches actives. `manual` ne
produit aucune occurrence ; `once` utilise un instant ISO ; `hourly` démarre au
début de chaque heure locale ; `daily` et `weekly` utilisent une heure locale et
un fuseau IANA. L’interface n’expose pas de cron.

À la première découverte ou après changement de planning/réactivation, une
récurrence commence à la prochaine occurrence. Une tâche `once` déjà échue est
rattrapée. Au redémarrage, une récurrence connue produit au maximum l’occurrence
manquée la plus récente, jamais une série historique. Une tâche ayant déjà un Run
QUEUED ne reçoit pas une autre occurrence planifiée en attente. Le curseur avance
alors : ces occurrences sont regroupées, sans backlog. Un Run manuel reste possible
même si la planification est désactivée.

Les heures locales inexistantes au passage à l’heure d’été sont sautées. Une heure
répétée en automne est exécutée une seule fois, à sa première occurrence. Les
calculs ne dépendent pas du fuseau de la machine. `starts_at` permet une borne de
début facultative pour les récurrences.

Insertion du Run, événement initial et curseur scheduler partagent une transaction
SQLite immédiate. Une contrainte unique `(project_id, task_id, scheduled_at)`
empêche les doublons d’occurrence. La queue FIFO est constituée des Runs `QUEUED`.
La queue contient les Runs autonomes de Tasks et les Runs complets de Sequences.
`runs.kind` garde leurs historiques séparés dans l’interface. La prise d’un Run est
atomique et refuse un second Run actif. Une Sequence conserve le worker jusqu’à la
fin de toutes ses étapes, de sorte qu’aucun autre Run ne s’intercale entre elles.
La concurrence V1
est **un seul Codex pour toute l’installation**. Le scheduler continue de travailler
pendant cette exécution.

`runner_lock` conserve un propriétaire PID et un jeton. Un autre serveur utilisant
la même base ne démarre pas un second worker. Un verrou dont le propriétaire existe
est respecté ; un propriétaire disparu permet une reprise. Deux installations
utilisant des bases distinctes restent indépendantes.

### Sequences dans la queue

Une troisième stratégie de publication, `independent_after_each_step`, est réservée
aux étapes réellement indépendantes. Elle exige `push` et `create_pull_request` :
chaque commit est publié sur une branche basée sur la branche de base du Project,
puis le worktree isolé revient à cette base. Avec `failure_policy = "continue"`,
une étape échouée est enregistrée et le worker tente la suivante; il s'arrête après
`max_consecutive_failures` (2 par défaut). Les modifications non validées de
l’étape échouée sont retirées seulement de ce worktree isolé.

Un Run de Sequence prépare un seul worktree et une seule branche. Chaque étape
réussie est validée puis commitée avant le démarrage de la suivante; le commit
devient sa nouvelle base. Les étapes suivantes voient ainsi les fichiers et
l’historique produits auparavant. Un échec arrête la chaîne, marque les étapes
restantes `SKIPPED` et préserve les artefacts Git. La Sequence choisit entre une PR
finale et des branches/PR empilées publiées après chaque étape ayant un commit; dans
ce second mode, une publication réussie fait partie du succès de l'étape. Les
Sequences sont manuelles dans la version actuelle et ne sont pas évaluées par le scheduler.

## Git et worktrees

Le backend résout le dépôt depuis le Project et lit la branche de base dans le
TOML. Il vérifie le remote configuré, fetch explicitement cette branche vers
`refs/remotes/<remote>/<base>`, puis épingle son SHA exact. Les refspecs locaux ne
peuvent pas détourner ce fetch vers une branche locale. Aucun checkout, pull ou
reset du dépôt principal n’a lieu.

Chaque Run reçoit une branche `tasker/run-<uuid>-<task-id>` et un dossier
`<data>/worktrees/run-<uuid>-<task-id>`. Les coordonnées sont enregistrées avant
la création du worktree. La racine runtime doit être extérieure aux checkouts du
dépôt. Les identifiants, chemins réels, branche et dépôt commun sont revérifiés.

Par défaut `<data>` est le dossier local de l’application : `%LOCALAPPDATA%/AgentTasker`
sous Windows, `~/Library/Application Support/AgentTasker` sous macOS,
`$XDG_DATA_HOME/AgentTasker` ou `~/.local/share/AgentTasker` sous Linux.
`AGENTTASKER_DATA_DIR` permet une configuration machine explicite.
Le chemin de la base reste contrôlé par `DATABASE_PATH`, avec le défaut historique
`./agenttasker.db`. Les chemins runtime ne sont jamais écrits dans `.tasker/`.

## Codex et prompt

Le prompt combine explicitement les instructions de projet, celles de la tâche et
les contraintes d’isolation/finalisation. Il demande aussi à Codex de lire
directement `.tasker/LESSONS.md` depuis le worktree lorsque ce fichier existe : son
contenu n'est pas injecté dans le prompt. Codex peut y inscrire une règle courte,
vérifiée et réutilisable après une erreur ou une correction pertinente, notamment
pour les outils de terminal, tests, builds ou validations. Il doit d'abord
distinguer une cause durable d'un échec de quoting, de sandbox, de fichier absent,
de runtime local ou de commande gérée par le runner. Il passe comme entrée structurée au
protocole JSON-RPC de `codex app-server`; il n’est jamais interpolé dans une commande
shell ni enregistré comme définition dans SQLite. Le processus est lancé avec
`shell: false` et le worktree comme cwd. Les notifications App Server sont adaptées
au contrat d’événements historique du Run Inspector afin de conserver la lecture
des anciens Runs et les renderers existants.

Les paramètres `model`, reasoning, summary, verbosity, sandbox, approval, réseau et
options `agents` exposées par Agents sont fournis comme réglages natifs. Aucun modèle
n’est codé en dur dans le runner. L’authentification est celle de l’installation
Codex de l’utilisateur ; aucun secret n’est copié. Aucun contournement de sandbox
ou d’approbation n’est ajouté. Une demande d’approbation non résolue par le mode
non interactif échoue ou atteint le timeout ; cette V1 ne fournit pas de dialogue
d’approbation interactif. Les fichiers de sous-agents personnalisés ne sont pas
installés dans le worktree par cette V1.

Un schéma JSON externe au worktree exige `status: SUCCESS|FAILURE`, `summary` et
`blocking_error`. Le dernier message doit être valide ; `FAILURE` provoque l’échec
même avec un code de sortie zéro. La référence officielle utilisée est le
[mode non interactif Codex](https://learn.chatgpt.com/docs/non-interactive-mode).

## Cycle, événements et UI

États : `QUEUED → PREPARING → RUNNING → VALIDATING → SUCCESS`, avec sorties possibles
`FAILED` ou `CANCELLED`. Les opérations longues appartiennent au worker, pas aux API.
`POST .../tasks/<id>/runs` renvoie immédiatement le Run et HTTP 202.

stdout brut, stderr, sorties des commandes gérées, JSON Codex, événements de statut et résultat sont persistés
dans SQLite. Le Sheet consulte `GET .../runs/<id>?after=<event-id>` toutes les 1,5 s
et draine les pages de 500 événements, même après la fin. La liste consulte toutes
les trois secondes. Ce polling reprend simplement après déconnexion sans maintenir
de flux HTTP ; les logs demeurent consultables après fermeture du navigateur.
L’historique est paginé par 200 Runs avec un curseur `before`.

Le serveur émet aussi des diagnostics structurés préfixés
`[AgentTasker][runner:debug]`. Ils couvrent l’initialisation du runner, la mise en
file, le verrou interprocessus, la réclamation, la fin d’exécution et les barrières
de récupération. Les états répétitifs sont dédupliqués afin qu’une file bloquée
nomme le Run responsable sans écrire une nouvelle ligne à chaque tick.

Le Sheet agit comme un Run Inspector. Il normalise les événements JSONL en une
timeline humaine, regroupe les cycles `item.started`/`updated`/`completed`, puis
utilise un renderer spécialisé pour les messages, reasoning, commandes, fichiers,
outils, recherches, plans, sous-agents et erreurs. Les événements bruts restent
disponibles dans une section technique chargée à la demande. Voir
[le contrat des événements Codex](codex-run-events.md).

Un Run `QUEUED` affiche sa position dans la file et l’état global du worker. Si une
ancienne terminaison non vérifiée bloque le pipeline, la vue Tasks et le Run en
attente identifient le Run responsable et proposent la confirmation locale qui
relance la file, même lorsque le bloqueur appartient à un autre Project. Sans Run
en attente, le même état est présenté comme **récupération requise avant le prochain
Run**, et non comme un pipeline actuellement bloqué. Un Run en file peut être retiré
directement. Un Run terminal sans PID connu expose directement deux choix :
**Conserver et débloquer**, qui certifie seulement la terminaison, ou **Supprimer le
Run bloquant**, qui combine cette certification et la suppression. Le second choix
avertit que le travail non intégré sera perdu; le backend supprime explicitement le
worktree et la branche avant d’effacer l’historique. Une erreur de nettoyage conserve
le Run visible et récupérable. Aucun de ces choix ne crée ou ne relance une Task.

Un Run `FAILED` expose l’action **Réexécuter** dans la ligne de Task, son entrée
d’historique et le Run Inspector. Cette action crée un nouveau Run manuel dans la
queue; elle ne modifie ni ne supprime le Run échoué. Le worker repart de la base
distante actuelle et relit la définition de Task, les Instructions, l’agent et les
Settings d’exécution actuels. Le worktree échoué reste donc disponible pour audit,
mais n’est pas repris comme workspace du nouveau Run. Une Task supprimée ne peut
pas être réexécutée depuis son historique conservé.

Les Sequences disposent en complément d’une reprise volontaire et strictement
bornée : après un résultat Codex structuré positif suivi d’une validation échouée,
**Reprendre** crée un nouveau Run lié à la source et réutilise son worktree intact.
Le worker ne relance pas Codex pour l’étape déjà terminée; il rejoue les validations,
commit l’étape si elles passent, puis continue la Sequence. Cette voie exige une
terminaison vérifiée, des coordonnées Git exactes, un événement de validation échoué
et une définition d’étapes identique; elle refuse sinon. Les commandes de validation
actuelles sont utilisées, ce qui permet notamment de corriger un runtime local sans
consommer à nouveau les tokens de l’étape achevée.

Le header affiche de façon compacte le modèle, le reasoning, le sandbox et le
réglage réseau `workspace-write` depuis le snapshot JSON `resolvedConfig` du Run.
Les autres valeurs sont dans les détails repliables. Une valeur absente ou
invalide reste explicitement non renseignée. Lorsque
`terminationVerified` vaut `false`, un avertissement de file bloquée et de
récupération locale reste visible ; le polling continue jusqu’à la levée du blocage.

Les API utilisent exclusivement `projectId`, `taskId`, `runId` pour les chemins
d’exécution. Les requêtes de mutation Tasks/Runs sont limitées aux origines locales.
Le CRUD refuse traversées de chemins, symlinks et fichiers inattendus lors d’une
suppression. La suppression d’une tâche avec Runs actifs est refusée. Supprimer
une tâche terminée conserve ses Runs ; supprimer un Project sans Runs actifs
supprime aussi son historique via les relations SQLite en cascade. Les mutations
de Task, de Run et de récupération retournent le nouvel état global de la queue :
l’interface le réconcilie immédiatement, tandis que le polling toutes les trois
secondes reste un filet de sécurité pour les changements produits par le worker.

## Validation et finalisation

Les Settings du Project éditent cette table versionnée :

```toml
[execution]
default_timeout_minutes = 180
package_manager = "npm"
install_dependencies = false
install_timeout_minutes = 15
validation_scripts = []
validation_timeout_minutes = 20
```

`package_manager` accepte `npm`, `pnpm`, `yarn` ou `bun`. L’installation est une
action explicite et désactivée par défaut, car elle peut accéder au réseau et lancer
les scripts de cycle de vie du dépôt. Lorsqu’elle est activée, le worker lance dans
le worktree, avant Codex, `npm ci`, `pnpm install --frozen-lockfile`,
`yarn install --immutable` ou `bun install --frozen-lockfile`. AgentTasker exige
Node.js 24.x : le démarrage par les scripts npm et le préflight d’un Run refusent
explicitement tout autre runtime. Node 24 est injecté dans le `PATH` du
sous-processus depuis le runtime qui exécute AgentTasker; son chemin absolu reste
une donnée de machine et n’est jamais écrit dans `.tasker/`.

Les commandes de préparation et de validation disposent d’un environnement distinct
du serveur Next.js d’AgentTasker : `NODE_ENV`, `NEXT_RUNTIME`, `TURBOPACK` et les
marqueurs internes `__NEXT_*` hérités sont retirés de la copie passée au sous-processus.
Chaque outil choisit ainsi son mode (`next build` choisit `production`, un outil de
test peut choisir `test`), quel que soit le mode de lancement d’AgentTasker. Aucun
mode n’est imposé selon le nom du script. L’environnement du serveur reste inchangé;
les variables publiques du projet, les credentials existants et `NODE_OPTIONS`
sont conservés. Aucun fichier de secrets n’est copié dans le worktree. Les scripts
peuvent définir explicitement leur propre mode lorsqu’ils en ont besoin.

`validation_scripts` contient uniquement des noms de scripts `package.json`, pas
des commandes shell arbitraires. Le worker exécute chaque entrée en ordre avec
`<package_manager> run <script>` après la sortie positive de Codex et avant le
commit. Un échec, une annulation ou un délai dépassé interrompt la chaîne. stdout,
stderr, début, fin et terminaison sont persistés dans les événements du Run. Les
réglages résolus sont également figés dans le snapshot du Run et visibles dans son
inspecteur. Les futurs overrides par Task ne sont pas encore implémentés.

Les événements `preparation` et `validation` contiennent aussi un rapport structuré
par commande : phase, commande, état, code de sortie, durée et erreur. Le Run Inspector
affiche ces commandes et leurs sorties séparément du résultat Codex, y compris pour
les anciens Runs à événements textuels. `Run.exitCode` est explicitement le code
**Codex** : zéro ne signifie pas que le build ou les autres validations ont réussi.
Une commande sans résultat terminal ne devient jamais un succès par déduction.

### Variables d’environnement locales

Les Settings d’exécution peuvent enregistrer des variables propres à une installation,
par exemple `SERPAPI_API_KEY`. Elles ne sont jamais lues depuis le `.env` du checkout
principal et aucun fichier de secrets n’est copié dans le worktree. Les noms et valeurs
sont validés côté serveur; les variables qui contrôlent AgentTasker, Node, Git, Python
ou les chemins système ne peuvent pas être remplacées.

Les valeurs sont chiffrées localement et injectées uniquement dans l’environnement de
`codex app-server`, de l’installation des dépendances et des validations. Codex applique
ensuite sa politique native `shell_environment_policy` aux commandes de l’agent; un
filtre utilisateur explicite peut donc encore retirer une variable. L’accès à une API
distante exige également que le réseau soit activé dans le sandbox de l’agent. Voir la
[politique d’environnement officielle de Codex](https://learn.chatgpt.com/docs/config-file/config-advanced#shell-environment-policy).

Le snapshot du Run et les événements ne conservent que les noms. Avant toute écriture
de log, résultat, erreur ou description de PR, le worker masque les occurrences directes,
échappées JSON et encodées URL des valeurs. Cette redaction protège les sorties ordinaires;
elle ne peut pas garantir le masquage d’une valeur transformée ou fragmentée par un outil.

### Runtime Python

`python_min_version` est une clé portable optionnelle de `[execution]`. Une valeur
comme `"3.11"` exige cette version ou une version plus récente pour chaque Run ;
l’absence de la clé laisse Python optionnel. Au démarrage effectif, avant le
worktree, AgentTasker diagnostique `py -<version>` et `py -3` sous Windows, puis
`python` et `python3`. Il conserve dans les événements du Run et son snapshot les
commandes tentées, chemins d’interpréteurs et versions détectées, jamais les
valeurs de l’environnement ni les secrets.

L’interpréteur correspondant est résolu localement à chaque Run. Son dossier est
préfixé au `PATH` transmis à Codex, à la préparation et aux validations, et son
chemin est fourni dans `PYTHON`. Ainsi un worktree n’a pas besoin de contenir une
installation Python et le launcher Windows reste utilisable. Les chemins absolus
ne sont jamais écrits dans `.tasker/project.toml`; ils restent des diagnostics
locaux du Run. Les overrides de Python par Task ou SequenceStep ne font pas partie
du schéma V1.

L’interface offre en plus un override local facultatif vers un interpréteur précis.
Ce chemin est validé, résolu avec `realpath` et stocké dans la table SQLite
`project_runtime_preferences`; le mode automatique reste le défaut. Le préflight
des Settings exécute le runtime une première fois sous le worker puis via
`command/exec` dans le sandbox Codex. Un échec distingue donc l’absence de Python
d’un refus ACL/sandbox. Sous Windows, une installation privée sous `AppData` peut
rester inexécutable par le compte restreint malgré le droit de lecture déclaré;
l’interface recommande alors une installation Python système lisible plutôt qu’un
basculement implicite en `danger-full-access`.

Lorsqu’un runtime Python est retenu, App Server reçoit un profil de permissions
éphémère dérivé de `:workspace` ou `:read-only`. Le worktree reste la seule racine
modifiable; `sys.prefix`, `sys.base_prefix` et le répertoire Git commun du worktree
reçoivent seulement un accès en lecture. AgentTasker ne transmet jamais le profil
utilisateur complet, n’utilise pas `--add-dir` pour rendre Python modifiable et ne
bascule pas en `danger-full-access`. Le profil recopie explicitement l’autorisation
réseau résolue du mode `workspace-write`; sans cette entrée, un profil nommé garde
le réseau désactivé même lorsque `sandbox_workspace_write.network_access` vaut
`true`. Le mode `read-only` conserve toujours le réseau désactivé.
`PYTHONDONTWRITEBYTECODE=1` évite les écritures de cache dans l’installation en
lecture seule.

L’incident du 11 septembre 2026 (Run `b87c5b31…62af`) a confirmé ce besoin : Codex
avait créé l’article et sa couverture, puis `npm run build` héritait du mode
développement du serveur et échouait au prérendu avec `useContext`. Le même build
sur le worktree préservé a reproduit l’échec avant le correctif et réussi après
isolation de l’environnement, sans changer le contenu produit ni le statut historique.
Voir [le diagnostic et les vérifications](run-build-environment.md).

Le succès requiert : préparation réussie lorsqu’elle est activée, sortie Codex
zéro, résultat structuré valide et positif, toutes les validations configurées
réussies, absence d’annulation/timeout, intégrité du worktree et de sa branche. Si
`expect_changes = true` (défaut du formulaire), un diff réel est obligatoire.
Pour une tâche d’analyse sans modification, désactiver cette option.

L’agent ne doit pas créer de commits : un HEAD différent de la base provoque
un échec contrôlé et une conservation du travail. Le worker stage les changements
réels, crée `task(<task-id>): run <uuid>`, puis vérifie parent, arbre et propreté.
L’identité Git doit être configurée sur la machine ou dans le dépôt. Un problème
de commit conserve les modifications.

Après un commit réussi, le worker applique la politique `[git]` résolue pour le Run.
Si `push = true`, il pousse la branche UUID du Run avec upstream, puis vérifie que
la référence distante et le commit local sont identiques avec une divergence `0 0`.
Si `create_pull_request = true`, `push` est obligatoire : le worker valide d’abord
que GitHub CLI est installé et authentifié pour l’hôte du remote, recherche une PR
ouverte pour la branche afin de rendre l’opération idempotente, puis appelle
`gh pr create`. `pull_request_draft = true` ajoute le mode brouillon. Aucun secret
GitHub n’est stocké dans `.tasker/` ou SQLite; l’authentification locale existante de
`gh` est utilisée.

Pour une Sequence, `pull_request_strategy = "after_sequence"` publie une seule PR
après toutes les étapes. `after_each_step` publie une branche dédiée après chaque
étape ayant créé un commit et ouvre une PR empilée sur la branche de l'étape
précédente; l'étape suivante ne démarre qu'après ce succès. Une erreur de push, de
vérification distante ou de création de PR fait échouer l’étape et le Run, conserve
le worktree et ses commits, et laisse les PR des étapes antérieures récupérables.
Un push déjà réussi reste tracé même si la création de PR échoue. AgentTasker ne
merge jamais automatiquement. `expect_changes` décide uniquement si un diff est
requis pour réussir; il n’active jamais implicitement une publication distante.

## Annulation, arrêt et récupération

Annuler un Run QUEUED le termine immédiatement. Pour un Run actif, le backend
persiste une demande et le worker l’observe toutes les 500 ms. Le processus reçoit
une tentative d’arrêt, puis un arrêt forcé après cinq secondes si nécessaire.
POSIX utilise un groupe de processus ; Windows conserve les identités PID/date de
création des descendants via Toolhelp, tente `taskkill`, puis vérifie leur arrêt.
L’état terminal est écrit après la fin du processus. Les logs restent disponibles.

Le délai du Run, de 180 minutes par défaut et configurable entre 1 et 1 440 minutes,
suit le même arrêt et produit `FAILED`. Les commandes de préparation et de validation
ont leurs propres délais configurables entre 1 et 120 minutes. L’arrêt normal
du serveur attend le tick actif et la terminaison de son worker avant de libérer
son verrou. Après une mort brutale, les anciens Runs actifs sans processus vivant
sont marqués échoués, en préservant branche, fichiers et événements.

Au redémarrage, lorsqu’un PID du sous-processus interrompu est conservé, le runner
vérifie d’abord que son arbre de processus (Windows) ou son groupe (POSIX) est bien
terminé. Il peut alors certifier la terminaison, marquer le Run interrompu en échec
ou annulé, préserver son worktree et reprendre la queue. Si le processus ou un
descendant est encore présent, la queue reste suspendue : aucun PID hérité n’est tué
aveuglément.

Si la terminaison ne peut pas être vérifiée (`termination_verified = 0`) et qu’un
ancien Run terminal n’a plus d’identité de processus exploitable, le Sheet affiche
une récupération locale explicite. Après avoir vérifié et arrêté les processus
restants, l’utilisateur confirme la reprise ; le backend n’accepte cette action que
pour un Run terminal sans PID enregistré et persiste un événement de récupération.
Le worktree est toujours préservé. Sans cette confirmation, la queue demeure bloquée,
y compris après redémarrage.

Le champ est mis à zéro **avant** le lancement de Codex, puis rétabli uniquement
après vérification de fin, y compris pour une sortie normale. Un crash au milieu
d’une exécution déclenche donc la vérification automatique ci-dessus lorsque le PID
est disponible, ou la confirmation locale lorsque son identité a déjà été perdue.
Supprimer le projet ne permet pas de contourner ce blocage : la suppression est
refusée tant qu’une terminaison reste non vérifiée. Une annulation reçue pendant le
nettoyage est arbitrée transactionnellement avant le statut final.

La suppression explicite d’un Run préservé obéit à la même garde. Elle peut inclure
la confirmation manuelle de terminaison lorsque le Run est terminal et qu’aucun PID
n’est encore enregistré. Elle valide ensuite que le worktree appartient au dépôt,
au répertoire runtime et à la branche exacte dérivée du Run, puis retire le worktree
et la branche avant la ligne SQLite. Elle est volontairement destructive et demande
une confirmation claire dans l’interface. Un PID encore présent interdit cette voie
rapide : la vérification automatique doit d’abord constater l’arrêt réel.

Tout échec ou annulation conserve le worktree. Un succès ne retire le worktree
que si son commit est retenu par la branche, son HEAD est conforme et son contenu
est entièrement propre, y compris fichiers ignorés. Aucun `remove --force` n’est
utilisé. La présence de dépendances ignorées peut donc laisser un worktree de
succès à nettoyer manuellement. Les branches de Run sont toujours conservées.

## Tests et limites V1

`npm test` couvre le CRUD filesystem, les horaires/fuseaux/DST, transactions,
concurrence, événements, redémarrage, parsing des réglages d’exécution, résolution
des commandes de paquets, Git réel avec remote local jetable et arrêt de véritables
arbres de processus de test. Ces tests n’utilisent pas de modèle.
Le lanceur fournit toujours une base et un runtime temporaires avant tout import
backend. Chaque test SQLite initialise aussi sa fixture avant ses imports dynamiques;
les tests d’export de logs suivent cette même règle. Le test du worker complet couvre
installation, sortie Codex simulée, validation réelle par npm, commit et conservation
du travail en cas d’échec, depuis un hôte en mode développement.

Les scripts `prepare-real-run-smoke.mjs`, `start-smoke-server.mjs` et
`real-run-browser-smoke.mjs` permettent un test réel volontaire avec
`gpt-5.6-sol` configuré dans `main.toml`. Le dernier nécessite Playwright et son
navigateur. Les fichiers, base et worktrees sont jetables ; le rapport et les
captures vont dans `.test-artifacts/` ignoré. Le serveur utilise le port 5055 et
un build séparé. Un tel test consomme l’accès Codex de l’utilisateur.

Le 10 septembre 2026, le test navigateur réel a confirmé création/édition/reload/
suppression de tâche, Run QUEUED, worktree sur le dernier commit distant (main local
volontairement en retard), 61 événements live/persistés, création effective du
fichier de test, SUCCESS et commit automatique, sans modifier le checkout principal.
`real-run-cancel-smoke.mjs` a ensuite confirmé l’annulation d’un véritable processus
Codex depuis le Sheet, avec terminaison vérifiée et worktree conservé.
Le redémarrage en production a conservé la Task et les 61 événements du Run réussi.
La validation locale actuelle comprend 97 tests réussis, un test de symlink ignoré
faute de privilèges Windows, ainsi que les contrôles TypeScript et ESLint.
Une seconde exécution réelle réussie a vérifié le contrôle renforcé des descendants
après sortie normale de Codex, avec terminaison vérifiée et nettoyage du worktree.

La validation locale a lieu sous Windows. Les branches POSIX doivent aussi être
testées sur macOS/Linux. Les logs et branches n’ont pas encore de rétention
automatique ; la liste des tâches peut être bloquée par un TOML invalide du projet.
Le service attend un serveur Node local persistant, pas un hébergement serverless.

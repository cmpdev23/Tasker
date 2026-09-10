# Tasks et exécutions Codex — V1

## Situation actuelle

AgentTasker possède une interface locale Next.js, des projets enregistrés dans
SQLite et une configuration versionnée `.tasker/`. La V1 relie maintenant ces
éléments à une véritable exécution `codex exec`, dans un worktree isolé.

## Problème précis

Une définition de tâche doit rester portable, tandis que sa planification effective,
ses processus, ses événements et ses résultats doivent survivre localement aux
requêtes et aux redémarrages. Le checkout de travail de l’utilisateur ne peut pas
servir de workspace d’exécution.

## Situation visée

Une chaîne unique et déterministe : Task → Run QUEUED → Worker → fetch de la base
distante → worktree → Codex → validations → commit → historique. Le serveur reste
responsable de chaque transition ; le navigateur observe et contrôle.

## Configuration et état

- `.tasker/tasks/<id>/task.toml` : version 1, ID stable, nom, activation,
  `expect_changes`, planification.
- `.tasker/tasks/<id>/instructions.md` : instructions propres à la tâche.
- `.tasker/instructions.md` : instructions de projet.
- `.tasker/agents/main.toml` : configuration native de Codex.
- `.tasker/project.toml` : `[git].base_branch`, `[git].remote` optionnel
  (défaut `origin`) et `[execution].default_timeout_minutes` optionnel (défaut 180).
- SQLite : `runs`, `run_events`, `scheduler_state`, `runner_lock`. Les migrations
  Drizzle sont appliquées au démarrage ; leur échec bloque l’ouverture de la base.

La définition et les instructions ne sont pas recopiées en base. Un Run conserve
le nom historique, les réglages agent résolus, les coordonnées Git, les timestamps,
PID, code de sortie, résultat final, diff et erreur. Les instructions et réglages
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
produit aucune occurrence ; `once` utilise un instant ISO ; `daily` et `weekly`
utilisent une heure locale et un fuseau IANA. L’interface n’expose pas de cron.

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
La prise d’un Run est atomique et refuse un second Run actif. La concurrence V1
est **un seul Codex pour toute l’installation**. Le scheduler continue de travailler
pendant cette exécution.

`runner_lock` conserve un propriétaire PID et un jeton. Un autre serveur utilisant
la même base ne démarre pas un second worker. Un verrou dont le propriétaire existe
est respecté ; un propriétaire disparu permet une reprise. Deux installations
utilisant des bases distinctes restent indépendantes.

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
les contraintes d’isolation/finalisation. Il passe sur stdin à `codex exec --json` ;
il n’est jamais interpolé dans une commande shell ni enregistré comme définition
dans SQLite. Le processus est lancé avec `shell: false` et le worktree comme cwd.

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

stdout brut, stderr, JSON Codex, événements de statut et résultat sont persistés
dans SQLite. Le Sheet consulte `GET .../runs/<id>?after=<event-id>` toutes les 1,5 s
et draine les pages de 500 événements, même après la fin. La liste consulte toutes
les trois secondes. Ce polling reprend simplement après déconnexion sans maintenir
de flux HTTP ; les logs demeurent consultables après fermeture du navigateur.
L’historique est paginé par 200 Runs avec un curseur `before`.

Le Sheet affiche le modèle, le sandbox, la politique d’approbation et le réglage
réseau `workspace-write` depuis le snapshot JSON `resolvedConfig` du Run. Une
valeur absente ou invalide reste explicitement non renseignée. Lorsque
`terminationVerified` vaut `false`, un avertissement de file bloquée et de
récupération locale reste visible ; le polling continue jusqu’à la levée du blocage.

Les API utilisent exclusivement `projectId`, `taskId`, `runId` pour les chemins
d’exécution. Les requêtes de mutation Tasks/Runs sont limitées aux origines locales.
Le CRUD refuse traversées de chemins, symlinks et fichiers inattendus lors d’une
suppression. La suppression d’une tâche avec Runs actifs est refusée. Supprimer
une tâche terminée conserve ses Runs ; supprimer un Project sans Runs actifs
supprime aussi son historique via les relations SQLite en cascade.

## Validation et finalisation

Le succès requiert : sortie Codex zéro, résultat structuré valide et positif,
absence d’annulation/timeout, intégrité du worktree et de sa branche. Si
`expect_changes = true` (défaut du formulaire), un diff réel est obligatoire.
Pour une tâche d’analyse sans modification, désactiver cette option.

L’agent ne doit pas créer de commits : un HEAD différent de la base provoque
un échec contrôlé et une conservation du travail. Le worker stage les changements
réels, crée `task(<task-id>): run <uuid>`, puis vérifie parent, arbre et propreté.
L’identité Git doit être configurée sur la machine ou dans le dépôt. Un problème
de commit conserve les modifications. Aucun push, PR ou merge n’est effectué.
La V1 n’installe pas automatiquement les dépendances du projet et ne lance pas
encore de commandes de validation configurables.

## Annulation, arrêt et récupération

Annuler un Run QUEUED le termine immédiatement. Pour un Run actif, le backend
persiste une demande et le worker l’observe toutes les 500 ms. Le processus reçoit
une tentative d’arrêt, puis un arrêt forcé après cinq secondes si nécessaire.
POSIX utilise un groupe de processus ; Windows conserve les identités PID/date de
création des descendants via Toolhelp, tente `taskkill`, puis vérifie leur arrêt.
L’état terminal est écrit après la fin du processus. Les logs restent disponibles.

Le timeout de trois heures suit le même arrêt et produit `FAILED`. L’arrêt normal
du serveur attend le tick actif et la terminaison de son worker avant de libérer
son verrou. Après une mort brutale, les anciens Runs actifs sans processus vivant
sont marqués échoués, en préservant branche, fichiers et événements.

Si l’ancien PID Codex est encore vivant, la queue reste suspendue jusqu’à sa
disparition : aucun PID hérité n’est tué aveuglément. Si la terminaison des
descendants n’a pas pu être vérifiée, `termination_verified = 0` bloque durablement
la queue, y compris après redémarrage. Une intervention locale doit vérifier et
terminer les processus restants avant de rétablir ce champ pour le Run concerné.
Cette récupération exceptionnelle n’a pas encore d’interface dédiée.

Le champ est mis à zéro **avant** le lancement de Codex, puis rétabli uniquement
après vérification de fin, y compris pour une sortie normale. Un crash au milieu
d’une exécution demande donc cette vérification locale avant reprise. Supprimer
le projet ne permet pas de contourner ce blocage : la suppression est refusée tant
qu’une terminaison reste non vérifiée. Une annulation reçue pendant le nettoyage
est arbitrée transactionnellement avant le statut final.

Tout échec ou annulation conserve le worktree. Un succès ne retire le worktree
que si son commit est retenu par la branche, son HEAD est conforme et son contenu
est entièrement propre, y compris fichiers ignorés. Aucun `remove --force` n’est
utilisé. La présence de dépendances ignorées peut donc laisser un worktree de
succès à nettoyer manuellement. Les branches de Run sont toujours conservées.

## Tests et limites V1

`npm test` couvre le CRUD filesystem, les horaires/fuseaux/DST, transactions,
concurrence, événements, redémarrage, Git réel avec remote local jetable et arrêt
de véritables arbres de processus de test. Ces tests n’utilisent pas de modèle.

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
La validation finale comprend 55 tests réussis, un test de symlink ignoré faute de
privilèges Windows, TypeScript, ESLint et le build de production sans avertissement.
Une seconde exécution réelle réussie a vérifié le contrôle renforcé des descendants
après sortie normale de Codex, avec terminaison vérifiée et nettoyage du worktree.

La validation locale a lieu sous Windows. Les branches POSIX doivent aussi être
testées sur macOS/Linux. Les logs et branches n’ont pas encore de rétention
automatique ; la liste des tâches peut être bloquée par un TOML invalide du projet.
Le service attend un serveur Node local persistant, pas un hébergement serverless.

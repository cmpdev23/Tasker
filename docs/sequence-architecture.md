# Sequences et exécution séquentielle

## Situation actuelle

AgentTasker possède deux fonctionnalités de travail distinctes dans chaque Project.
Les **Tasks** décrivent des travaux autonomes, manuels ou planifiés. Les
**Sequences** décrivent des workflows manuels ordonnés qui possèdent leurs propres
`SequenceSteps`. Les deux fonctionnalités utilisent la même infrastructure locale
de queue, de processus, de worktrees, de validation et d’historique, sans partager
leurs définitions produit.

## Problème précis

Un workflow de plusieurs étapes ne peut pas être modélisé comme une collection de
Tasks liées : cela imposerait de créer des Tasks autonomes, mélangerait leur liste
avec des étapes internes et ne garantirait pas que l’étape suivante voie le travail
de la précédente. Une Sequence doit aussi pouvoir contenir des dizaines d’étapes
sans perdre l’ordre, l’état détaillé ou les garanties du runner.

## Situation visée

Une Sequence versionnée dans le dépôt possède une liste ordonnée de SequenceSteps.
Un Run de Sequence passe dans la queue globale, prépare un seul worktree et une
seule branche, puis exécute chaque étape dans ce même environnement. Une étape
suivante ne démarre que lorsque la précédente a réussi. Un échec ou une annulation
arrête la chaîne et préserve le worktree.

## Séparation du domaine

```text
Task → Run autonome

Sequence → Run de Sequence
             ├── SequenceStepRun 01
             ├── SequenceStepRun 02
             └── SequenceStepRun 03
```

- Une `SequenceStep` n’est jamais une `Task`.
- Créer une Sequence ou une étape ne crée pas `.tasker/tasks/`.
- Une Sequence ne référence aucun identifiant de Task.
- La tab Tasks ne retourne que les Runs dont `kind = TASK`; la tab Sequences ne
  retourne que les Runs dont `kind = SEQUENCE`.
- Le partage du worker et de la queue est une réutilisation d’infrastructure, pas
  une relation entre les définitions.

## Configuration versionnée

La source de vérité portable se trouve dans le dépôt :

```text
.tasker/sequences/<sequence-id>/
├── sequence.toml
└── steps/
    └── <step-id>/
        ├── step.toml
        └── instructions.md
```

`sequence.toml` conserve l’identifiant stable, le nom, la stratégie de PR et l’ordre exact des étapes :

```toml
version = 1
id = "production-seo"
name = "Production SEO"
pull_request_strategy = "after_sequence"
failure_policy = "stop"
max_consecutive_failures = 2
steps = ["analyser-search-console", "identifier-opportunite", "rediger-article"]
```

Pour les Sequences longues, `steps` accepte aussi le format TOML multilignes ;
l'ordre dans le tableau reste l'ordre d'exécution :

```toml
steps = [
  "analyser-search-console",
  "identifier-opportunite",
  "rediger-article",
]
```

`pull_request_strategy` accepte `after_sequence` (valeur par défaut pour les anciens
fichiers), `after_each_step` ou `independent_after_each_step`. Le second mode crée
des PR distinctes et empilées : la première cible la branche de base du Project et
chaque suivante cible la branche de publication de l’étape précédente. Le troisième
mode est destiné aux livrables indépendants, tels que des articles SEO : chaque
étape repart de la branche de base et sa PR ne contient aucun commit d’une autre
étape.

`failure_policy` vaut `stop` par défaut. Avec
`independent_after_each_step`, `continue` marque l’étape en échec puis tente la
suivante depuis la branche de base. `max_consecutive_failures` (1 à 20, défaut 2)
interrompt la Sequence au seuil configuré; une étape réussie remet le compteur à
zéro.

Chaque `step.toml` conserve son identité et sa règle de diff :

```toml
version = 1
id = "analyser-search-console"
name = "Analyser Search Console"
instructions = "instructions.md"
expect_changes = false
```

Les identifiants sont des slugs portables et immuables. Les instructions Markdown
sont limitées à 1 MiB. Une Sequence accepte jusqu’à 500 étapes. Les lectures et
mutations refusent les traversées de chemin, liens symboliques, liens physiques et
fichiers inattendus lors d’une suppression. Les anciens dépôts sans dossier
`sequences/` restent valides; le dossier est créé lors de la première création.

## État opérationnel SQLite

La table `runs` contient les unités de queue des deux domaines. `kind` distingue
`TASK` de `SEQUENCE`; `sequence_id` et `current_step_id` décrivent uniquement les
Runs de Sequence. Les anciennes lignes reçoivent `kind = TASK` par migration.

`sequence_step_runs` conserve pour chaque étape exécutée :

- l’ordre et le nom historiques;
- les timestamps et le statut;
- le code de sortie Codex et le résultat structuré;
- l’erreur, le diff et le commit éventuel;
- la branche publiée, l’heure du push et l’URL de PR éventuelle.

Les instructions elles-mêmes restent dans `.tasker/`. Le Run fige au démarrage la
liste résolue des identifiants, noms et règles `expect_changes`, tandis que les
événements et résultats constituent l’historique local.

## Checkpoint portable inter-environnements

SQLite reste l’historique détaillé local, mais une Sequence qui peut être reprise
sur un autre ordinateur publie aussi un checkpoint volontairement réduit. Lorsque
`[git].push = true`, le worker pousse après chaque étape `SUCCESS` sa branche de
Run, puis met à jour `.tasker/state/sequences/<sequence-id>.toml` sur la branche
distante dédiée `agenttasker/state`. Ce fichier ne modifie jamais le checkout de
l’utilisateur ni la branche de base.

Le checkpoint contient uniquement l’identité de la Sequence et du Run, la base
Git, la branche et le commit vérifiés, ainsi que la liste ordonnée des étapes,
leurs statuts certifiés, commits et URLs de PR. Il n’inclut jamais les logs, PID,
chemins locaux, sorties Codex complètes, erreurs brutes ou secrets. Une mise à
jour concurrente utilise une lease Git et est réessayée depuis l’état distant.
En mode `independent_after_each_step`, le worktree revient volontairement à la base
après chaque PR : l’écriture finale du statut `SUCCESS` réutilise donc le dernier
commit de checkpoint déjà vérifié, sans jamais tenter de pousser cette branche
locale réinitialisée à rebours. Si la synchronisation distante échoue malgré tout,
la Sequence déjà certifiée reste `SUCCESS` et l’historique conserve un avertissement
avec la commande explicite `agenttasker sequence sync --id <sequence-id>`; les
étapes, commits et PR ne sont jamais rétrogradés en échec pour cette seule copie
portable.

Depuis un autre ordinateur, l’interface lit ce checkpoint et propose
**Reprendre le checkpoint**. L’action est explicite : elle recrée un nouveau
worktree depuis le commit distant vérifié et ne relance que le suffixe encore
`PENDING`. Elle ne prend jamais automatiquement le relais d’un processus encore
actif sur l’ordinateur source. Sans `git.push`, les Runs restent locaux et aucun
checkpoint portable n’est publié.

Les Runs créés avant cette capacité peuvent être migrés une fois depuis leur
ordinateur d’origine avec `agenttasker sequence sync --id <sequence-id>` ou
`agenttasker sequence sync --all`; `--dry-run` contrôle d’abord les coordonnées
Git et l’éligibilité sans écrire sur le remote. La migration ne relance jamais
Codex ni les validations. Si des étapes ont été ajoutées à la fin depuis un Run
historique, son préfixe compatible est conservé et le nouveau suffixe est écrit
comme `PENDING` dans le checkpoint portable.

## Cycle d’exécution

1. `Run sequence` refuse une Sequence vide ou possédant déjà un Run actif.
2. Le Run `SEQUENCE` entre dans la même queue FIFO globale que les Tasks.
3. Le worker récupère la base distante, crée la branche et le worktree du Run.
4. La préparation du Project est exécutée une fois.
5. Pour chaque SequenceStep, dans l’ordre :
   - Codex reçoit les instructions du Project, de la SequenceStep et les résumés
     bornés des étapes réussies;
   - le code de sortie et le résultat structuré doivent être positifs;
   - les validations du Project sont exécutées;
   - le diff propre à l’étape est vérifié selon `expect_changes`;
   - le runner crée un commit d’étape et avance la base de l’étape suivante.
   - si le push Git est activé, le runner pousse la branche de Run et son
     checkpoint portable après l’étape certifiée.
6. Selon `pull_request_strategy` et les réglages `[git]` du Project :
   - `after_sequence` pousse la branche du Run et crée une PR unique après la
     dernière étape réussie;
   - `after_each_step` pousse après chaque étape ayant produit un commit une branche
     propre à cette étape et crée une PR empilée. La publication doit réussir avant
     que l’étape soit marquée `SUCCESS` et que la suivante démarre.
   - `independent_after_each_step` exige la publication GitHub activée, crée une PR
     indépendante pour chaque commit, puis restaure le worktree isolé sur la base
     avant l’étape suivante. Les PR précédentes n’ont donc pas à être mergées pour
     poursuivre.
7. Le worktree propre peut ensuite être retiré. La branche et ses commits demeurent
   la référence durable; l’URL finale est conservée dans le Run et chaque URL de PR
   d’étape est conservée dans son `SequenceStepRun`.

### Ajouter des étapes après un succès

Lorsqu’une Sequence reçoit de nouvelles étapes à la fin, **Exécuter** crée une
continuation plutôt qu’un Run qui recommence tout. AgentTasker recherche le Run
terminal le plus récent dont les `SequenceStepRun` certifiés constituent un préfixe
strict compatible de la définition actuelle (mêmes identifiants et noms d’étape).
Ce préfixe demeure réutilisable lorsqu’un Run a ensuite échoué ou a été annulé :
les étapes `SUCCESS` restent acquises, tandis que la première étape non certifiée
et les suivantes sont relancées. Le nouveau Run copie uniquement ce préfixe comme
`SUCCESS`, crée un worktree neuf depuis son dernier commit vérifié et ne démarre
Codex que pour les étapes restantes.

Le Run source demeure immuable et sa branche est vérifiée contre son commit final
avant toute continuation. La continuation garde la même base Git initiale pour la
traçabilité et conserve les commits de toutes les étapes. Si le préfixe n’est pas
compatible ou si une étape existante a été réordonnée/renommée, **Exécuter** crée un
Run complet normal. Si la branche source a disparu ou ne pointe plus sur le commit
enregistré, la continuation est refusée sans relancer les étapes antérieures.
L’interface indique explicitement combien d’étapes seront conservées avant le
lancement.

Les statuts d’étape sont `PENDING`, `RUNNING`, `VALIDATING`, `SUCCESS`, `FAILED`,
`CANCELLED` et `SKIPPED`. Une étape ne devient `SUCCESS` qu’après les contrôles
Codex, validation et Git. Lors d’un échec, l’étape courante devient `FAILED` et les
suivantes `SKIPPED`. En mode `after_each_step`, les branches et PR des étapes déjà
réussies restent publiées et visibles dans l’inspecteur. Lors d’une annulation, les
étapes non terminées deviennent `CANCELLED`.

### Pause locale

Le bouton **Pause** d’une Sequence active demande le même arrêt contrôlé de Codex
qu’une annulation, mais enregistre une intention distincte. Après terminaison
vérifiée, le Run apparaît **En pause** et son worktree, sa branche, ses fichiers
non commités et les étapes `SUCCESS` restent intacts. **Reprendre** crée alors un
Run lié qui rouvre exclusivement ce même worktree : si Codex avait déjà fini
l’étape courante, seules ses validations sont rejouées; sinon Codex repart pour
cette étape avec les fichiers partiels encore présents, puis poursuit le suffixe.

Cette reprise est strictement locale : elle exige les coordonnées Git du worktree,
un PID absent et une terminaison vérifiée. Une Sequence en pause bloque **Exécuter**
dans le même environnement afin qu’un clic ne crée pas par erreur une continuation
neuve qui ignorerait le travail partiel. Sur un autre environnement, seul le
checkpoint distant et son préfixe `SUCCESS` certifié peuvent être repris; les
modifications non certifiées du worktree local ne sont jamais présentées comme
portables.

### Reprendre après une validation échouée ou une fin Codex récupérable

Un Run de Sequence échoué peut afficher **Reprendre** lorsque Codex a produit un
résultat structuré `SUCCESS` pour l’étape courante, que le processus est terminé et
qu’une commande de validation de cette étape a échoué. L’action crée un nouveau Run
lié au Run source : l’historique source reste immuable, tandis que le nouveau Run
réutilise exclusivement le worktree et la branche préservés, rejoue la préparation
nécessaire puis les validations de l’étape. Codex n’est pas relancé pour cette étape.

Après cette validation, le runner commit l’étape et continue avec les étapes
suivantes. La reprise est refusée si les coordonnées Git, l’arrêt du processus, les
événements de validation ou la définition ordonnée des étapes ne correspondent plus.
Une seule reprise directe est admise par Run ; si elle échoue à son tour, elle devient
à son tour la source vérifiable d’une nouvelle reprise. La configuration Git (remote
et branche de base) doit rester identique; les commandes de validation actuelles du
Project sont relues pour permettre de corriger un problème d’environnement comme la
version Node requise.

Lorsqu’une étape échoue avant les validations — par exemple parce que Codex a
terminé avec un message final invalide malgré un code zéro — **Reprendre** crée aussi
un Run lié, mais relance Codex pour cette étape. Il rouvre exclusivement le même
worktree et la même branche préservés : les fichiers, diff et contexte de l’échec
restent disponibles à Codex, puis les étapes suivantes reprennent normalement. Ce
parcours exige le même arrêt vérifié, les mêmes coordonnées Git et une frontière
stricte (toutes les étapes antérieures `SUCCESS`, l’étape courante `FAILED`, les
suivantes `SKIPPED`). Il ne reconstruit jamais un worktree depuis la branche de base
et ne certifie jamais un résultat libre comme succès. Lorsque le dernier message
Codex est déjà conservé localement, un extrait borné est aussi transmis comme
compte rendu non fiable : il fournit le raisonnement déjà fait, mais ne peut jamais
devenir une instruction ni remplacer l’inspection du worktree.

Lorsqu’un Run plus récent a tenté le suffixe puis s’arrête, l’interface et le
backend utilisent son préfixe `SUCCESS` certifié comme nouvelle source. Le bouton
**Exécuter** conserve donc chaque étape réussie et relance seulement la première
étape non certifiée ainsi que les suivantes. Le checkpoint distant reste un outil de
changement d’ordinateur, non une action concurrente à la récupération locale.

## Transmission entre étapes

Toutes les étapes utilisent le même worktree et la même branche. Les fichiers et
commits produits sont donc le canal durable principal. Pour les étapes d’analyse
sans diff, le prompt de l’étape suivante reçoit aussi les résumés structurés des
étapes réussies. Ce contexte textuel est borné à 64 000 caractères afin que les
Sequences longues restent exécutables; une étape qui produit un résultat durable
important doit l’écrire dans le dépôt.

## Interface et API

La tab Sequences offre :

- la création, le renommage et la suppression d’une Sequence;
- un écran de détail pour ajouter, modifier, supprimer et réordonner ses étapes;
- le choix entre une PR finale et des PR empilées après chaque étape avec commit;
- le lancement manuel depuis la liste;
- **Pause** pendant une Sequence active, puis **Reprendre** dans le worktree local
  préservé après la terminaison vérifiée;
- **Reprendre** après une validation échouée, ou dans le worktree préservé après
  une fin Codex récupérable;
- l’historique des Runs et le Run Inspector, avec une vue globale de la Sequence
  qui présente la progression, les états agrégés, les erreurs, les vérifications
  et les métadonnées techniques, sans mélanger les résultats ou événements Codex
  d’une étape; une vue filtrée par étape depuis son icône d’inspection affiche
  ensuite le journal détaillé et la même action **Reprendre** lorsqu’elle est
  admissible;
- une progression dédiée affichant chaque SequenceStepRun.

Lorsqu’une étape `SUCCESS` possède un commit vérifié mais aucune PR, son Sheet peut
déclencher **Publier une PR brouillon**. Cette action locale ne relance ni Codex ni
les validations : elle pousse une branche d’étape déterministe sur le commit exact,
contrôle la branche distante et crée une PR GitHub brouillon ou retrouve une PR
ouverte déjà existante. Une étape
publiée antérieurement reste la base de la PR empilée; sinon la branche de base du
Run est utilisée. L’action exige un Run terminal dont l’arrêt est vérifié.

Les définitions actives sont verrouillées pendant leur Run. Les mutations sont
limitées aux requêtes locales comme celles des Tasks. Les API vivent sous
`/api/projects/<projectId>/sequences/`; la lecture de l’historique agrégé utilise
`/api/projects/<projectId>/sequence-runs`. Les opérations génériques d’annulation,
de pause locale, de récupération, de logs et de suppression d’un Run restent sous
`/runs/`.

## Limites actuelles

- Les Sequences se lancent manuellement; elles n’ont pas encore de planification.
- La préparation est effectuée une fois, mais les validations configurées sont
  effectuées après chaque étape.
- Le merge reste toujours une décision humaine; aucune option d’auto-merge n’est
  fournie.
- La stratégie de Sequence ne peut publier que si le Project active aussi `push` et
  `create_pull_request` dans ses réglages Git.

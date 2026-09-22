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
steps = ["analyser-search-console", "identifier-opportunite", "rediger-article"]
```

`pull_request_strategy` accepte `after_sequence` (valeur par défaut pour les anciens
fichiers) ou `after_each_step`. Le second mode crée des PR distinctes et empilées :
la première cible la branche de base du Project et chaque suivante cible la branche
de publication de l’étape précédente.

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
6. Selon `pull_request_strategy` et les réglages `[git]` du Project :
   - `after_sequence` pousse la branche du Run et crée une PR unique après la
     dernière étape réussie;
   - `after_each_step` pousse après chaque étape ayant produit un commit une branche
     propre à cette étape et crée une PR empilée. La publication doit réussir avant
     que l’étape soit marquée `SUCCESS` et que la suivante démarre.
7. Le worktree propre peut ensuite être retiré. La branche et ses commits demeurent
   la référence durable; l’URL finale est conservée dans le Run et chaque URL de PR
   d’étape est conservée dans son `SequenceStepRun`.

Les statuts d’étape sont `PENDING`, `RUNNING`, `VALIDATING`, `SUCCESS`, `FAILED`,
`CANCELLED` et `SKIPPED`. Une étape ne devient `SUCCESS` qu’après les contrôles
Codex, validation et Git. Lors d’un échec, l’étape courante devient `FAILED` et les
suivantes `SKIPPED`. En mode `after_each_step`, les branches et PR des étapes déjà
réussies restent publiées et visibles dans l’inspecteur. Lors d’une annulation, les
étapes non terminées deviennent `CANCELLED`.

### Reprendre après une validation échouée

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
- **Reprendre** après le cas précis d’un succès Codex suivi d’une validation échouée;
- l’historique des Runs et le Run Inspector, avec une vue globale de la Sequence
  qui présente la progression, les états agrégés, les erreurs, les vérifications
  et les métadonnées techniques, sans mélanger les résultats ou événements Codex
  d’une étape; une vue filtrée par étape depuis son icône d’inspection affiche
  ensuite le journal détaillé et la même action **Reprendre** lorsqu’elle est
  admissible;
- une progression dédiée affichant chaque SequenceStepRun.

Les définitions actives sont verrouillées pendant leur Run. Les mutations sont
limitées aux requêtes locales comme celles des Tasks. Les API vivent sous
`/api/projects/<projectId>/sequences/`; la lecture de l’historique agrégé utilise
`/api/projects/<projectId>/sequence-runs`. Les opérations génériques d’annulation,
de récupération, de logs et de suppression d’un Run restent sous `/runs/`.

## Limites actuelles

- Les Sequences se lancent manuellement; elles n’ont pas encore de planification.
- La préparation est effectuée une fois, mais les validations configurées sont
  effectuées après chaque étape.
- Le merge reste toujours une décision humaine; aucune option d’auto-merge n’est
  fournie.
- La stratégie de Sequence ne peut publier que si le Project active aussi `push` et
  `create_pull_request` dans ses réglages Git.

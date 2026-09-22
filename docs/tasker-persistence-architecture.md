# Configuration Architecture: `.tasker/` vs SQLite

## Status

**Decision: frozen for the initial AgentTasker architecture.**

AgentTasker uses a hybrid persistence model:

> **The repository owns the project configuration. SQLite owns the local
> operational state.**

Project configuration that should be portable, reviewable, and versioned
lives inside a `.tasker/` directory at the root of the managed Git
repository.

Machine-specific and runtime information lives in AgentTasker's local
SQLite database.

This separation is intentional and should be preserved unless a future
architectural decision explicitly replaces it.

------------------------------------------------------------------------

## 1. Core rule

Use `.tasker/` for information that answers:

> **How should AgentTasker work with this repository?**

Use SQLite for information that answers:

> **What is happening, or has happened, on this particular AgentTasker
> installation?**

In short:

``` text
Git repository
└── .tasker/
    └── portable + versioned configuration

AgentTasker local data
└── SQLite
    └── machine-specific + runtime state
```

------------------------------------------------------------------------

## 2. `.tasker/` belongs inside the managed repository

Each Git repository managed by AgentTasker may contain its own
`.tasker/` directory.

Example:

``` text
cmt/
├── .tasker/
│   ├── project.toml
│   ├── instructions.md
│   ├── LESSONS.md
│   ├── logs/
│   │   └── <task-id>_<run-id>.txt
│   │
│   ├── tasks/
│       ├── create-seo-page/
│       │   ├── task.toml
│       │   └── instructions.md
│       │
│       └── technical-audit/
│           ├── task.toml
│           └── instructions.md
│   └── sequences/
│       └── production-seo/
│           ├── sequence.toml
│           └── steps/
│               └── research/
│                   ├── step.toml
│                   └── instructions.md
│
├── AGENTS.md
├── README.md
├── docs/
├── src/
└── ...
```

The repository itself is already the project boundary.

Therefore, the structure should **not** add another unnecessary project
level such as:

``` text
.tasker/project_1/
```

Instead:

``` text
cmt/.tasker/
```

means:

> This is the AgentTasker configuration for the `cmt` repository.

------------------------------------------------------------------------

## 3. Why configuration lives in Git

Storing project configuration in `.tasker/` makes it:

-   versioned;
-   diffable;
-   reviewable in pull requests;
-   portable;
-   clonable;
-   editable outside AgentTasker;
-   recoverable through Git history;
-   shareable with other developers using the same repository.

For example, changing a scheduled task may produce a normal Git diff:

``` text
modified: .tasker/tasks/create-seo-page/task.toml
modified: .tasker/tasks/create-seo-page/instructions.md
```

This allows AgentTasker configuration to evolve with the application
itself.

A developer can clone a repository containing `.tasker/` and AgentTasker
can detect that the repository is already configured.

Conceptually:

``` text
git clone <repository>
        ↓
open repository in AgentTasker
        ↓
.tasker/ detected
        ↓
project configuration loaded
```

The user should not need to recreate tasks and instructions manually on
every machine.

------------------------------------------------------------------------

## 4. `.tasker/` is the source of truth for project configuration

AgentTasker's UI acts as a graphical editor for the files inside
`.tasker/`.

For example:

``` text
UI: Create Task
        ↓
.tasker/tasks/my-task/task.toml

UI: Edit task instructions
        ↓
.tasker/tasks/my-task/instructions.md

UI: Change schedule
        ↓
task.toml updated
```

Advanced users may edit these files directly in VS Code or another
editor.

Both approaches manipulate the same configuration.

This means SQLite should **not** become a competing source of truth for
task definitions, project instructions, schedules, or repository
references.

------------------------------------------------------------------------

## 5. Proposed `.tasker/` structure

Initial structure:

``` text
.tasker/
├── project.toml
├── instructions.md
├── LESSONS.md
├── agents/
│   ├── main.toml
│   └── <subagent-id>.toml
├── tasks/
    └── <task-id>/
        ├── task.toml
        └── instructions.md
└── sequences/
│   └── <sequence-id>/
│       ├── sequence.toml
│       └── steps/
│           └── <step-id>/
│               ├── step.toml
│               └── instructions.md
```

Additional files may be introduced later when justified, for example:

``` text
.tasker/
└── tasks/
    └── seo-page/
        ├── task.toml
        ├── instructions.md
        └── output.schema.json
```

Le format livré des Sequences est détaillé dans
[Sequences et exécution séquentielle](sequence-architecture.md). Les SequenceSteps
sont des définitions propres à leur Sequence et ne référencent jamais les Tasks.

The format should remain understandable without requiring AgentTasker
itself.

------------------------------------------------------------------------

## 6. `project.toml`

`project.toml` stores portable project-level configuration.

Example:

``` toml
version = 1

name = "Comparer Mon Taux"

[git]
base_branch = "main"
remote = "origin"
push = false
create_pull_request = false
pull_request_draft = true

[execution]
default_timeout_minutes = 180
package_manager = "npm"
install_dependencies = false
install_timeout_minutes = 15
validation_scripts = ["lint", "build"]
validation_timeout_minutes = 20
```

La publication Git est partagée par les Tasks et Sequences du Project et reste
désactivée par défaut. Une PR exige le push; le mode brouillon est recommandé et
l’auto-merge n’existe pas. Les identifiants logiques suivent le dépôt, tandis que
l’authentification Git/GitHub reste locale et aucun secret n’est écrit dans ce fichier.

Chaque `sequence.toml` ajoute `pull_request_strategy = "after_sequence"`,
`"after_each_step"` ou `"independent_after_each_step"`. La dernière stratégie crée
une PR par étape depuis la base du Project. Les clés `failure_policy = "stop"|"continue"`
et `max_consecutive_failures` (1–20, défaut 2) déterminent si les étapes indépendantes
peuvent poursuivre après un échec. Les URLs, branches publiées et timestamps de chaque
exécution restent de l'état opérationnel SQLite dans `sequence_step_runs`.

Les réglages d’exécution sont partagés par les Tasks du Project. AgentTasker transforme les
noms de scripts en commandes déterministes du gestionnaire choisi; il ne stocke
pas de chemins absolus vers Node ou npm et n’accepte pas de commande shell libre.
`python_min_version` peut optionnellement déclarer une version Python minimale
portable (par exemple `"3.11"`); le chemin de l’interpréteur reste résolu et
historisé localement pour chaque Run. Un interpréteur choisi explicitement dans
l’interface est une préférence de machine enregistrée dans SQLite, jamais dans
`project.toml`.
L’installation reste désactivée par défaut et doit être activée explicitement dans
Settings pour un dépôt de confiance. Les overrides de ces réglages par Task restent
une extension future.

Project instructions should remain in a Markdown file rather than
embedding large prompts inside TOML:

``` toml
instructions = "instructions.md"
```

La configuration Codex principale vit dans `.tasker/agents/main.toml` et les
sous-agents personnalisés dans `.tasker/agents/<subagent-id>.toml`. Les clés
reprennent directement le schéma natif de Codex; voir
`docs/codex-agent-configuration.md`.

This keeps prompts easy to read, edit, diff, and review.

`LESSONS.md` est une mémoire opérationnelle propre au projet. Elle contient des
règles brèves et vérifiables tirées d'erreurs réellement comprises (terminal,
outils, tests, build ou validation), afin que les Runs suivants évitent de les
répéter. Elle ne contient ni logs bruts, ni secrets, ni chemins machine, ni état
de Run. Le worker n'injecte pas son contenu dans le prompt : Codex reçoit seulement
la consigne de le lire directement dans le worktree et peut le mettre à jour dans
la branche du Run lorsque la leçon est durable.

------------------------------------------------------------------------

## 7. Task configuration

The implemented V1 schema is specified in [Task configuration](task-configuration.md).
It supports manual/once/hourly/daily/weekly schedules and `expect_changes`; the richer
example below describes future extensions. Runtime tables and lifecycle are
documented in [Task runner architecture](task-runner-architecture.md).

Each task gets its own directory.

Example:

``` text
.tasker/tasks/create-seo-page/
├── task.toml
└── instructions.md
```

A possible `task.toml`:

``` toml
version = 1

id = "create-seo-page"
name = "Create SEO Page"
enabled = true

instructions = "instructions.md"

references = [
  "README.md",
  "AGENTS.md",
  "docs/seo_strategy.md",
  "docs/template_page.md"
]

[agent]
use_project_defaults = true

[schedule]
type = "weekly"
days = ["monday", "wednesday", "friday"]
time = "07:00"
timezone = "America/Toronto"

[git]
create_worktree = true
commit = true
push = true
create_pull_request = true
pull_request_draft = true

# Hérite actuellement de [execution].validation_scripts dans project.toml.
# Un override de validation par Task n'est pas encore implémenté.
```

The exact schema will evolve, but the persistence boundary defined in
this document should remain stable.

------------------------------------------------------------------------

## 8. References point to repository knowledge

AgentTasker should avoid duplicating existing documentation into
`.tasker/`.

If the repository already contains:

``` text
docs/
├── architecture.md
├── seo_strategy.md
└── template_page.md
```

AgentTasker should reference those files:

``` toml
references = [
  "README.md",
  "AGENTS.md",
  "docs/architecture.md",
  "docs/seo_strategy.md"
]
```

It should **not** normally create duplicate copies such as:

``` text
.tasker/references/architecture.md
.tasker/references/seo_strategy.md
```

Repository-relative references preserve a single source of truth.

------------------------------------------------------------------------

## 9. What belongs in SQLite

SQLite stores local operational state.

Examples include:

-   registered local projects;
-   the local archive state of a project (archived projects are hidden from the
    active list and excluded from scheduling, while their repository path and
    Run history remain recoverable locally);
-   absolute local repository paths;
-   runs;
-   run events;
-   logs or log metadata;
-   queue state;
-   scheduler state;
-   next-run calculations when cached;
-   process identifiers;
-   temporary worktree paths;
-   local application preferences;
-   explicit local Python interpreter paths;
-   machine-specific integration state;
-   timestamps and execution history.

Example:

``` text
projects
runs
run_events
scheduler_state
queue_state
local_preferences
```

A Run is operational history and therefore belongs in SQLite.

Example:

``` text
Run #1042

Task: create-seo-page
Status: SUCCESS
Started: 2026-09-10 07:00
Completed: 2026-09-10 07:38
Branch: agenttasker/1042-create-seo-page
Commit: abc123
Pull request: #418
```

This information should not continuously modify the Git repository.

------------------------------------------------------------------------

## 10. Local repository paths belong in SQLite

Absolute paths are machine-specific.

For example, the same repository could exist at:

``` text
Windows:
C:\Users\user\Desktop\Dev\cmt
```

and:

``` text
Linux:
/data/projects/cmt
```

Therefore this must **not** be stored in `.tasker/project.toml`:

``` toml
repository_path = "C:\\Users\\user\\Desktop\\Dev\\cmt"
```

Instead, AgentTasker's local SQLite database maps the local installation
to the repository.

Conceptually:

``` text
Project identity/configuration
→ repository + .tasker/

Local checkout location
→ SQLite

Local Python interpreter override
→ SQLite (`project_runtime_preferences`)
```

Le chemin Python explicite suit la même règle que le checkout : il peut contenir
un profil utilisateur Windows ou une installation propre à la machine. Il est
validé et résolu localement avant d’être enregistré. Seule l’exigence portable
`python_min_version` appartient à `.tasker/project.toml`.

------------------------------------------------------------------------

## 11. Runtime state must not pollute Git

AgentTasker should not write operational files such as:

``` text
.tasker/runtime.json
.tasker/queue.json
.tasker/last-run.json
.tasker/current-process.json
```

Doing so would cause meaningless Git changes whenever AgentTasker
executes.

Runtime state belongs in SQLite.

The deliberately narrow exception is the portable Sequence checkpoint used for a
manual cross-environment handoff. When `[git].push = true`, AgentTasker writes it
to the remote-only `agenttasker/state` branch, never to the user's checkout or the
base branch. It stores verified Git references and certified step progress, but
not logs, PIDs, paths, complete agent output, or secrets; those remain local.

The Git working tree should change only when the user intentionally
changes versioned AgentTasker configuration or when a coding task
modifies the project.

------------------------------------------------------------------------

## 12. Scheduling boundary

The **schedule definition** belongs in `.tasker/` because it is part of
the task configuration.

Example:

``` toml
[schedule]
type = "daily"
time = "07:00"
timezone = "America/Toronto"
```

The **scheduler's operational state** belongs in SQLite.

Examples:

``` text
last evaluated occurrence
next scheduled run cache
missed-run state
queued run ID
scheduler heartbeat/state
```

Therefore:

``` text
"What is the schedule?"
→ .tasker/

"What happened with that schedule on this machine?"
→ SQLite
```

------------------------------------------------------------------------

## 13. Secrets do not belong in `.tasker/`

Secrets must never be committed to Git.

Do not store:

``` toml
openai_api_key = "..."
github_token = "..."
password = "..."
```

inside `.tasker/`.

Credentials should use an appropriate local mechanism such as:

-   l'authentification existante de Codex;
-   environment variables;
-   OS credential storage;
-   another secure local credential mechanism.

La V1 fournit un mécanisme local par Project pour les variables nécessaires aux Runs.
`project_environment_variables` conserve leurs valeurs chiffrées avec AES-256-GCM;
la clé aléatoire `environment-secrets.key` reste dans le répertoire de données local
d’AgentTasker, séparée de SQLite et extérieure au dépôt. Le nom du Project et celui de
la variable font partie des données authentifiées du chiffrement afin d’empêcher le
déplacement silencieux d’un ciphertext vers une autre entrée.

L’API retourne uniquement les noms et l’état configuré. Une valeur existante peut être
conservée sans être renvoyée au navigateur, remplacée explicitement, ou supprimée avec
sa ligne. La suppression d’un Project supprime ses variables par cascade. Une sauvegarde
récupérable doit inclure la base et la clé locale; le chiffrement protège notamment une
copie isolée de la base, mais ne remplace pas les permissions du compte utilisateur ni
un coffre-fort système contre un processus local déjà compromis.

------------------------------------------------------------------------

## 14. Source-of-truth table

  Information                       `.tasker/`     SQLite / local state
  ------------------------------- ------------ ------------------------
  Project logical configuration              ✓ 
  Project instructions                       ✓ 
  Project operational lessons                ✓
  Task definitions                           ✓ 
  Task instructions/prompts                  ✓ 
  Sequence definitions                      ✓
  SequenceStep instructions                 ✓
  Repository references                      ✓ 
  Agent defaults                             ✓ 
  Task agent overrides                       ✓ 
  Validation commands                        ✓ 
  Schedule definitions                       ✓ 
  Git strategy                               ✓ 
  Local repository path                                               ✓
  Local Python interpreter path                                       ✓
  Project environment variable names                                 ✓
  Run history                                                         ✓
  Run events                                                          ✓
  SequenceStep Run state                                              ✓
  Portable Sequence checkpoint          remote `agenttasker/state`
  Queue state                                                         ✓
  Scheduler runtime state                                             ✓
  Process/PID state                                                   ✓
  Temporary worktree paths                                            ✓
  Local UI preferences                                                ✓
  Integration state                                                   ✓
  Raw credentials/secrets                Never   Encrypted local mechanism

------------------------------------------------------------------------

## 15. SQLite may cache configuration, but it does not own it

For performance or indexing, AgentTasker may eventually cache selected
`.tasker/` information in SQLite.

If this happens, the rule remains:

> **For versioned project configuration, `.tasker/` is authoritative.**

A cache can always be rebuilt from the repository.

AgentTasker must avoid a situation where the database and `.tasker/`
both contain independently editable copies of the same task definition.

If a conflict exists, the repository configuration wins unless a future
explicit synchronization design defines otherwise.

------------------------------------------------------------------------

## 16. Project discovery

When a user selects a repository, AgentTasker checks for:

``` text
<repository>/.tasker/
```

Possible behavior:

### `.tasker/` exists

``` text
AgentTasker configuration detected
→ load project configuration
→ register local repository path in SQLite
→ index tasks
→ index sequences
```

### `.tasker/` does not exist

``` text
No AgentTasker configuration detected
→ offer to initialize project
→ create .tasker/
→ create project.toml
→ create instructions.md
→ create LESSONS.md
→ create tasks/
→ create sequences/
```

The same registration can now start from the repository with `agenttasker init`.
The CLI writes a machine-local registration request outside the repository; the
application imports it into SQLite when projects are next loaded. It never edits
SQLite directly. See [Initialisation avec la CLI](cli-onboarding.md).

This makes repositories portable between AgentTasker installations.

------------------------------------------------------------------------

## 17. Git behavior for `.tasker/`

`.tasker/` is intended to be committed to Git. The generated Run log directory is
the narrow exception: `/.tasker/logs/` is ignored because exported logs are local
operational artifacts.

It should **not** be added to `.gitignore` by default.

Example:

``` text
git status

modified: .tasker/project.toml
modified: .tasker/tasks/seo-page/instructions.md
```

This is expected and desirable.

A pull request can therefore review both application changes and
automation/configuration changes.

------------------------------------------------------------------------

## 18. Why not store everything in SQLite?

Storing all configuration in SQLite would simplify persistence
initially, but would create several disadvantages:

-   tasks would not follow the repository;
-   configuration would not be naturally versioned;
-   Git history could not explain task changes;
-   pull requests could not review automation changes;
-   cloning a repository would not reproduce its AgentTasker setup;
-   developers would be forced to use AgentTasker's UI to inspect
    configuration;
-   backup and portability would become more application-specific.

SQLite remains excellent for runtime state, but it should not replace
Git for repository-owned configuration.

------------------------------------------------------------------------

## 19. Why not store everything in `.tasker/`?

The opposite extreme is also undesirable.

Persisting runs, logs, queue state, process IDs, and scheduler state
inside the repository would:

-   constantly dirty the Git working tree;
-   create noisy commits;
-   mix portable configuration with machine-specific state;
-   expose local filesystem information;
-   make concurrent execution harder;
-   turn Git into a runtime database.

SQLite is the appropriate boundary for this operational data.

------------------------------------------------------------------------

## 20. Final architecture

The final conceptual model is:

``` text
Git Repository
│
├── application code
├── documentation
├── AGENTS.md
│
└── .tasker/
    ├── project.toml
    ├── instructions.md
    ├── LESSONS.md
    └── tasks/
        └── ...
        │
        └── versioned project configuration
                 │
                 │ loaded by
                 ↓
          ┌───────────────┐
          │  AgentTasker  │
          └───────────────┘
                 │
                 ↓
              SQLite
                 │
                 ├── local project paths
                 ├── runs
                 ├── events/logs
                 ├── queue
                 ├── scheduler state
                 └── machine-local state
```

The architectural boundary can be summarized in one sentence:

> **If the information should follow the repository when it is cloned,
> it belongs in `.tasker/`. If it describes this machine or an execution
> of AgentTasker, it belongs in local state, primarily SQLite.**

------------------------------------------------------------------------

## Decision

For AgentTasker V1:

1.  `.tasker/` lives at the root of each managed Git repository.
2.  `.tasker/` is committed to Git.
3.  `.tasker/` is the source of truth for portable project and task
    configuration.
4.  Repository knowledge is referenced by relative path rather than
    duplicated.
5.  SQLite stores local paths, including an explicit Python interpreter,
    encrypted Project environment values, execution history, queue/scheduler
    state, and other runtime information.
6.  Absolute machine-specific paths are never stored in versioned
    project configuration.
7.  Runtime state must not generate changes in the checkout or base branch; the
    reduced, remote Sequence checkpoint is the explicit exception for a manual
    cross-environment resume.
8.  Secrets are never stored in `.tasker/`.
9.  AgentTasker's UI edits the same `.tasker/` configuration that
    advanced users can edit manually.
10. SQLite may cache `.tasker/` data later, but the versioned repository
    configuration remains authoritative.

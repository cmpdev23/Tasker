# AgentTasker

> Une interface locale pour généraliser une automatisation Codex/Git déjà
> éprouvée sur Linux, sans en perdre les garanties opérationnelles.

## Automatisation de référence

AgentTasker est né de l'automatisation v3 de génération d'articles qui a été
exploitée sur le serveur Linux *slushville*. Son guide d'implantation est la
référence fonctionnelle et opérationnelle :
[docs/v1/implantation-v3.md](docs/v1/implantation-v3.md).

Cette automatisation ne se limitait pas à lancer Codex toutes les heures. Elle
lisait une file versionnée dans Git, sélectionnait une tâche disponible,
réclamait celle-ci de manière atomique sur une branche distante, puis lançait
Codex dans un worktree éphémère. Le runner attendait le processus, validait
indépendamment sa sortie structurée, le diff autorisé et le build, avant de
committer, pousser et créer une PR brouillon. Les échecs conservaient un état
diagnostiquable et une PR nécessitant l'intervention humaine.

L'objectif d'AgentTasker est de rendre ce modèle accessible dans une UI et de
le généraliser à différents dépôts et types de tâches, tout en préservant ses
propriétés :

| Automatisation Linux v3 | Généralisation dans AgentTasker |
| --- | --- |
| File JSON `pending/` d'articles | Tasks persistantes et Runs planifiés |
| Timer systemd horaire | Scheduler interne, indépendant de l'OS |
| Runner Python unique | Worker serveur et queue persistante |
| Branche de réclamation distante | Branche/worktree isolé par Run et contrôles Git |
| Allowlist des fichiers blog | Règles de diff et chemins autorisés par Task |
| `npm run build` rejoué | Commandes de validation configurables |
| `result.json` conforme à un schéma | Résultat Codex structuré et vérifié |
| Push + PR brouillon, succès ou échec | Intégration Git optionnelle sous contrôle humain |
| `RUN_DIR`, journal systemd et branches | Événements, logs, stderr, validations et récupération dans l'UI |

Le guide v3 décrit une automatisation particulière du blogue; ses chemins,
variables `CMT_*`, modèle, cadence et commandes ne sont donc pas des valeurs
universelles d'AgentTasker. En revanche, son contrat d'exécution est la base
à reproduire : le runner orchestre, l'agent travaille, et le runner vérifie.

## Running the current V1

Use Node.js 24 LTS (see `.nvmrc`), install dependencies with `npm install`, expose the local CLI once with `npm link`,
then run `npm run dev` and open [localhost:5000](http://localhost:5000). Use a
persistent local Node.js server, Git with a configured commit identity, and an
authenticated Codex CLI. SQLite migrations run automatically. See `.env.example`
for optional local paths.

After linking, open any Git repository and run `agenttasker init`. The current
repository is initialized and queued for registration in the local application;
AgentTasker is not added to that repository's package dependencies.

Register a repository, initialize Tasker in Settings, select its remote base branch,
configure dependency installation and package validation scripts in Settings,
configure the principal agent in Agents, then create a Task. Manual, once, hourly,
daily and weekly schedules all use the same persisted queue and single worker.
The Tasks tab provides editing, deletion, Run now, rerun of failed Tasks, live logs,
cancellation and history. A rerun creates a new queued Run from the current Task and
Project settings while preserving the failed Run and its worktree.

Runs use the latest remote base in an isolated worktree, optionally install locked
dependencies, verify Codex's structured result, execute the configured package
scripts and validate Git changes, then create a local commit. No push or merge is performed
in the current V1. Failed and cancelled worktrees are retained. The application
must remain running for scheduling; closing the browser does not stop execution.

Quality commands: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`.
Use a Node version compatible with the installed `better-sqlite3` native binary.
Production runs with `npm run start -- --hostname 127.0.0.1 --port 5000` after building.

AgentTasker fournit aussi le skill versionné `$agenttasker-project` pour permettre à
un agent de créer ou modifier correctement les instructions, Tasks, Sequences et
réglages Codex d’un dépôt géré. Après `agenttasker init`, son parcours `init.md`
permet de finaliser les instructions globales et les validations d’exécution depuis
les conventions réellement détectées dans le dépôt. Il peut être installé localement dans
`.agents/skills/`, puis mis à jour depuis Git. Voir le
[guide du skill AgentTasker](docs/agenttasker-project-skill.md).

Architecture: [Linux automation reference](docs/v1/implantation-v3.md),
[Task runner](docs/task-runner-architecture.md),
[Task configuration](docs/task-configuration.md),
[Persistence](docs/tasker-persistence-architecture.md),
[Git isolation](docs/git-worktree-architecture.md),
[Codex agents](docs/codex-agent-configuration.md).

The sections below describe the broader product vision. Push/PR finalization,
per-Task validation overrides and custom subagent orchestration remain future
work in the UI.


> A local, open-source task orchestrator for coding agents.

AgentTasker is a local application for creating, scheduling, executing,
monitoring, and validating autonomous coding tasks against local Git
repositories. AgentTasker is designed specifically for OpenAI Codex and does
not expose a generic multi-provider layer.

The application runs locally on Windows, macOS, and Linux and exposes a
web UI on localhost.

```text
agenttasker
    ↓
http://localhost:<port>
```

The goal is to reproduce and generalize the Linux runner's operational
contract in a UI, not merely to put a UI around `codex exec`. AgentTasker
provides the orchestration layer around the agent: projects, reusable
instructions, repository-based knowledge, tasks, scheduling, queues,
isolated Git worktrees, live monitoring, deterministic validation, Git
operations, optional pull requests, and run history.

> **The runner orchestrates. The agent works. The runner verifies.**

## 1. Product vision

A user should be able to launch AgentTasker, create a project, select a
local Git repository, define persistent instructions and references,
create tasks, run them manually or on a schedule, monitor the agent
live, validate its work mechanically, and optionally commit, push, and
open a pull request.

```text
Comparer Ma Prime
│
├── Overview
├── Tasks
├── Instructions
└── Settings
```

## 2. Core principles

### Local-first

The MVP requires no AgentTasker cloud account, SaaS backend, or hosted
control plane. Application state is stored locally.

### Cross-platform

The same application should work on Windows, macOS, and Linux.
Individual tasks should not depend on Windows Task Scheduler, cron,
systemd timers, or launchd. AgentTasker owns its scheduler. OS-specific
functionality should be limited mainly to starting AgentTasker
automatically when required.

### Git isolation by default

Every run should normally execute in a temporary Git worktree rather
than the user's normal checkout.

```text
repository/main
      │
      └── temporary worktree
              │
              └── coding agent
```

### Deterministic orchestration

The agent performs intelligent work. AgentTasker owns deterministic
operations: scheduling, queueing, worktree creation, process lifecycle,
timeouts, validation, Git operations, run state, logging, and cleanup.

### Never blindly trust the agent

An agent reporting `SUCCESS` is not enough. AgentTasker independently
verifies configured success conditions such as process exit status, Git
diff, allowed paths, tests, linting, and builds.

### Human control over integration

Automatic merge is not the default workflow.

```text
Agent → Validation → Commit → Push → Draft PR → Human review
```

## 3. Application structure

At the application level:

```text
AgentTasker
│
├── Projects
│   ├── Project A
│   ├── Project B
│   └── Project C
│
└── Global Settings
```

Each project contains four primary areas:

```text
Project
│
├── Overview
├── Tasks
├── Instructions
└── Settings
```

Scheduling, validation, Git behavior, and run history should primarily
live inside Tasks rather than becoming unnecessary top-level modules.

## 4. Overview

The Overview is the operational dashboard. It should immediately show
repository health, agent availability, running work, upcoming runs,
recent runs, and failures requiring attention.

```text
Comparer Ma Prime

Repository  ✓ C:\...\comparermaprime
Git         ✓ main
Agent       ✓ Codex available

RUNNING
● Create SEO Article — 18m 42s

NEXT RUNS
Today     14:00   Search Console analysis
Tomorrow  07:00   Create SEO article

RECENT RUNS
✓ SEO article               42m
✕ Search Console analysis   18m
```

## 5. Project Settings

Settings define the execution environment shared by the project's tasks.

### Repository

The user selects a local repository folder and a default/base branch.
AgentTasker should detect Git information automatically whenever
possible, including whether the folder is a repository, configured
remotes, `origin`, and the remote GitHub URL.

The remote repository should not normally need to be entered manually.
It can be detected with Git, for example via
`git remote get-url origin`, and overridden only when necessary.

### Agent defaults

A project may define native Codex defaults such as model, reasoning effort,
network access, sandbox behavior, and timeout. Individual tasks may
override these defaults.

### Execution defaults

Possible project defaults include worktree location, cleanup behavior,
and whether failed work should be preserved.

The current V1 exposes the package manager, optional locked dependency
installation, ordered `package.json` validation scripts, separate Run,
installation, and validation timeouts, plus an optional portable Python minimum
version. These settings are stored under `[execution]` in `.tasker/project.toml`;
executable paths remain local to the machine and are reported by the Settings and
Run preflight.

## 6. Instructions and Knowledge

This module contains persistent context shared by tasks.

### Project Instructions

Project Instructions are reusable instructions applied to every relevant
task. They do not replace the coding agent's own system instructions.

Conceptually:

```text
Agent environment/instructions
        +
Project instructions
        +
Task instructions
        +
Selected references
```

### Knowledge / References

Project knowledge should remain primarily inside the repository. The MVP
should not require a vector database or RAG system.

The user selects repository files or directories that are useful to the
agent:

```text
Knowledge & References

✓ README.md
✓ AGENTS.md
✓ docs/architecture.md
✓ docs/seo_strategy.md
✓ .roo/skills/blog-writing/SKILL.md
```

AgentTasker stores repository-relative paths rather than duplicating
these documents in its database. This keeps knowledge versioned with the
code. Tasks inherit project references and may add task-specific
references.

## 7. Tasks

Tasks are the core unit of AgentTasker. A Task defines what should
happen and under which conditions it should execute.

```text
┌──────────────────────────┬────────────┬───────────┐
│ Task                     │ Schedule   │ Status    │
├──────────────────────────┼────────────┼───────────┤
│ Create SEO articles      │ Daily      │ Running   │
│ Search Console audit     │ Monday     │ Success   │
│ Dependency updates       │ Weekly     │ Failed    │
│ Create SEO page          │ Manual     │ —         │
└──────────────────────────┴────────────┴───────────┘
```

A task contains:

- task instructions;
- inherited and task-specific references;
- optional agent configuration overrides;
- schedule;
- validation commands;
- Git behavior;
- run history.

### Scheduling

A task may be manual, one-time, or recurring. The normal UI should use
human-readable controls such as days, time, and timezone rather than
requiring cron syntax. Advanced cron expressions may be supported later.

### Validation

Tasks may define deterministic commands that run after the agent, for
example:

```text
npm run lint
npm run test
npm run build
```

A failed validation normally makes the Run fail even if the agent
reported success.

### Git behavior

Per-task configuration may define base branch, worktree usage, commit
behavior, push behavior, pull-request creation, and whether the PR is
draft or ready for review. Auto-merge should default to off.

## 8. Tasks vs Runs

A Task is a reusable definition. A Run is one execution of that Task.

```text
Task: "Create SEO article every morning"
        │
        ├── Run #101
        ├── Run #102
        ├── Run #103
        └── Run #104
```

Each Run should persist its status, schedule time, queue time, start/end
time, duration, agent configuration, worktree, branch, process exit
code, validations, result, logs, errors, commit, and pull request.

Initial statuses:

```text
QUEUED
RUNNING
VALIDATING
SUCCESS
FAILED
CANCELLED
```

## 9. Live execution

A running task should expose live progress and be cancellable.

```text
RUN #1042

Task       Create SEO page
Status     ● Running
Branch     agenttasker/1042-create-seo-page
Worktree   ~/.agenttasker/worktrees/1042/

EVENTS
12:34:52  Starting Codex
12:34:54  Reading project instructions
12:35:03  Reading references
12:37:22  Editing files
12:41:17  Running build
```

Raw process output should be preserved even when the UI also presents
structured events.

## 10. Scheduler

AgentTasker owns its scheduler. Tasks do not create OS-level
cron/systemd/Task Scheduler/launchd entries.

```text
AgentTasker Server
        │
        ├── Scheduler
        ├── Queue
        └── Workers
```

Schedules are stored in the local database.

The scheduler must also define missed-run behavior when AgentTasker was
offline. Initial policies can include running as soon as AgentTasker
starts or skipping the missed occurrence.

## 11. Queue and Workers

The scheduler must not launch agents directly.

```text
Scheduler
    ↓
Task is due
    ↓
Create Run
    ↓
Queue
    ↓
Worker
    ↓
Execute Run
```

Manual `Run now` executions use the same queue. Global settings control
maximum concurrent runs so multiple expensive agents do not launch
unexpectedly.

Rerunning a failed Task creates another manual Run from the current Task and
Project configuration. The failed Run, logs, branch and worktree remain intact;
the new Run starts from the current remote base rather than resuming that worktree.

## 12. Git worktree lifecycle

The default lifecycle is:

```text
Task becomes runnable
        ↓
Resolve base branch
        ↓
Create temporary branch/worktree
        ↓
Run coding agent inside worktree
        ↓
Inspect changes
        ↓
Run validations
        ↓
Commit
        ↓
Push
        ↓
Optional pull request
        ↓
Cleanup
```

The agent normally operates only inside the temporary worktree. Git
orchestration remains under AgentTasker's control whenever practical.

## 13. Validation model

Validation is a first-class feature. AgentTasker should be able to
verify process exit status, expected changes, Git diff, path
restrictions when configured, validation command exit statuses, and
structured agent output when configured.

The runner, not the agent, owns the final Run status.

## 14. Failure handling

A failed Run must preserve enough information for a human to understand
and recover the work: logs, stderr, agent output, validations, Git diff,
error message, and relevant branch/worktree information.

Partial useful work should not be silently destroyed. Successful
worktrees can normally be cleaned up after commit/push; failed work may
need to be preserved until reviewed.

## 15. Global Settings

Global Settings contain configuration not specific to one repository,
including:

- agent provider installation/authentication status;
- Git availability;
- GitHub integration/authentication;
- scheduler status;
- maximum concurrent workers;
- local application port;
- start-AgentTasker-on-login behavior.

AgentTasker should detect dependencies whenever possible instead of
asking users to enter discoverable information.

## 16. Process architecture

The web interface must not directly own long-running agent processes.

Avoid:

```text
Browser → HTTP request → codex exec for 45 minutes
```

Use:

```text
Browser
   ↓
Web UI / API
   ↓
Local database
   ↑
Scheduler → Queue → Worker → Agent
                         ↓
                      Worktree
```

The server/runner continues operating when the browser tab is closed.
The browser is a control and observability interface, not the execution
host.

## 17. Initial technical direction

The exact stack remains an implementation decision, but the current
direction is:

```text
TypeScript
Node.js
Next.js / React
shadcn/ui

SQLite
Drizzle ORM

Git CLI
Codex CLI and/or Codex SDK
GitHub CLI/API when GitHub integration is enabled
```

A desirable eventual experience is:

```bash
npx agenttasker
```

which starts the local service and prints its localhost URL.

## 18. Native Codex integration

AgentTasker targets OpenAI Codex directly. Project-level agent configuration
uses Codex-native keys under `.tasker/agents/`, and the local model catalog is
read through the official app-server `model/list` method. The MVP does not
define an `AgentProvider` abstraction or a provider selector.

## 19. Initial data model

Core entities:

### Project

```text
id
name
repositoryPath
defaultBranch
instructions
agentDefaults
executionDefaults
createdAt
updatedAt
```

### Reference

```text
id
projectId
path
type
enabled
```

### Task

```text
id
projectId
name
instructions
enabled
schedule
timezone
agentOverrides
validationConfig
gitConfig
createdAt
updatedAt
```

### Run

```text
id
taskId
status
scheduledAt
queuedAt
startedAt
completedAt
worktreePath
branch
agentConfig
exitCode
result
error
commitSha
pullRequestUrl
```

### RunEvent

```text
id
runId
timestamp
type
message
rawPayload
```

## 20. MVP scope

### Included

- local web application;
- project creation;
- local repository selection;
- Git repository detection;
- project instructions;
- repository-based references;
- task creation/editing;
- manual `Run now`;
- rerun of failed Tasks as a new queued Run;
- recurring scheduling;
- internal scheduler;
- execution queue;
- configurable worker concurrency;
- temporary Git worktrees;
- Codex execution;
- live logs;
- task cancellation;
- validation commands;
- commit on success;
- optional push;
- optional draft pull request;
- run history;
- local SQLite persistence;
- basic failure recovery.

### Explicitly out of scope for V1

- AgentTasker cloud service;
- user accounts;
- teams/collaboration;
- remote multi-machine orchestration;
- marketplace;
- plugin ecosystem;
- vector database/RAG;
- visual workflow builder;
- automatic merge by default;
- many agent providers;
- mobile application.

The MVP should solve one problem extremely well:

> **Reliably run recurring or manual coding-agent tasks against local
> Git repositories without requiring users to build their own scheduling
> and orchestration infrastructure.**

## 21. Security principles

Because AgentTasker executes coding agents and shell commands locally,
security is a core concern.

The application should:

- clearly display which repository a task targets;
- use isolated worktrees;
- expose network-access settings;
- avoid silently escalating permissions;
- make validation commands visible/editable;
- preserve audit logs;
- keep credentials out of task prompts whenever possible;
- avoid auto-merge by default;
- make destructive cleanup behavior explicit.

## 22. Design philosophy

AgentTasker should remain understandable.

A user should be able to answer:

1.  What task is running?
2.  Against which repository and branch?
3.  What instructions did the agent receive?
4.  What files/references were provided?
5.  What did the agent do?
6.  What validations ran?
7.  Why did the run succeed or fail?
8.  Where is the resulting code?

If the application cannot answer these questions clearly, the
orchestration layer is not doing its job.

---

## Current project status

**Stage:** product definition / pre-implementation.

The current objective is to build the first local MVP around Codex,
validate the project/task/run model, and keep the implementation small
enough to remain understandable and genuinely useful as an open-source
tool.

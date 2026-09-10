This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

# AgentTasker

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

The goal is not merely to put a UI around `codex exec`. AgentTasker
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

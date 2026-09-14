# Project configuration

Read this reference when initializing `.tasker/` or editing project instructions,
Git publication, dependency installation, validation scripts, or shared timeouts.

## Baseline structure

```text
.tasker/
├── project.toml
├── instructions.md
├── agents/
│   └── main.toml
├── tasks/
└── sequences/
```

Create missing directories without replacing an existing `.tasker/` tree. The
repository must already be registered separately in the local AgentTasker app; these
files do not create a SQLite Project record.

## `project.toml`

Use only portable values. A safe initialized file is:

```toml
version = 1
name = "CRM"

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
validation_scripts = []
validation_timeout_minutes = 20
```

Rules:

- `version` is `1`.
- `name` is the human-facing project name.
- `base_branch` and `remote` are logical Git names, never absolute paths.
- Keep `push` and `create_pull_request` false unless the user explicitly chooses
  publication. A pull request requires push. Draft pull requests are the safe
  default. AgentTasker never auto-merges.
- `package_manager` is one of `npm`, `pnpm`, `yarn`, or `bun`.
- Timeouts are whole minutes. Run timeout: 1–1440. Installation and validation
  timeouts: 1–120.
- `validation_scripts` is a one-line TOML array containing at most 20 distinct
  package-script names. Each name may contain letters, digits, `:`, `.`, `_`, and
  `-`, is at most 100 characters, and must exist in the repository's package
  configuration.
- Enabling dependency installation executes the selected package manager in the
  Run worktree. Only enable it for a repository the user trusts.

## `instructions.md`

Write durable instructions that should apply to every Task and SequenceStep. Prefer
repository-specific architecture, safety rules, validation expectations, and
completion criteria. Do not duplicate large existing documents; the instructions
may direct the agent to read repository files.

Keep temporary requests and one-off deliverables in Task or SequenceStep
instructions instead of the project instructions.

## Source-of-truth boundary

Version in `.tasker/`: project settings, instructions, agent defaults, Task and
Sequence definitions, schedules, and validation settings.

Do not version there: absolute checkout paths, Run records, logs, queue/scheduler
state, PIDs, worktree paths, local UI preferences, or credentials.

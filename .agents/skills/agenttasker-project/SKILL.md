---
name: agenttasker-project
description: Configure, audit, or extend AgentTasker's repository-owned .tasker files, including project instructions, Tasks, Sequences, SequenceSteps, and Codex agent settings. Use when preparing a Git repository to be managed by AgentTasker or changing its portable automation configuration; do not use for AgentTasker application implementation work or Run history.
---

# AgentTasker Project

Configure the current Git repository for AgentTasker by editing its versioned
`.tasker/` directory. Treat `.tasker/` as portable source code: inspect what is
already present, preserve user-owned content, make the smallest requested change,
and leave the result reviewable in Git.

## Boundaries

- Work only on repository-owned configuration. AgentTasker's SQLite database owns
  local project registration, Runs, queue state, logs, process IDs, worktrees, and
  other runtime state.
- Never write secrets, credentials, tokens, absolute machine paths, or local runtime
  state into `.tasker/`. The reduced portable Sequence checkpoint on the remote
  `agenttasker/state` branch is runner-owned; agents must not create or edit it.
- Do not add `.tasker/` to `.gitignore`; it is intended to be committed.
- Do not invent unsupported Task fields such as references, agent overrides,
  per-Task validation, or per-Task Git settings. The current schema is narrower
  than some product-roadmap examples.
- Do not create Tasks as Sequence steps. A Sequence owns independent ordered
  SequenceSteps under its own directory.
- Do not start Runs, push branches, create pull requests, or change AgentTasker's
  local database unless the user separately asks for that action.

## Workflow

1. Read the repository's `AGENTS.md`, `README`, relevant package/build files, and
   existing `.tasker/` files. Never inspect real `.env*` files.
2. Determine whether the user wants initialization, project-level configuration, a
   Task, a Sequence, or Codex agent settings. Load only the matching reference:
   - a newly initialized repository that needs its durable instructions and
     execution settings: [init.md](init.md)
   - initialization, instructions, Git, and validation defaults:
     [references/project.md](references/project.md)
   - autonomous Tasks and schedules: [references/tasks.md](references/tasks.md)
   - ordered manual workflows: [references/sequences.md](references/sequences.md)
   - main Codex settings or custom subagents:
     [references/agents.md](references/agents.md)
3. Reuse existing stable IDs. For new IDs, use lowercase ASCII slugs with digits and
   hyphens, at most 100 characters, and avoid Windows reserved names.
4. Write exact schema version 1 files. Keep instructions in the adjacent Markdown
   file rather than embedding long prompts in TOML.
5. Check the resulting directory structure, TOML keys, referenced instruction
   files, Sequence step order, and `git diff -- .tasker` before reporting completion.
   If AgentTasker is open, tell the user the UI may need to refresh; do not restart
   or interrupt the app automatically.

## Initialization behavior

When `.tasker/` is absent and the user asks to initialize or configure AgentTasker,
create the safe baseline described in `references/project.md`. Derive the project
name from the repository and the base branch from Git when reliable. If either value
cannot be determined without changing the intended result, ask one concise question.

When `agenttasker init` has already created the baseline and the user asks to finish
the base configuration, read [init.md](init.md). It specializes the durable project
instructions and `[execution]` settings without changing Tasks, Sequences, agent
configuration, Git publication, or local runtime state.

When `.tasker/` already exists, never replace it wholesale. Modify only the files
required by the request and preserve stable IDs and unrelated settings.

## Skill distribution

This skill's canonical source is versioned in the AgentTasker repository. Do not
copy its reference content into `.tasker/`; install the complete skill directory
under `.agents/skills/agenttasker-project/` in the managed repository. See the
repository document `docs/agenttasker-project-skill.md` for installation and Git
update commands.

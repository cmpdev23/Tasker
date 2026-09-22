# Sequence configuration

Read this reference when creating, editing, auditing, or reordering an AgentTasker
Sequence and its SequenceSteps.

## Domain rule

A Sequence is a manual ordered workflow. Its steps are not Tasks and never refer to
`.tasker/tasks/`. One Sequence Run retains a single worker, worktree, and branch so
later steps see files committed by earlier steps.

## Files

```text
.tasker/sequences/<sequence-id>/
├── sequence.toml
└── steps/
    └── <step-id>/
        ├── step.toml
        └── instructions.md
```

IDs are stable portable slugs. A Sequence supports at most 500 steps.

## `sequence.toml`

```toml
version = 1
id = "release-crm"
name = "Release CRM"
pull_request_strategy = "after_sequence"
failure_policy = "stop"
max_consecutive_failures = 2
steps = ["audit", "implement", "verify"]
```

The `steps` array is the sole order source and may use either compact or
multiline TOML formatting. It may not contain duplicates. Every listed ID must
have a matching step directory; do not leave unlisted step directories behind.

`pull_request_strategy` is:

- `after_sequence`: one optional pull request after the complete Sequence;
- `after_each_step`: optional stacked pull requests after each step that creates a
  commit.
- `independent_after_each_step`: one independent pull request per committed step,
  each based on the Project base branch.

`failure_policy` is `stop` by default. Only independent step publication supports
`continue`; it proceeds after a failed step until `max_consecutive_failures` (1–20,
default 2) is reached. A successful step resets this counter. Independent pull
requests require Project Git push and pull-request creation to be enabled.

Publication still depends on `[git]` in `.tasker/project.toml`. Do not enable it
without the user's explicit choice.

## `step.toml`

```toml
version = 1
id = "audit"
name = "Audit the CRM"
instructions = "instructions.md"
expect_changes = false
```

Step instructions must be nonempty Markdown and at most 1 MiB. Set
`expect_changes = true` for implementation steps that must produce a diff and false
for analysis steps that may only produce a structured summary.

Each successful step is validated and committed before the next starts. A failure
stops the remaining steps unless the independent strategy explicitly enables its
bounded continuation policy. Important analysis that later steps need should be
written to a repository file when practical, because textual step summaries are
bounded.

Sequences currently run manually and inherit project preparation and validation.
Do not add a schedule table or Task references.

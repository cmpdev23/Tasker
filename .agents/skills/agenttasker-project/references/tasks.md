# Task configuration

Read this reference when creating, editing, auditing, enabling, disabling, or
scheduling an autonomous AgentTasker Task.

## Files

Each Task is self-contained:

```text
.tasker/tasks/<task-id>/
├── task.toml
└── instructions.md
```

`<task-id>` is stable after creation and must match `id` in `task.toml`.
`instructions` must be exactly `"instructions.md"`.

## Schema

```toml
version = 1
id = "review-code"
name = "Review code"
enabled = true
instructions = "instructions.md"
expect_changes = false

[schedule]
type = "weekly"
timezone = "America/Toronto"
time = "07:00"
days = ["monday", "friday"]
starts_at = "2026-09-10T11:00:00.000Z"
```

Only the keys shown for the selected schedule are supported. Arrays must remain on
one line. Task TOML comments may be lost when the UI later rewrites the file.

## Schedules

- `manual`: requires only a named IANA `timezone`.
- `once`: requires `timezone` and `starts_at`.
- `hourly`: requires `timezone`; `starts_at` is optional.
- `daily`: requires `timezone` and `time`; `starts_at` is optional.
- `weekly`: requires `timezone`, `time`, and one or more distinct `days`;
  `starts_at` is optional.

`time` uses 24-hour `HH:mm`. `starts_at` is an absolute ISO timestamp containing
`Z` or a numeric offset. Weekdays are lowercase English names and should be ordered
Monday through Sunday:

```text
monday, tuesday, wednesday, thursday, friday, saturday, sunday
```

Do not add `time` to manual, once, or hourly schedules. Do not add `days` except to
weekly schedules. A manual schedule cannot have `starts_at`.

## Instructions and expected changes

Task instructions must be nonempty Markdown and at most 1 MiB. Make the objective,
scope, constraints, expected artifacts, and completion checks concrete.

Set `expect_changes = true` when a successful Run must leave a Git diff. Use false
for audits or analysis that may legitimately complete without modifying files.

Tasks currently inherit dependency installation and validation scripts from
`.tasker/project.toml`. Do not add per-Task execution, validation, agent, reference,
or Git tables: they are not part of the implemented schema.

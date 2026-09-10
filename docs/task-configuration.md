# Task configuration backend

## Situation actuelle

Projects resolve a local repository through the existing project service. Portable
Task definitions live in that repository's `.tasker/tasks/`, independently of SQLite.

## Problème précis

Task CRUD must preserve stable identifiers and reject malformed schedules or
filesystem paths that could redirect operations outside the task directory.

## Situation visée

The UI, scheduler and runner share one validated filesystem service and the same
`TaskDefinition` contract. This module implements configuration only.

## Contract

- `src/types/tasks.ts`: `TaskDefinition`, `TaskInput`, `TASK_WEEKDAYS`.
- `backend/tasks/task.service.ts`: exported singleton `taskService` and injectable
  `TaskService` class. All methods return promises.
- `list(projectId)` returns `TaskDefinition[]`, sorted by name then ID.
- `get(projectId, taskId)` returns `TaskDefinition` or throws `NotFoundError`.
- `create(projectId, input)` and `update(projectId, taskId, input)` return
  `TaskDefinition`. Inputs are full replacements (`TaskInput`, without `id`);
  unknown fields are rejected. Both booleans must be supplied explicitly.
- `delete(projectId, taskId)` returns `void`; the calling UI owns confirmation.
  Extra files cause `ConflictError`, preventing loss of manually added material.
- Invalid configuration or unsafe paths throw `ValidationError`. Filesystem
  failures such as access denied propagate as errors, never as empty lists.

Names are trimmed, limited to 200 characters and require nonempty content.
Instructions are nonempty UTF-8 Markdown, limited to 1 MiB, and retain whitespace
and line endings. Slugs use lowercase ASCII letters, digits and hyphens, avoid
Windows reserved names, and receive numeric collision suffixes. Renaming never
changes an existing ID. Duplicate display names are permitted.

Every schedule requires a named timezone accepted by `Intl.DateTimeFormat`:

| Type | Required | Optional |
| --- | --- | --- |
| `manual` | timezone | — |
| `once` | timezone, startsAt | — |
| `hourly` | timezone | startsAt |
| `daily` | timezone, time | startsAt |
| `weekly` | timezone, time, days | startsAt |

`time` uses `HH:mm`. Weekdays are distinct lowercase English names, returned in
Monday–Sunday order. `startsAt` is an absolute ISO timestamp with `Z` or a numeric
offset, normalized to UTC. Recurring schedules may use it as a lower bound;
past timestamps remain valid configuration. The scheduler owns due-time behavior.

## Files

Each `.tasker/tasks/<id>/` contains `task.toml` and `instructions.md`:

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

The parser accepts the scalar/string-array subset used by this schema, with
comments, quoted strings, and optional trailing array commas. Arrays must occupy
one line. Unsupported syntax, duplicate/unknown fields, inconsistent IDs and
alternate instructions paths fail explicitly. Updates serialize canonical TOML;
TOML comments are not preserved. Instructions are always read from the fixed file.

`backend/tasks/toml.ts` exports the scalar helpers extracted from Agents unchanged:
`quoteToml`, `readString`, `readBoolean`, `readInteger`, `sectionContent`,
`topLevelContent`. These are limited helpers, not a complete TOML parser. Task
parsing adds stricter schema and syntax checks around them.

## Filesystem behavior and limits

Reads do not initialize directories. Creation requires an existing `.tasker/`
and creates `tasks/` if missing. No task definition is cached or written to SQLite.
Symlinks/junctions in the repository path or task directory hierarchy, and symbolic
or hard links for either task file, are rejected. File reads are bounded, validate
UTF-8 and verify the opened file descriptor. Deletion is nonrecursive and removes
only the two expected files followed by their empty directory.

Updates stage both files before replacement and restore old instructions if the
second replacement fails. Replacements are atomic per file, but a process/OS crash
between them can leave a mixed pair; Git remains the recovery mechanism. Synchronous
filesystem operations prevent interleaving inside one Node process after project
resolution. They do not provide cross-process locking or OS-level protection
against a hostile process changing ancestor directories between system calls.

Targeted `/* turbopackIgnore: true */` annotations on runtime file creation,
replacement and deletion expressions keep external user-owned `.tasker/` paths
out of Turbopack's build-time dependency tracing. They do not change path
validation or filesystem behavior and do not disable tracing globally.

No new ignored artifact is required: test fixtures use the OS temporary directory
and are removed. No concrete dead code remains after helper extraction.

## Verification

Run the combined suite from the repository root. It includes
`backend/tasks/task.service.test.cjs` alongside the runner and scheduler tests.

```sh
npm test
node node_modules/eslint/bin/eslint.js backend/tasks backend/tasker/agents.service.ts src/types/tasks.ts
```

# Git Worktree and Branch Architecture

## Status

**Decision: frozen for the initial AgentTasker architecture.**

This document defines how AgentTasker isolates task executions from the user's working repository, how branches are resolved, and why local checkouts are never modified to start a Run.

> **Important:** This document specifies an architectural contract for the future runner and execution engine. This architecture must not be partially implemented until the runner phase officially begins.

---

## 1. Purpose

AgentTasker runs autonomous coding agents against local Git repositories. In a standard local development workflow, a developer might be actively writing code, switching feature branches, or maintaining uncommitted changes in their main repository checkout.

To ensure safety, repeatability, and non-interference, AgentTasker strictly isolates executions into temporary Git worktrees. To achieve this, AgentTasker distinguishes four distinct branch concepts:

1. **Current branch** (local diagnostic state)
2. **Base branch** (configured logical reference)
3. **Effective base** (updated remote-tracking reference)
4. **Run branch** (isolated, ephemeral execution branch)

---

## 2. Terminology

### Current branch

- **Definition:** The branch currently checked out in the user's local working repository.
- **Example:** `codex/warm-simplecrm-form`
- **Role:** Purely diagnostic. It informs the user and AgentTasker UI about the current state of their primary working copy.
- **Rule:** The `Current branch` does **not** determine the starting point or base of a task Run.

### Remote

- **Definition:** The configured Git remote used as the upstream source of truth.
- **Standard case:** `origin`
- **Rule:** AgentTasker does not hardcode or couple itself specifically to GitHub. The remote can point to GitHub, GitLab, Bitbucket, a self-hosted Git server, or any valid Git remote URL.

### Base branch

- **Definition:** The logical branch configured for the project (or overridden on a specific Task) as the intended baseline.
- **Example:** `main` (or `master`, `develop`)
- **Role:** Represents the conceptual starting branch for new task worktrees.
- **Rule:** The Base branch is saved in the versioned repository configuration (`.tasker/project.toml`) under `[git].base_branch`.

### Effective base

- **Definition:** The combination `<remote>/<base_branch>`.
- **Example:** `origin/main`
- **Role:** The authoritative remote reference used to resolve the exact base commit for an execution after a fetch.
- **Rule:** The local `main` checkout is **not** the source of truth for creating a new Run. The freshly fetched remote reference (`<remote>/<base_branch>`) is authoritative.

### Run branch

- **Definition:** A dedicated, isolated branch created dynamically for a specific Run.
- **Example:** `tasker/run-42`
- **Role:** The branch checked out inside the isolated worktree where the coding agent operates, generates commits, and validates results.
- **Rule:** The agent operates only within this branch and worktree.

---

## 3. Future Runner Workflow

When a Task becomes runnable in the runner, the execution lifecycle follows this deterministic sequence:

```text
Repository local
Current branch: codex/warm-simplecrm-form
        │
        │ (does not determine Run base; left untouched)
        │
        ↓
AgentTasker configuration
Remote: origin
Base branch: main
        │
        ↓
git fetch origin
        │
        ↓
origin/main
        │
        ↓
resolve exact commit XYZ123
        │
        ↓
create tasker/run-42
        │
        ↓
create isolated worktree
        │
        ↓
coding agent executes inside worktree
```

> **Note:** This workflow represents the architectural blueprint for the future runner. It is not implemented during the initial UI/settings phase.

---

## 4. Source of Truth: Remote Over Local Checkout

Consider the following common scenario:

- **Local `main` branch:** points to commit `ABC` (possibly stale or out-of-date).
- **`origin/main` after `git fetch origin`:** points to commit `XYZ` (latest upstream code).

The future Run must start from:

```text
commit XYZ (origin/main)
```

and **not** from:

```text
commit ABC (local main)
```

### Core Rule

> **The local checkout of `main` is not the source of truth for a new Run.**

The authoritative reference is always the updated remote-tracking branch (`<remote>/<base_branch>`), such as `origin/main`.

This guarantees that:
- Agents always work against the latest upstream repository state.
- Runs do not fail or drift simply because the user forgot to run `git pull` on their local machine.

---

## 5. Non-Interference: The Main Checkout Is Sacred

Suppose a developer is working in their primary workspace:

```text
main repository
└── current branch: codex/warm-simplecrm-form
    └── uncommitted edits, staged files, active work
```

AgentTasker must **never**:
- Checkout `main` in the primary working directory.
- Run `git pull` or `git merge` in the primary working directory.
- Run `git reset` or clean the primary working directory.
- Switch or touch the developer's current branch.
- Overwrite or alter the user's uncommitted changes.

Instead, the main repository and the AgentTasker worktree remain completely decoupled:

```text
main repository (User Workspace)
└── current branch: codex/warm-simplecrm-form
    (completely untouched)

AgentTasker worktree (Isolated Workspace)
└── branch: tasker/run-42
    created from latest origin/main
```

The runner interacts with the remote via `git fetch` (which updates remote-tracking references without modifying any local working tree), resolves the commit hash, and spins up a separate Git worktree at a dedicated path.

---

## 6. Auditability and Run Metadata

To ensure complete traceability and reproducibility, every Run must record the exact commit and branch resolution parameters used as its base:

```text
remote = "origin"
base_branch = "main"
base_commit = "XYZ123..." (exact 40-character SHA)
```

Benefits:
- **Reproducibility:** Anyone can inspect the exact commit snapshot on which the agent started.
- **Diff clarity:** Validation and review tooling can compute diffs against `base_commit` with mathematical certainty, regardless of subsequent updates to `main`.
- **Debugging:** If a run fails or exhibits unexpected behavior, developers know whether the base commit contained breaking changes.

*(Schema fields for these properties will be added when the Run model and runner SQLite persistence are formally introduced).*

---

## 7. Portable Configuration in `.tasker/`

Following the persistence architecture defined in `docs/tasker-persistence-architecture.md`:

- **Logical Base branch** is portable configuration and lives in `.tasker/project.toml`.
- **Machine-specific repository paths** belong strictly in AgentTasker's local SQLite database and are never stored in versioned files.

Example in `.tasker/project.toml`:

```toml
version = 1
name = "My Project"

[git]
base_branch = "main"
```

When a new developer clones the repository, AgentTasker detects `.tasker/project.toml` and automatically knows to use `main` as the Base branch for new task worktrees.

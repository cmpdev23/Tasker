# Codex agent configuration

Read this reference when editing AgentTasker's main Codex defaults or custom
subagent definitions.

## Main agent

The portable main configuration lives at `.tasker/agents/main.toml`. A safe baseline
is:

```toml
# Codex defaults managed by AgentTasker for this repository.
# Keys intentionally mirror Codex config.toml.
model_reasoning_effort = "high"
model_reasoning_summary = "auto"
model_verbosity = "medium"
sandbox_mode = "workspace-write"
approval_policy = "never"

[sandbox_workspace_write]
network_access = false

[agents]
enabled = true
interrupt_message = true
```

Supported values in the current AgentTasker UI:

- `model_reasoning_effort`: `minimal`, `low`, `medium`, `high`, `xhigh`;
- `model_reasoning_summary`: `auto`, `concise`, `detailed`, `none`;
- `model_verbosity`: `low`, `medium`, `high`;
- `sandbox_mode`: `read-only`, `workspace-write`, `danger-full-access`;
- `approval_policy`: `on-request`, `never`.

`model` is optional and should use a model actually available to the local Codex
installation. Do not guess a model ID when discovery is unavailable.

When `sandbox_mode = "workspace-write"`, `network_access` controls sandbox network
access. Enabling it or choosing `danger-full-access` materially expands Run access;
do so only when requested and justified.

The optional `[agents]` keys are:

```toml
max_concurrent_threads_per_session = 4
default_subagent_model = "available-model-id"
default_subagent_reasoning_effort = "high"
```

## Custom subagents

Each `.tasker/agents/<subagent-id>.toml` represents one custom Codex subagent:

```toml
name = "Reviewer"
description = "Review changes for correctness and regressions"
developer_instructions = "Inspect the implementation and report concrete issues."
model = "available-model-id"
model_reasoning_effort = "high"
sandbox_mode = "read-only"
```

`name`, `description`, and `developer_instructions` are required. `model`,
`model_reasoning_effort`, and `sandbox_mode` are optional inheritance overrides.
Subagent IDs use lowercase letters, digits, underscores, and hyphens; `main` is
reserved.

AgentTasker currently applies `main.toml` to `codex exec`. Custom subagent files are
portable and editable in the UI, but their full runner orchestration is not yet
implemented. Do not promise that merely creating one makes a Task invoke it.

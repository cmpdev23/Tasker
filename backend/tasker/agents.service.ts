import fs from "node:fs";
import path from "node:path";
import { projectService } from "../projects/project.service";
import { ConflictError, NotFoundError, ValidationError } from "../errors";
import { quoteToml, sectionContent, topLevelContent, readString, readBoolean, readInteger } from "../tasks/toml";
import {
  CODEX_APPROVAL_POLICIES,
  CODEX_REASONING_EFFORTS,
  CODEX_REASONING_SUMMARIES,
  CODEX_SANDBOX_MODES,
  CODEX_VERBOSITIES,
  type CodexApprovalPolicy,
  type CodexReasoningEffort,
  type CodexReasoningSummary,
  type CodexSandboxMode,
  type CodexSubagentConfig,
  type CodexVerbosity,
  type MainCodexAgentConfig,
} from "../../src/types/codex-agents";

export const DEFAULT_MAIN_CODEX_CONFIG: MainCodexAgentConfig = {
  model: "",
  model_reasoning_effort: "high",
  model_reasoning_summary: "auto",
  model_verbosity: "medium",
  sandbox_mode: "workspace-write",
  approval_policy: "never",
  sandbox_workspace_write: {
    network_access: false,
  },
  agents: {
    enabled: true,
    max_concurrent_threads_per_session: null,
    default_subagent_model: "",
    default_subagent_reasoning_effort: "",
    interrupt_message: true,
  },
};

const AGENT_ID_PATTERN = /^[a-z0-9](?:[a-z0-9_-]*[a-z0-9])?$/;

function isEnumValue<T extends readonly string[]>(
  value: string | undefined,
  values: T
): value is T[number] {
  return value !== undefined && values.includes(value);
}

function validateString(value: unknown, label: string, required = true): string {
  if (typeof value !== "string") {
    throw new ValidationError(`${label} must be a string.`);
  }
  const normalized = value.trim();
  if (required && !normalized) {
    throw new ValidationError(`${label} is required.`);
  }
  return normalized;
}

function validateEnum<T extends readonly string[]>(
  value: unknown,
  label: string,
  values: T
): T[number] {
  if (typeof value !== "string" || !values.includes(value)) {
    throw new ValidationError(`${label} must be one of: ${values.join(", ")}.`);
  }
  return value as T[number];
}

export function serializeMainCodexConfig(config: MainCodexAgentConfig): string {
  const lines = [
    "# Codex defaults managed by AgentTasker for this repository.",
    "# Keys intentionally mirror Codex config.toml.",
  ];

  if (config.model.trim()) {
    lines.push(`model = ${quoteToml(config.model.trim())}`);
  }

  lines.push(
    `model_reasoning_effort = ${quoteToml(config.model_reasoning_effort)}`,
    `model_reasoning_summary = ${quoteToml(config.model_reasoning_summary)}`,
    `model_verbosity = ${quoteToml(config.model_verbosity)}`,
    `sandbox_mode = ${quoteToml(config.sandbox_mode)}`,
    `approval_policy = ${quoteToml(config.approval_policy)}`
  );

  if (config.sandbox_mode === "workspace-write") {
    lines.push(
      "",
      "[sandbox_workspace_write]",
      `network_access = ${config.sandbox_workspace_write.network_access}`
    );
  }

  lines.push(
    "",
    "[agents]",
    `enabled = ${config.agents.enabled}`,
    `interrupt_message = ${config.agents.interrupt_message}`
  );

  if (config.agents.max_concurrent_threads_per_session !== null) {
    lines.push(
      `max_concurrent_threads_per_session = ${config.agents.max_concurrent_threads_per_session}`
    );
  }
  if (config.agents.default_subagent_model.trim()) {
    lines.push(
      `default_subagent_model = ${quoteToml(config.agents.default_subagent_model.trim())}`
    );
  }
  if (config.agents.default_subagent_reasoning_effort) {
    lines.push(
      `default_subagent_reasoning_effort = ${quoteToml(config.agents.default_subagent_reasoning_effort)}`
    );
  }

  return `${lines.join("\n")}\n`;
}

function parseMainCodexConfig(content: string): MainCodexAgentConfig {
  const root = topLevelContent(content);
  const sandbox = sectionContent(content, "sandbox_workspace_write");
  const agents = sectionContent(content, "agents");
  const effort = readString(root, "model_reasoning_effort");
  const summary = readString(root, "model_reasoning_summary");
  const verbosity = readString(root, "model_verbosity");
  const sandboxMode = readString(root, "sandbox_mode");
  const approvalPolicy = readString(root, "approval_policy");
  const defaultSubagentEffort = readString(
    agents,
    "default_subagent_reasoning_effort"
  );

  return {
    model: readString(root, "model") ?? DEFAULT_MAIN_CODEX_CONFIG.model,
    model_reasoning_effort: isEnumValue(effort, CODEX_REASONING_EFFORTS)
      ? effort
      : DEFAULT_MAIN_CODEX_CONFIG.model_reasoning_effort,
    model_reasoning_summary: isEnumValue(summary, CODEX_REASONING_SUMMARIES)
      ? summary
      : DEFAULT_MAIN_CODEX_CONFIG.model_reasoning_summary,
    model_verbosity: isEnumValue(verbosity, CODEX_VERBOSITIES)
      ? verbosity
      : DEFAULT_MAIN_CODEX_CONFIG.model_verbosity,
    sandbox_mode: isEnumValue(sandboxMode, CODEX_SANDBOX_MODES)
      ? sandboxMode
      : DEFAULT_MAIN_CODEX_CONFIG.sandbox_mode,
    approval_policy: isEnumValue(approvalPolicy, CODEX_APPROVAL_POLICIES)
      ? approvalPolicy
      : DEFAULT_MAIN_CODEX_CONFIG.approval_policy,
    sandbox_workspace_write: {
      network_access:
        readBoolean(sandbox, "network_access") ??
        DEFAULT_MAIN_CODEX_CONFIG.sandbox_workspace_write.network_access,
    },
    agents: {
      enabled:
        readBoolean(agents, "enabled") ?? DEFAULT_MAIN_CODEX_CONFIG.agents.enabled,
      max_concurrent_threads_per_session:
        readInteger(agents, "max_concurrent_threads_per_session") ?? null,
      default_subagent_model:
        readString(agents, "default_subagent_model") ?? "",
      default_subagent_reasoning_effort: isEnumValue(
        defaultSubagentEffort,
        CODEX_REASONING_EFFORTS
      )
        ? defaultSubagentEffort
        : "",
      interrupt_message:
        readBoolean(agents, "interrupt_message") ??
        DEFAULT_MAIN_CODEX_CONFIG.agents.interrupt_message,
    },
  };
}

function serializeSubagent(config: CodexSubagentConfig): string {
  const lines = [
    `name = ${quoteToml(config.name)}`,
    `description = ${quoteToml(config.description)}`,
    `developer_instructions = ${quoteToml(config.developer_instructions)}`,
  ];

  if (config.model) lines.push(`model = ${quoteToml(config.model)}`);
  if (config.model_reasoning_effort) {
    lines.push(
      `model_reasoning_effort = ${quoteToml(config.model_reasoning_effort)}`
    );
  }
  if (config.sandbox_mode) {
    lines.push(`sandbox_mode = ${quoteToml(config.sandbox_mode)}`);
  }

  return `${lines.join("\n")}\n`;
}

function parseSubagent(content: string, id: string): CodexSubagentConfig {
  const root = topLevelContent(content);
  const name = readString(root, "name");
  const description = readString(root, "description");
  const developerInstructions = readString(root, "developer_instructions");
  if (!name || !description || !developerInstructions) {
    throw new ValidationError(
      `Invalid subagent file "${id}.toml": name, description, and developer_instructions are required.`
    );
  }

  const effort = readString(root, "model_reasoning_effort");
  const sandboxMode = readString(root, "sandbox_mode");
  return {
    id,
    name,
    description,
    developer_instructions: developerInstructions,
    model: readString(root, "model") ?? "",
    model_reasoning_effort: isEnumValue(effort, CODEX_REASONING_EFFORTS)
      ? effort
      : "",
    sandbox_mode: isEnumValue(sandboxMode, CODEX_SANDBOX_MODES)
      ? sandboxMode
      : "",
    filePath: `.tasker/agents/${id}.toml`,
  };
}

function validateMainConfig(input: unknown): MainCodexAgentConfig {
  if (!input || typeof input !== "object") {
    throw new ValidationError("Main Codex configuration is required.");
  }
  const config = input as Partial<MainCodexAgentConfig>;
  const agents = config.agents;
  if (!agents || typeof agents !== "object") {
    throw new ValidationError("Subagent defaults are required.");
  }
  const maxThreads = agents.max_concurrent_threads_per_session;
  if (
    maxThreads !== null &&
    (!Number.isSafeInteger(maxThreads) || Number(maxThreads) < 1)
  ) {
    throw new ValidationError(
      "max_concurrent_threads_per_session must be empty or an integer of at least 1."
    );
  }
  if (typeof agents.enabled !== "boolean" || typeof agents.interrupt_message !== "boolean") {
    throw new ValidationError("Subagent boolean settings are invalid.");
  }
  if (
    agents.default_subagent_reasoning_effort &&
    !CODEX_REASONING_EFFORTS.includes(
      agents.default_subagent_reasoning_effort as CodexReasoningEffort
    )
  ) {
    throw new ValidationError("Invalid default subagent reasoning effort.");
  }
  if (
    !config.sandbox_workspace_write ||
    typeof config.sandbox_workspace_write.network_access !== "boolean"
  ) {
    throw new ValidationError("Workspace network access must be a boolean.");
  }

  return {
    model: validateString(config.model, "model", false),
    model_reasoning_effort: validateEnum(
      config.model_reasoning_effort,
      "model_reasoning_effort",
      CODEX_REASONING_EFFORTS
    ) as CodexReasoningEffort,
    model_reasoning_summary: validateEnum(
      config.model_reasoning_summary,
      "model_reasoning_summary",
      CODEX_REASONING_SUMMARIES
    ) as CodexReasoningSummary,
    model_verbosity: validateEnum(
      config.model_verbosity,
      "model_verbosity",
      CODEX_VERBOSITIES
    ) as CodexVerbosity,
    sandbox_mode: validateEnum(
      config.sandbox_mode,
      "sandbox_mode",
      CODEX_SANDBOX_MODES
    ) as CodexSandboxMode,
    approval_policy: validateEnum(
      config.approval_policy,
      "approval_policy",
      CODEX_APPROVAL_POLICIES
    ) as CodexApprovalPolicy,
    sandbox_workspace_write: {
      network_access: config.sandbox_workspace_write.network_access,
    },
    agents: {
      enabled: agents.enabled,
      max_concurrent_threads_per_session: maxThreads,
      default_subagent_model: validateString(
        agents.default_subagent_model,
        "default_subagent_model",
        false
      ),
      default_subagent_reasoning_effort:
        agents.default_subagent_reasoning_effort,
      interrupt_message: agents.interrupt_message,
    },
  };
}

function validateSubagentInput(input: unknown): Omit<CodexSubagentConfig, "id" | "filePath"> {
  if (!input || typeof input !== "object") {
    throw new ValidationError("Subagent configuration is required.");
  }
  const config = input as Partial<CodexSubagentConfig>;
  const effort = config.model_reasoning_effort ?? "";
  const sandboxMode = config.sandbox_mode ?? "";
  if (effort && !CODEX_REASONING_EFFORTS.includes(effort as CodexReasoningEffort)) {
    throw new ValidationError("Invalid subagent model_reasoning_effort.");
  }
  if (sandboxMode && !CODEX_SANDBOX_MODES.includes(sandboxMode as CodexSandboxMode)) {
    throw new ValidationError("Invalid subagent sandbox_mode.");
  }

  return {
    name: validateString(config.name, "name"),
    description: validateString(config.description, "description"),
    developer_instructions: validateString(
      config.developer_instructions,
      "developer_instructions"
    ),
    model: validateString(config.model ?? "", "model", false),
    model_reasoning_effort: effort,
    sandbox_mode: sandboxMode,
  };
}

function slugifyAgentName(name: string): string {
  const slug = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "");
  return slug || "subagent";
}

function atomicWrite(filePath: string, content: string): void {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tempPath, content, "utf8");
    fs.renameSync(tempPath, filePath);
  } finally {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
  }
}

export class AgentsService {
  private async resolveAgentsDirectory(projectId: string): Promise<string> {
    const project = await projectService.getProjectById(projectId);
    if (!project.repositoryPath?.trim()) {
      throw new ValidationError("NO_REPOSITORY: Configure the project repository in Settings first.");
    }
    const taskerDirectory = path.join(
      path.resolve(project.repositoryPath.trim()),
      ".tasker"
    );
    if (!fs.existsSync(taskerDirectory) || !fs.statSync(taskerDirectory).isDirectory()) {
      throw new ValidationError("NOT_INITIALIZED: Initialize Tasker in Settings first.");
    }
    return path.join(taskerDirectory, "agents");
  }

  async getAgents(projectId: string): Promise<{
    main: MainCodexAgentConfig;
    mainFileExists: boolean;
    subagents: CodexSubagentConfig[];
  }> {
    const agentsDirectory = await this.resolveAgentsDirectory(projectId);
    const mainPath = path.join(agentsDirectory, "main.toml");
    const mainFileExists = fs.existsSync(mainPath);
    const main = mainFileExists
      ? parseMainCodexConfig(fs.readFileSync(mainPath, "utf8"))
      : structuredClone(DEFAULT_MAIN_CODEX_CONFIG);

    if (!fs.existsSync(agentsDirectory)) {
      return { main, mainFileExists, subagents: [] };
    }

    const subagents = fs
      .readdirSync(agentsDirectory, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isFile() && entry.name.endsWith(".toml") && entry.name !== "main.toml"
      )
      .map((entry) => {
        const id = entry.name.slice(0, -".toml".length);
        return parseSubagent(
          fs.readFileSync(path.join(agentsDirectory, entry.name), "utf8"),
          id
        );
      })
      .sort((left, right) => left.name.localeCompare(right.name));

    return { main, mainFileExists, subagents };
  }

  async updateMainAgent(projectId: string, input: unknown): Promise<MainCodexAgentConfig> {
    const config = validateMainConfig(input);
    const agentsDirectory = await this.resolveAgentsDirectory(projectId);
    fs.mkdirSync(agentsDirectory, { recursive: true });
    atomicWrite(
      path.join(agentsDirectory, "main.toml"),
      serializeMainCodexConfig(config)
    );
    return config;
  }

  async createSubagent(projectId: string, input: unknown): Promise<CodexSubagentConfig> {
    const config = validateSubagentInput(input);
    const agentsDirectory = await this.resolveAgentsDirectory(projectId);
    fs.mkdirSync(agentsDirectory, { recursive: true });
    const existing = await this.getAgents(projectId);
    if (existing.subagents.some((agent) => agent.name.toLowerCase() === config.name.toLowerCase())) {
      throw new ConflictError(`A subagent named "${config.name}" already exists.`);
    }
    const baseId = slugifyAgentName(config.name);
    let id = baseId;
    let suffix = 2;
    while (fs.existsSync(path.join(agentsDirectory, `${id}.toml`)) || id === "main") {
      id = `${baseId}-${suffix}`;
      suffix += 1;
    }
    const subagent: CodexSubagentConfig = {
      id,
      ...config,
      filePath: `.tasker/agents/${id}.toml`,
    };
    atomicWrite(path.join(agentsDirectory, `${id}.toml`), serializeSubagent(subagent));
    return subagent;
  }

  async updateSubagent(
    projectId: string,
    agentId: string,
    input: unknown
  ): Promise<CodexSubagentConfig> {
    if (!AGENT_ID_PATTERN.test(agentId) || agentId === "main") {
      throw new ValidationError("Invalid subagent ID.");
    }
    const config = validateSubagentInput(input);
    const agentsDirectory = await this.resolveAgentsDirectory(projectId);
    const filePath = path.join(agentsDirectory, `${agentId}.toml`);
    if (!fs.existsSync(filePath)) {
      throw new NotFoundError(`Subagent "${agentId}" was not found.`);
    }
    const existing = await this.getAgents(projectId);
    if (
      existing.subagents.some(
        (agent) =>
          agent.id !== agentId && agent.name.toLowerCase() === config.name.toLowerCase()
      )
    ) {
      throw new ConflictError(`A subagent named "${config.name}" already exists.`);
    }
    const subagent: CodexSubagentConfig = {
      id: agentId,
      ...config,
      filePath: `.tasker/agents/${agentId}.toml`,
    };
    atomicWrite(filePath, serializeSubagent(subagent));
    return subagent;
  }

  async deleteSubagent(projectId: string, agentId: string): Promise<void> {
    if (!AGENT_ID_PATTERN.test(agentId) || agentId === "main") {
      throw new ValidationError("Invalid subagent ID.");
    }
    const agentsDirectory = await this.resolveAgentsDirectory(projectId);
    const filePath = path.join(agentsDirectory, `${agentId}.toml`);
    if (!fs.existsSync(filePath)) {
      throw new NotFoundError(`Subagent "${agentId}" was not found.`);
    }
    fs.unlinkSync(filePath);
  }
}

export const agentsService = new AgentsService();

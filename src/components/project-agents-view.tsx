"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { type Project } from "@db/schema";
import {
  CODEX_APPROVAL_POLICIES,
  CODEX_REASONING_EFFORTS,
  CODEX_REASONING_SUMMARIES,
  CODEX_SANDBOX_MODES,
  CODEX_VERBOSITIES,
  type CodexAgentsResponse,
  type CodexModelOption,
  type CodexReasoningEffort,
  type CodexSandboxMode,
  type CodexSubagentConfig,
  type MainCodexAgentConfig,
} from "@/types/codex-agents";
import {
  Frame,
  FrameDescription,
  FrameHeader,
  FramePanel,
  FrameTitle,
} from "@/components/reui/frame";
import { Badge } from "@/components/reui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  AlertCircleIcon,
  BotIcon,
  CheckCircle2Icon,
  Loader2Icon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  SaveIcon,
  SettingsIcon,
  Trash2Icon,
} from "lucide-react";

interface ProjectAgentsViewProps {
  project: Project;
  onNavigateToSettings?: () => void;
}

type LoadErrorCode =
  | "NO_REPOSITORY"
  | "NOT_INITIALIZED"
  | "FETCH_ERROR"
  | null;

type SubagentDraft = Omit<CodexSubagentConfig, "id" | "filePath">;

const INHERIT_VALUE = "__codex_inherit__";

const EMPTY_SUBAGENT: SubagentDraft = {
  name: "",
  description: "",
  developer_instructions: "",
  model: "",
  model_reasoning_effort: "",
  sandbox_mode: "",
};

function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid items-start gap-2 px-4 py-3 sm:grid-cols-[minmax(10rem,0.95fr)_minmax(0,1.35fr)] sm:items-center sm:gap-5">
      <dt className="text-muted-foreground text-sm font-medium">{label}</dt>
      <dd className="flex min-w-0 flex-col gap-1.5 text-sm">
        {children}
        {description && (
          <p className="text-xs leading-relaxed text-muted-foreground">
            {description}
          </p>
        )}
      </dd>
    </div>
  );
}

function BooleanControl({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <label className="flex w-fit cursor-pointer items-center gap-2 text-sm disabled:cursor-not-allowed">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        disabled={disabled}
        className="size-4 rounded border-input accent-primary disabled:cursor-not-allowed disabled:opacity-50"
      />
      <span className={disabled ? "text-muted-foreground" : "text-foreground"}>
        {label}
      </span>
    </label>
  );
}

function ModelInput({
  id,
  value,
  onChange,
  models,
  placeholder = "Codex default (not pinned)",
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  models: CodexModelOption[];
  placeholder?: string;
}) {
  const listId = `${id}-models`;
  return (
    <>
      <Input
        id={id}
        list={models.length ? listId : undefined}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="max-w-md font-mono text-xs"
        autoComplete="off"
      />
      {models.length > 0 && (
        <datalist id={listId}>
          {models.map((model) => (
            <option key={model.id} value={model.model}>
              {model.displayName}
            </option>
          ))}
        </datalist>
      )}
    </>
  );
}

function EnumSelect({
  value,
  options,
  onChange,
  allowInherit = false,
}: {
  value: string;
  options: readonly string[];
  onChange: (value: string) => void;
  allowInherit?: boolean;
}) {
  const selectedValue = allowInherit && !value ? INHERIT_VALUE : value;
  return (
    <Select
      value={selectedValue}
      onValueChange={(nextValue) => {
        if (nextValue) {
          onChange(nextValue === INHERIT_VALUE ? "" : nextValue);
        }
      }}
    >
      <SelectTrigger className="w-full max-w-xs font-mono text-xs">
        <SelectValue>{value || "Inherit from Codex"}</SelectValue>
      </SelectTrigger>
      <SelectContent align="start" alignItemWithTrigger={false}>
        <SelectGroup>
          {allowInherit && (
            <SelectItem value={INHERIT_VALUE}>Inherit from Codex</SelectItem>
          )}
          {options.map((option) => (
            <SelectItem key={option} value={option} className="font-mono text-xs">
              {option}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <Frame stacked spacing="sm" className="w-full">
      <FrameHeader>
        <FrameTitle>Agents</FrameTitle>
        <FrameDescription>
          Native OpenAI Codex configuration for this project.
        </FrameDescription>
      </FrameHeader>
      <FramePanel className="flex flex-col items-center justify-center gap-4 p-10 text-center">
        <div className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
          <AlertCircleIcon className="size-6" />
        </div>
        <div className="flex max-w-md flex-col gap-1">
          <h3 className="text-sm font-medium">{title}</h3>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        {action}
      </FramePanel>
    </Frame>
  );
}

export function ProjectAgentsView({
  project,
  onNavigateToSettings,
}: ProjectAgentsViewProps) {
  const [main, setMain] = useState<MainCodexAgentConfig | null>(null);
  const [savedMain, setSavedMain] = useState<MainCodexAgentConfig | null>(null);
  const [mainFileExists, setMainFileExists] = useState(false);
  const [mainFilePath, setMainFilePath] = useState(".tasker/agents/main.toml");
  const [subagents, setSubagents] = useState<CodexSubagentConfig[]>([]);
  const [models, setModels] = useState<CodexModelOption[]>([]);
  const [modelDiscoveryError, setModelDiscoveryError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<LoadErrorCode>(null);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<CodexSubagentConfig | null>(null);
  const [draft, setDraft] = useState<SubagentDraft>(EMPTY_SUBAGENT);
  const [isSavingSubagent, setIsSavingSubagent] = useState(false);
  const [subagentError, setSubagentError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<CodexSubagentConfig | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const fetchAgents = useCallback(async () => {
    if (!project.repositoryPath) {
      setErrorCode("NO_REPOSITORY");
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setError(null);
    setErrorCode(null);
    try {
      const response = await fetch(`/api/projects/${project.id}/agents`);
      const data = (await response.json()) as CodexAgentsResponse & {
        code?: LoadErrorCode;
        error?: string;
      };
      if (!response.ok) {
        if (data.code === "NO_REPOSITORY" || data.code === "NOT_INITIALIZED") {
          setErrorCode(data.code);
          return;
        }
        throw new Error(data.error || "Unable to load Codex agent configuration.");
      }
      setMain(data.main);
      setSavedMain(structuredClone(data.main));
      setMainFileExists(data.mainFileExists);
      setMainFilePath(data.mainFilePath);
      setSubagents(data.subagents);
      setModels(data.models);
      setModelDiscoveryError(data.modelDiscoveryError);
    } catch (loadError: unknown) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Unable to load Codex agent configuration."
      );
      setErrorCode("FETCH_ERROR");
    } finally {
      setIsLoading(false);
    }
  }, [project.id, project.repositoryPath]);

  useEffect(() => {
    // Initial synchronization with the repository-owned .tasker configuration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchAgents();
  }, [fetchAgents]);

  const mainSettingsDirty = useMemo(() => {
    if (!main || !savedMain) return false;
    const mainFields = ({
      model: main.model,
      model_reasoning_effort: main.model_reasoning_effort,
      model_reasoning_summary: main.model_reasoning_summary,
      model_verbosity: main.model_verbosity,
      sandbox_mode: main.sandbox_mode,
      approval_policy: main.approval_policy,
      sandbox_workspace_write: main.sandbox_workspace_write,
    });
    const savedFields = ({
      model: savedMain.model,
      model_reasoning_effort: savedMain.model_reasoning_effort,
      model_reasoning_summary: savedMain.model_reasoning_summary,
      model_verbosity: savedMain.model_verbosity,
      sandbox_mode: savedMain.sandbox_mode,
      approval_policy: savedMain.approval_policy,
      sandbox_workspace_write: savedMain.sandbox_workspace_write,
    });
    return JSON.stringify(mainFields) !== JSON.stringify(savedFields);
  }, [main, savedMain]);

  const subagentDefaultsDirty = useMemo(
    () =>
      Boolean(
        main &&
          savedMain &&
          JSON.stringify(main.agents) !== JSON.stringify(savedMain.agents)
      ),
    [main, savedMain]
  );

  const supportedMainEfforts = useMemo(() => {
    const selected = models.find((model) => model.model === main?.model);
    return selected?.supportedReasoningEfforts.length
      ? selected.supportedReasoningEfforts.map((entry) => entry.reasoningEffort)
      : CODEX_REASONING_EFFORTS;
  }, [main?.model, models]);

  const saveMain = async () => {
    if (!main) return;
    setIsSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/projects/${project.id}/agents`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ main }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Unable to save Codex configuration.");
      }
      setMain(data.main);
      setSavedMain(structuredClone(data.main));
      setMainFileExists(true);
      setLastSavedAt(new Date());
      toast.success("Codex agent configuration saved.");
    } catch (saveError: unknown) {
      const message =
        saveError instanceof Error
          ? saveError.message
          : "Unable to save Codex configuration.";
      setError(message);
      toast.error(message);
    } finally {
      setIsSaving(false);
    }
  };

  const openCreateDialog = () => {
    setEditingAgent(null);
    setDraft(EMPTY_SUBAGENT);
    setSubagentError(null);
    setDialogOpen(true);
  };

  const openEditDialog = (agent: CodexSubagentConfig) => {
    setEditingAgent(agent);
    setDraft({
      name: agent.name,
      description: agent.description,
      developer_instructions: agent.developer_instructions,
      model: agent.model,
      model_reasoning_effort: agent.model_reasoning_effort,
      sandbox_mode: agent.sandbox_mode,
    });
    setSubagentError(null);
    setDialogOpen(true);
  };

  const saveSubagent = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubagentError(null);
    if (!draft.name.trim() || !draft.description.trim() || !draft.developer_instructions.trim()) {
      setSubagentError("Name, description, and developer instructions are required.");
      return;
    }
    setIsSavingSubagent(true);
    try {
      const endpoint = editingAgent
        ? `/api/projects/${project.id}/agents/${encodeURIComponent(editingAgent.id)}`
        : `/api/projects/${project.id}/agents`;
      const response = await fetch(endpoint, {
        method: editingAgent ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subagent: draft }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Unable to save the subagent.");
      }
      setSubagents((current) => {
        const next = editingAgent
          ? current.map((agent) =>
              agent.id === editingAgent.id ? data.subagent : agent
            )
          : [...current, data.subagent];
        return next.sort((left, right) => left.name.localeCompare(right.name));
      });
      setDialogOpen(false);
      toast.success(editingAgent ? "Subagent updated." : "Subagent created.");
    } catch (saveError: unknown) {
      setSubagentError(
        saveError instanceof Error ? saveError.message : "Unable to save the subagent."
      );
    } finally {
      setIsSavingSubagent(false);
    }
  };

  const deleteSubagent = async () => {
    if (!pendingDelete) return;
    setIsDeleting(true);
    try {
      const response = await fetch(
        `/api/projects/${project.id}/agents/${encodeURIComponent(pendingDelete.id)}`,
        { method: "DELETE" }
      );
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Unable to delete the subagent.");
      }
      setSubagents((current) =>
        current.filter((agent) => agent.id !== pendingDelete.id)
      );
      toast.success(`Subagent "${pendingDelete.name}" deleted.`);
      setPendingDelete(null);
    } catch (deleteError: unknown) {
      toast.error(
        deleteError instanceof Error
          ? deleteError.message
          : "Unable to delete the subagent."
      );
    } finally {
      setIsDeleting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="mx-auto w-full max-w-4xl">
        <Frame stacked spacing="sm">
          <FrameHeader>
            <FrameTitle>Agents</FrameTitle>
            <FrameDescription>
              Native OpenAI Codex configuration for this project.
            </FrameDescription>
          </FrameHeader>
          <FramePanel className="flex items-center justify-center gap-2 p-12 text-sm text-muted-foreground">
            <Loader2Icon className="size-5 animate-spin text-primary" />
            Loading Codex configuration...
          </FramePanel>
        </Frame>
      </div>
    );
  }

  if (errorCode === "NO_REPOSITORY" || !project.repositoryPath) {
    return (
      <div className="mx-auto w-full max-w-4xl">
        <EmptyState
          title="Repository not configured"
          description="Configure the project repository in Settings before editing Codex agents."
          action={
            onNavigateToSettings ? (
              <Button variant="outline" onClick={onNavigateToSettings}>
                <SettingsIcon className="size-4" />
                Open project settings
              </Button>
            ) : undefined
          }
        />
      </div>
    );
  }

  if (errorCode === "NOT_INITIALIZED") {
    return (
      <div className="mx-auto w-full max-w-4xl">
        <EmptyState
          title="Tasker not initialized"
          description="Initialize Tasker in Settings before creating the versioned Codex configuration."
          action={
            onNavigateToSettings ? (
              <Button variant="outline" onClick={onNavigateToSettings}>
                <SettingsIcon className="size-4" />
                Open project settings
              </Button>
            ) : undefined
          }
        />
      </div>
    );
  }

  if (errorCode === "FETCH_ERROR" || !main) {
    return (
      <div className="mx-auto w-full max-w-4xl">
        <EmptyState
          title="Unable to load agents"
          description={error || "The Codex configuration could not be read."}
          action={
            <Button variant="outline" onClick={fetchAgents}>
              <RefreshCwIcon className="size-4" />
              Retry
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6">
      <Frame stacked spacing="sm" className="w-full">
        <FrameHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-col gap-0.5">
            <FrameTitle>Agent principal</FrameTitle>
            <FrameDescription>
              Codex defaults used by future Tasks in this project.
            </FrameDescription>
          </div>
          <div className="flex items-center gap-2">
            {(mainSettingsDirty || !mainFileExists) && (
              <Badge variant="warning-light" className="text-xs">
                Unsaved changes
              </Badge>
            )}
            {lastSavedAt && !mainSettingsDirty && mainFileExists && (
              <Badge variant="success-light" className="gap-1 text-xs">
                <CheckCircle2Icon className="size-3" />
                Saved
              </Badge>
            )}
            <Button
              type="button"
              onClick={saveMain}
              disabled={isSaving || (!mainSettingsDirty && mainFileExists)}
            >
              {isSaving ? (
                <Loader2Icon className="size-4 animate-spin" />
              ) : (
                <SaveIcon className="size-4" />
              )}
              Save
            </Button>
          </div>
        </FrameHeader>
        <FramePanel className="p-0">
          {error && (
            <div className="m-4 flex items-center gap-2 rounded-lg bg-destructive/10 p-3 text-xs text-destructive">
              <AlertCircleIcon className="size-4 shrink-0" />
              {error}
            </div>
          )}
          <dl className="flex flex-col">
            <SettingRow
              label="Model"
              description={
                models.length
                  ? "Suggestions come from the local Codex model/list API. You can still enter another Codex model slug."
                  : "Enter a Codex model slug, or leave it empty to use the local Codex default."
              }
            >
              <ModelInput
                id="main-agent-model"
                value={main.model}
                onChange={(model) => setMain((current) => current && { ...current, model })}
                models={models}
              />
              {modelDiscoveryError && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Local model discovery unavailable: {modelDiscoveryError}
                </p>
              )}
            </SettingRow>
            <Separator />
            <SettingRow
              label="Reasoning effort"
              description="Native model_reasoning_effort value. xhigh remains model-dependent."
            >
              <EnumSelect
                value={main.model_reasoning_effort}
                options={supportedMainEfforts}
                onChange={(value) =>
                  setMain((current) =>
                    current && {
                      ...current,
                      model_reasoning_effort: value as CodexReasoningEffort,
                    }
                  )
                }
              />
            </SettingRow>
            <Separator />
            <SettingRow label="Reasoning summary" description="Controls model_reasoning_summary.">
              <EnumSelect
                value={main.model_reasoning_summary}
                options={CODEX_REASONING_SUMMARIES}
                onChange={(value) =>
                  setMain((current) =>
                    current && {
                      ...current,
                      model_reasoning_summary:
                        value as MainCodexAgentConfig["model_reasoning_summary"],
                    }
                  )
                }
              />
            </SettingRow>
            <Separator />
            <SettingRow label="Verbosity" description="Controls model_verbosity for supported models.">
              <EnumSelect
                value={main.model_verbosity}
                options={CODEX_VERBOSITIES}
                onChange={(value) =>
                  setMain((current) =>
                    current && {
                      ...current,
                      model_verbosity: value as MainCodexAgentConfig["model_verbosity"],
                    }
                  )
                }
              />
            </SettingRow>
            <Separator />
            <SettingRow label="Sandbox mode" description="Filesystem and command execution sandbox used by Codex.">
              <EnumSelect
                value={main.sandbox_mode}
                options={CODEX_SANDBOX_MODES}
                onChange={(value) =>
                  setMain((current) =>
                    current && {
                      ...current,
                      sandbox_mode: value as CodexSandboxMode,
                    }
                  )
                }
              />
            </SettingRow>
            <Separator />
            <SettingRow
              label="Approval policy"
              description="Only current simple Codex policies are offered. on-failure and untrusted are not supported."
            >
              <EnumSelect
                value={main.approval_policy}
                options={CODEX_APPROVAL_POLICIES}
                onChange={(value) =>
                  setMain((current) =>
                    current && {
                      ...current,
                      approval_policy:
                        value as MainCodexAgentConfig["approval_policy"],
                    }
                  )
                }
              />
            </SettingRow>
            <Separator />
            <SettingRow
              label="Workspace network"
              description="Writes sandbox_workspace_write.network_access and only applies in workspace-write mode."
            >
              <BooleanControl
                checked={main.sandbox_workspace_write.network_access}
                disabled={main.sandbox_mode !== "workspace-write"}
                onChange={(networkAccess) =>
                  setMain((current) =>
                    current && {
                      ...current,
                      sandbox_workspace_write: { network_access: networkAccess },
                    }
                  )
                }
                label="Allow outbound network access"
              />
            </SettingRow>
          </dl>
          <div className="flex items-center gap-2 border-t px-4 py-3 text-xs text-muted-foreground">
            <span>File:</span>
            <code className="rounded bg-muted px-2 py-0.5 font-mono text-foreground">
              {mainFilePath}
            </code>
          </div>
        </FramePanel>
      </Frame>

      <Frame stacked spacing="sm" className="w-full">
        <FrameHeader className="gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-col gap-0.5">
            <div className="flex items-center gap-2">
              <FrameTitle>Sous-agents</FrameTitle>
              <Badge variant="outline" className="text-xs">
                {subagents.length}
              </Badge>
            </div>
            <FrameDescription>
              Native Codex subagent defaults and project-scoped custom agents.
            </FrameDescription>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={saveMain}
              disabled={isSaving || !subagentDefaultsDirty}
            >
              {isSaving ? (
                <Loader2Icon className="size-4 animate-spin" />
              ) : (
                <SaveIcon className="size-4" />
              )}
              Save defaults
            </Button>
            <Button type="button" onClick={openCreateDialog}>
              <PlusIcon className="size-4" />
              Add subagent
            </Button>
          </div>
        </FrameHeader>

        <FramePanel className="p-0">
          <dl className="flex flex-col">
            <SettingRow label="Multi-agent tools" description="Controls agents.enabled. Codex defaults to enabled when unset.">
              <BooleanControl
                checked={main.agents.enabled}
                onChange={(enabled) =>
                  setMain((current) =>
                    current && { ...current, agents: { ...current.agents, enabled } }
                  )
                }
                label="Enable subagents"
              />
            </SettingRow>
            <Separator />
            <SettingRow
              label="Concurrency"
              description="Maximum open spawned-agent threads per session, excluding the primary. Leave empty for the Codex default."
            >
              <Input
                type="number"
                min={1}
                value={main.agents.max_concurrent_threads_per_session ?? ""}
                onChange={(event) =>
                  setMain((current) =>
                    current && {
                      ...current,
                      agents: {
                        ...current.agents,
                        max_concurrent_threads_per_session: event.target.value
                          ? Number.parseInt(event.target.value, 10)
                          : null,
                      },
                    }
                  )
                }
                placeholder="Codex default"
                className="w-40 font-mono text-xs"
              />
            </SettingRow>
            <Separator />
            <SettingRow label="Default subagent model" description="Controls agents.default_subagent_model. Explicit spawn values and custom-agent files take precedence.">
              <ModelInput
                id="default-subagent-model"
                value={main.agents.default_subagent_model}
                onChange={(defaultSubagentModel) =>
                  setMain((current) =>
                    current && {
                      ...current,
                      agents: {
                        ...current.agents,
                        default_subagent_model: defaultSubagentModel,
                      },
                    }
                  )
                }
                models={models}
              />
            </SettingRow>
            <Separator />
            <SettingRow label="Default reasoning" description="Controls agents.default_subagent_reasoning_effort. Leave unset to inherit Codex resolution rules.">
              <EnumSelect
                value={main.agents.default_subagent_reasoning_effort}
                options={CODEX_REASONING_EFFORTS}
                allowInherit
                onChange={(value) =>
                  setMain((current) =>
                    current && {
                      ...current,
                      agents: {
                        ...current.agents,
                        default_subagent_reasoning_effort:
                          value as CodexReasoningEffort | "",
                      },
                    }
                  )
                }
              />
            </SettingRow>
            <Separator />
            <SettingRow label="Interruption message" description="Controls agents.interrupt_message. Codex defaults to enabled.">
              <BooleanControl
                checked={main.agents.interrupt_message}
                onChange={(interruptMessage) =>
                  setMain((current) =>
                    current && {
                      ...current,
                      agents: {
                        ...current.agents,
                        interrupt_message: interruptMessage,
                      },
                    }
                  )
                }
                label="Record a model-visible interruption message"
              />
            </SettingRow>
          </dl>
        </FramePanel>

        <FramePanel className="p-0">
          {subagents.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 p-8 text-center">
              <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <BotIcon className="size-5" />
              </div>
              <div>
                <p className="text-sm font-medium">No custom subagents</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Codex still provides its built-in default, worker, and explorer agents.
                </p>
              </div>
              <Button type="button" variant="outline" onClick={openCreateDialog}>
                <PlusIcon className="size-4" />
                Create a custom subagent
              </Button>
            </div>
          ) : (
            <div className="divide-y">
              {subagents.map((agent) => (
                <div
                  key={agent.id}
                  className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between"
                >
                  <div className="flex min-w-0 gap-3">
                    <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
                      <BotIcon className="size-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium">{agent.name}</p>
                        {agent.model && (
                          <Badge variant="outline" className="font-mono text-[0.7rem]">
                            {agent.model}
                          </Badge>
                        )}
                        {agent.sandbox_mode && (
                          <Badge variant="outline" className="font-mono text-[0.7rem]">
                            {agent.sandbox_mode}
                          </Badge>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {agent.description}
                      </p>
                      <code className="mt-2 block truncate font-mono text-xs text-muted-foreground">
                        {agent.filePath}
                      </code>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1 self-end sm:self-start">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => openEditDialog(agent)}
                      aria-label={`Edit ${agent.name}`}
                    >
                      <PencilIcon className="size-4" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="text-destructive hover:text-destructive"
                      onClick={() => setPendingDelete(agent)}
                      aria-label={`Delete ${agent.name}`}
                    >
                      <Trash2Icon className="size-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </FramePanel>
      </Frame>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <form onSubmit={saveSubagent} className="flex flex-col gap-4">
            <DialogHeader>
              <DialogTitle>
                {editingAgent ? "Edit subagent" : "Add subagent"}
              </DialogTitle>
              <DialogDescription>
                Creates a project-scoped Codex custom agent using the native TOML field names.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                Name
                <Input
                  value={draft.name}
                  onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
                  placeholder="reviewer"
                  autoFocus
                />
              </label>
              <label className="flex flex-col gap-1.5 text-sm font-medium">
                Model override
                <ModelInput
                  id="subagent-model"
                  value={draft.model}
                  onChange={(model) => setDraft((current) => ({ ...current, model }))}
                  models={models}
                  placeholder="Inherit from parent"
                />
              </label>
            </div>

            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Description
              <Input
                value={draft.description}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, description: event.target.value }))
                }
                placeholder="When Codex should delegate work to this agent."
              />
            </label>

            <label className="flex flex-col gap-1.5 text-sm font-medium">
              Developer instructions
              <Textarea
                value={draft.developer_instructions}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    developer_instructions: event.target.value,
                  }))
                }
                placeholder="Define the agent's narrow role, constraints, and expected output."
                rows={8}
                className="min-h-44 font-mono text-xs leading-relaxed"
              />
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5 text-sm font-medium">
                Reasoning effort
                <EnumSelect
                  value={draft.model_reasoning_effort}
                  options={CODEX_REASONING_EFFORTS}
                  allowInherit
                  onChange={(value) =>
                    setDraft((current) => ({
                      ...current,
                      model_reasoning_effort: value as CodexReasoningEffort | "",
                    }))
                  }
                />
              </div>
              <div className="flex flex-col gap-1.5 text-sm font-medium">
                Sandbox mode
                <EnumSelect
                  value={draft.sandbox_mode}
                  options={CODEX_SANDBOX_MODES}
                  allowInherit
                  onChange={(value) =>
                    setDraft((current) => ({
                      ...current,
                      sandbox_mode: value as CodexSandboxMode | "",
                    }))
                  }
                />
              </div>
            </div>

            {subagentError && (
              <div className="flex items-center gap-2 rounded-lg bg-destructive/10 p-3 text-xs text-destructive">
                <AlertCircleIcon className="size-4 shrink-0" />
                {subagentError}
              </div>
            )}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
                disabled={isSavingSubagent}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isSavingSubagent}>
                {isSavingSubagent && <Loader2Icon className="size-4 animate-spin" />}
                {editingAgent ? "Save changes" : "Create subagent"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(pendingDelete)} onOpenChange={(open) => !open && setPendingDelete(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete subagent?</DialogTitle>
            <DialogDescription>
              This permanently removes {pendingDelete?.filePath}. This action cannot be undone from AgentTasker.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDelete(null)} disabled={isDeleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={deleteSubagent} disabled={isDeleting}>
              {isDeleting && <Loader2Icon className="size-4 animate-spin" />}
              Delete subagent
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

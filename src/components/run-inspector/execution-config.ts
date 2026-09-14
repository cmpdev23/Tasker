import type { Run } from "@db/schema";

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : null;
}

export interface ResolvedExecutionConfig {
  model: string | null;
  reasoning: string | null;
  reasoningSummary: string | null;
  verbosity: string | null;
  sandbox: string | null;
  approval: string | null;
  network: boolean | null;
  timeoutMs: number | null;
  expectChanges: boolean | null;
  packageManager: string | null;
  installDependencies: boolean | null;
  installTimeoutMinutes: number | null;
  validationScripts: string[] | null;
  validationTimeoutMinutes: number | null;
  gitRemote: string | null;
  push: boolean | null;
  createPullRequest: boolean | null;
  pullRequestDraft: boolean | null;
  sequencePullRequestStrategy: string | null;
}

export function resolvedExecutionConfig(value: string | null): ResolvedExecutionConfig {
  let root: Record<string, unknown> | null = null;
  try { root = record(value ? JSON.parse(value) : null); }
  catch { /* Historical malformed snapshots remain inspectable. */ }
  const codex = record(root?.codex);
  const workspace = record(codex?.sandbox_workspace_write);
  const execution = record(root?.execution);
  const git = record(root?.git);
  const sequence = record(root?.sequence);
  const validationScripts = Array.isArray(execution?.validationScripts) &&
    execution.validationScripts.every((script) => typeof script === "string")
    ? execution.validationScripts as string[]
    : null;
  return {
    model: stringValue(codex?.model),
    reasoning: stringValue(codex?.model_reasoning_effort),
    reasoningSummary: stringValue(codex?.model_reasoning_summary),
    verbosity: stringValue(codex?.model_verbosity),
    sandbox: stringValue(codex?.sandbox_mode),
    approval: stringValue(codex?.approval_policy),
    network: typeof workspace?.network_access === "boolean" ? workspace.network_access : null,
    timeoutMs: typeof root?.timeoutMs === "number" ? root.timeoutMs : null,
    expectChanges: typeof root?.expectChanges === "boolean" ? root.expectChanges : null,
    packageManager: stringValue(execution?.packageManager),
    installDependencies: typeof execution?.installDependencies === "boolean" ? execution.installDependencies : null,
    installTimeoutMinutes: typeof execution?.installTimeoutMinutes === "number" ? execution.installTimeoutMinutes : null,
    validationScripts,
    validationTimeoutMinutes: typeof execution?.validationTimeoutMinutes === "number" ? execution.validationTimeoutMinutes : null,
    gitRemote: stringValue(git?.remote),
    push: typeof git?.push === "boolean" ? git.push : null,
    createPullRequest: typeof git?.createPullRequest === "boolean" ? git.createPullRequest : null,
    pullRequestDraft: typeof git?.pullRequestDraft === "boolean" ? git.pullRequestDraft : null,
    sequencePullRequestStrategy: stringValue(sequence?.pullRequestStrategy),
  };
}

export function displayModel(value: string | null) {
  if (!value) return "Modèle par défaut";
  return value.split("-").map((part, index) => {
    if (index === 0 && part.toLowerCase() === "gpt") return "GPT";
    if (/^\d+(?:\.\d+)*$/.test(part)) return part;
    return part.charAt(0).toUpperCase() + part.slice(1);
  }).join("-").replace(/-(Sol|Terra|Codex|Astra)$/i, " $1");
}

export function displaySetting(value: string | null) {
  if (!value) return "Non renseigné";
  return value.replaceAll("-", " ").replace(/^./, (character) => character.toUpperCase());
}

export function changedFileCount(diff: string | null) {
  if (!diff) return 0;
  const paths = new Set<string>();
  for (const line of diff.split(/\r?\n/)) {
    const porcelain = line.match(/^(?:[ MADRCU?!]{2})\s+(.+)$/);
    if (porcelain?.[1]) paths.add(porcelain[1].trim());
    const patch = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (patch?.[2]) paths.add(patch[2].trim());
  }
  return paths.size;
}

export function runExecutionRows(run: Run, config = resolvedExecutionConfig(run.resolvedConfig)) {
  return [
    ["Modèle", config.model ? displayModel(config.model) : "Non renseigné"],
    ["Reasoning", displaySetting(config.reasoning)],
    ["Résumé du reasoning", displaySetting(config.reasoningSummary)],
    ["Verbosité", displaySetting(config.verbosity)],
    ["Sandbox", config.sandbox ?? "Non renseigné"],
    ["Approbations", config.approval ?? "Non renseigné"],
    ["Réseau", config.network === true ? "Autorisé" : config.network === false ? "Désactivé" : "Non renseigné"],
    ["Gestionnaire de paquets", config.packageManager ?? "Non renseigné"],
    ["Installation", config.installDependencies === true ? "Activée" : config.installDependencies === false ? "Désactivée" : "Non renseignée"],
    ["Validations", config.validationScripts?.length ? config.validationScripts.join(", ") : "Aucune"],
    ["Délai du Run", config.timeoutMs == null ? "Non renseigné" : `${Math.round(config.timeoutMs / 60_000)} min`],
    ["Délai d’installation", config.installTimeoutMinutes == null ? "Non renseigné" : `${config.installTimeoutMinutes} min`],
    ["Délai par validation", config.validationTimeoutMinutes == null ? "Non renseigné" : `${config.validationTimeoutMinutes} min`],
    ["Remote de publication", config.gitRemote ?? run.baseRemote ?? "Non renseigné"],
    ["Push configuré", config.push === true ? "Activé" : config.push === false ? "Désactivé" : "Non renseigné"],
    ["PR configurée", config.createPullRequest === true
      ? (config.pullRequestDraft === false ? "Activée, prête pour révision" : "Activée en brouillon")
      : config.createPullRequest === false ? "Désactivée" : "Non renseignée"],
    ["Stratégie PR de Sequence", run.kind === "SEQUENCE"
      ? config.sequencePullRequestStrategy === "after_each_step" ? "Une PR empilée par étape avec commit" : "Une PR après toute la Sequence"
      : "Sans objet"],
    ["Base", [run.baseRemote, run.baseBranch].filter(Boolean).join("/") || "Non renseignée"],
    ["Commit de base", run.baseCommit || "Non renseigné"],
    ["Branche du Run", run.runBranch || "Non renseignée"],
    ["Worktree", run.worktreePath || "Non renseigné"],
    ["Code de sortie Codex", run.exitCode == null ? "Non renseigné" : String(run.exitCode)],
    ["Commit produit", run.commitHash || "Aucun"],
    ["Publication", run.pushedAt ? `Poussée le ${run.pushedAt}` : "Non poussée"],
    ["Pull request", run.pullRequestUrl || "Aucune"],
  ] as const;
}

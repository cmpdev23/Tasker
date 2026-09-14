import type { SequenceStepRun } from "@db/schema";
import { RunStatusBadge } from "./run-status-badge";
import { formatRunDate } from "@/components/task-ui-utils";
import { ExternalLinkIcon } from "lucide-react";

export function SequenceProgress({ steps }: { steps: SequenceStepRun[] }) {
  if (!steps.length) return null;
  const completed = steps.filter((step) => step.status === "SUCCESS").length;
  return (
    <section aria-labelledby="sequence-progress-title" className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="sequence-progress-title" className="text-sm font-medium">Progression de la Sequence</h2>
        <span className="text-xs text-muted-foreground">{completed} / {steps.length} réussies</span>
      </div>
      <ol className="divide-y rounded-lg border">
        {steps.map((step) => (
          <li key={step.id} className="flex gap-3 px-3 py-3">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted font-mono text-[11px] text-muted-foreground">
              {String(step.position + 1).padStart(2, "0")}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="break-words text-sm font-medium">{step.stepName}</span>
                <RunStatusBadge status={step.status} />
              </div>
              {(step.startedAt || step.completedAt) && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatRunDate(step.startedAt)}{step.completedAt ? ` → ${formatRunDate(step.completedAt)}` : ""}
                </p>
              )}
              {step.error && <p className="mt-1.5 break-words text-xs text-destructive">{step.error}</p>}
              {step.commitHash && <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">Commit {step.commitHash}</p>}
              {step.publicationBranch && <p className="mt-1 break-all font-mono text-[11px] text-muted-foreground">Branche {step.publicationBranch}</p>}
              {step.pullRequestUrl && (
                <a href={step.pullRequestUrl} target="_blank" rel="noreferrer"
                  className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary underline-offset-4 hover:underline">
                  Ouvrir la PR de l’étape <ExternalLinkIcon className="size-3" />
                </a>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

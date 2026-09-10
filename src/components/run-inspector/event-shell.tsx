import type { ReactNode } from "react";
import { CheckIcon, CircleIcon, Loader2Icon, MinusIcon, XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatDuration, formatEventTime } from "./format";
import type { ActivityBase, ActivityState } from "./types";

export function activityShellProps(activity: ActivityBase) {
  return {
    state: activity.state,
    timestamp: activity.timestamp,
    completedAt: activity.completedAt,
  };
}

function StateIcon({ state }: { state: ActivityState }) {
  if (state === "running") return <Loader2Icon className="size-3.5 animate-spin" />;
  if (state === "success") return <CheckIcon className="size-3.5" />;
  if (state === "failed") return <XIcon className="size-3.5" />;
  if (state === "interrupted") return <MinusIcon className="size-3.5" />;
  return <CircleIcon className="size-2.5 fill-current" />;
}

export function EventShell({ state, timestamp, completedAt, title, detail, icon, children, last = false }: {
  state: ActivityState;
  timestamp: string;
  completedAt?: string;
  title: ReactNode;
  detail?: ReactNode;
  icon?: ReactNode;
  children?: ReactNode;
  last?: boolean;
}) {
  const duration = completedAt ? Date.parse(completedAt) - Date.parse(timestamp) : null;
  return (
    <li className="group relative grid grid-cols-[1.75rem_minmax(0,1fr)] gap-3">
      <div className="relative flex justify-center">
        {!last && <span aria-hidden className="absolute top-7 bottom-0 w-px bg-border/70" />}
        <span className={cn(
          "relative z-10 mt-0.5 flex size-7 items-center justify-center rounded-full bg-popover ring-4 ring-popover",
          state === "success" && "text-success",
          state === "failed" && "text-destructive",
          state === "running" && "text-info",
          (state === "pending" || state === "interrupted" || state === "neutral") && "text-muted-foreground",
        )}>
          {icon ?? <StateIcon state={state} />}
        </span>
      </div>
      <article className={cn("min-w-0 pb-6", last && "pb-1")}>
        <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <div className="min-w-0">
            <h3 className={cn("text-sm font-medium", state === "failed" && "text-destructive")}>{title}</h3>
            {detail && <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{detail}</div>}
          </div>
          <div className="flex shrink-0 items-center gap-2 text-[0.6875rem] tabular-nums text-muted-foreground">
            {duration != null && duration >= 1000 && <span>{formatDuration(duration)}</span>}
            <time dateTime={timestamp}>{formatEventTime(timestamp)}</time>
          </div>
        </div>
        {children && <div className="mt-3 min-w-0">{children}</div>}
      </article>
    </li>
  );
}

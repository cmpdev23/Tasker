import { BracesIcon } from "lucide-react";
import { activityShellProps, EventShell } from "../event-shell";
import { prettyJson } from "../format";
import type { FallbackActivity } from "../types";

export function FallbackEvent({ activity, last }: { activity: FallbackActivity; last?: boolean }) {
  return (
    <EventShell {...activityShellProps(activity)} title={activity.title} detail={activity.summary} icon={<BracesIcon className="size-3.5" />} last={last}>
      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground outline-none hover:text-foreground focus-visible:rounded focus-visible:ring-2 focus-visible:ring-ring">Données brutes</summary>
        <pre className="mt-2 max-h-72 overflow-auto rounded-md bg-muted/50 p-3 whitespace-pre-wrap break-words font-mono text-[0.6875rem] leading-5">{prettyJson(activity.raw)}</pre>
      </details>
    </EventShell>
  );
}

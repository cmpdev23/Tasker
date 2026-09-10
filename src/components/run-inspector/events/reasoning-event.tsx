import { BrainIcon } from "lucide-react";
import { activityShellProps, EventShell } from "../event-shell";
import type { ReasoningActivity } from "../types";

export function ReasoningEvent({ activity, last }: { activity: ReasoningActivity; last?: boolean }) {
  const long = activity.text.length > 260;
  return (
    <EventShell {...activityShellProps(activity)} title="Réflexion" icon={<BrainIcon className="size-3.5" />} last={last}>
      {long ? (
        <details className="group/reasoning text-xs text-muted-foreground">
          <summary className="cursor-pointer list-none leading-5 outline-none hover:text-foreground focus-visible:rounded focus-visible:ring-2 focus-visible:ring-ring">
            <span className="group-open/reasoning:hidden">{activity.text.slice(0, 220).trim()}… <span className="text-foreground/70">Afficher plus</span></span>
            <span className="hidden group-open/reasoning:inline text-foreground/70">Masquer le détail</span>
          </summary>
          <p className="mt-2 whitespace-pre-wrap break-words leading-5">{activity.text}</p>
        </details>
      ) : (
        <p className="max-w-2xl whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground">{activity.text}</p>
      )}
    </EventShell>
  );
}

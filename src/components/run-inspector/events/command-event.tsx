import { TerminalIcon } from "lucide-react";
import { activityShellProps, EventShell } from "../event-shell";
import type { CommandActivity } from "../types";

export function CommandEvent({ activity, last }: { activity: CommandActivity; last?: boolean }) {
  const title = activity.state === "failed" ? "Commande échouée" : activity.state === "running" ? "Commande en cours" : "Commande";
  return (
    <EventShell {...activityShellProps(activity)} title={title} icon={<TerminalIcon className="size-3.5" />} last={last}>
      <code className="block overflow-x-auto rounded-md bg-muted/70 px-3 py-2 font-mono text-xs leading-5 text-foreground">
        {activity.command}
      </code>
      <div className="mt-2 flex flex-wrap gap-3 text-[0.6875rem] text-muted-foreground">
        {activity.exitCode != null && <span>Code de sortie {activity.exitCode}</span>}
        {activity.output?.trim() && <span>Sortie disponible</span>}
      </div>
      {activity.output?.trim() && (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer text-muted-foreground outline-none hover:text-foreground focus-visible:rounded focus-visible:ring-2 focus-visible:ring-ring">Afficher stdout / stderr</summary>
          <pre className="mt-2 max-h-72 overflow-auto rounded-md bg-muted/50 p-3 whitespace-pre-wrap break-words font-mono text-[0.6875rem] leading-5">{activity.output}</pre>
        </details>
      )}
    </EventShell>
  );
}

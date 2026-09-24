import { Globe2Icon, WrenchIcon } from "lucide-react";
import { activityShellProps, EventShell } from "../event-shell";
import { prettyJson } from "../format";
import type { ToolActivity } from "../types";

function label(value: string) {
  return value.replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase());
}

export function ToolEvent({ activity, last }: { activity: ToolActivity; last?: boolean }) {
  const title = activity.toolKind === "web-search" ? "Recherche web" : label(activity.name);
  const detail = activity.toolKind === "mcp" && activity.server ? `MCP · ${activity.server}` : undefined;
  return (
    <EventShell {...activityShellProps(activity)} title={title} detail={detail} icon={activity.toolKind === "web-search" ? <Globe2Icon className="size-3.5" /> : <WrenchIcon className="size-3.5" />} last={last}>
      {activity.summary && <p className="break-words text-sm leading-5">{activity.summary}</p>}
      {activity.error && <p className="text-xs leading-relaxed text-destructive">{activity.error}</p>}
      {(activity.arguments != null || activity.result != null) && (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer text-muted-foreground outline-none hover:text-foreground focus-visible:rounded focus-visible:ring-2 focus-visible:ring-ring">Détails de l’outil</summary>
          <pre className="mt-2 max-h-72 overflow-auto rounded-md bg-muted/50 p-3 whitespace-pre-wrap break-words font-mono text-[0.6875rem] leading-5">
            {activity.arguments != null ? `Arguments\n${prettyJson(activity.arguments)}` : ""}
            {activity.result != null ? `\n\nRésultat\n${prettyJson(activity.result)}` : ""}
          </pre>
        </details>
      )}
    </EventShell>
  );
}

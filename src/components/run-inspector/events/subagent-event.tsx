import { UsersIcon } from "lucide-react";
import { Badge } from "@/components/reui/badge";
import { activityShellProps, EventShell } from "../event-shell";
import { shortId } from "../format";
import type { SubagentActivity } from "../types";

const ACTION_LABELS: Record<string, string> = {
  spawn_agent: "Délégation à un sous-agent",
  send_input: "Instruction envoyée au sous-agent",
  wait: "Attente des sous-agents",
  close_agent: "Sous-agent fermé",
  resume_agent: "Sous-agent repris",
};

export function SubagentEvent({ activity, last }: { activity: SubagentActivity; last?: boolean }) {
  const title = ACTION_LABELS[activity.action] ?? "Activité de sous-agent";
  return (
    <EventShell {...activityShellProps(activity)} title={title} icon={<UsersIcon className="size-3.5" />} last={last}>
      {activity.prompt && <p className="max-w-2xl whitespace-pre-wrap break-words text-xs leading-5 text-muted-foreground">{activity.prompt}</p>}
      {(activity.agents.length > 0 || activity.threadIds.length > 0) && (
        <div className="mt-2 flex flex-wrap gap-2">
          {(activity.agents.length ? activity.agents : activity.threadIds.map((id) => ({ id, status: "started" }))).map((agent) => (
            <Badge key={agent.id} variant={/error|interrupt|not_found/i.test(agent.status) ? "destructive-light" : /running|pending|started/i.test(agent.status) ? "info-light" : "secondary"} size="sm" radius="full">
              {shortId(agent.id)} · {agent.status.replaceAll("_", " ")}
            </Badge>
          ))}
        </div>
      )}
    </EventShell>
  );
}

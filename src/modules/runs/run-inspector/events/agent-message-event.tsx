import { MessageSquareTextIcon } from "lucide-react";
import { activityShellProps, EventShell } from "../event-shell";
import type { AgentMessageActivity } from "../types";

export function AgentMessageEvent({ activity, last }: { activity: AgentMessageActivity; last?: boolean }) {
  return (
    <EventShell {...activityShellProps(activity)} title="Codex" icon={<MessageSquareTextIcon className="size-3.5" />} last={last}>
      <div className="max-w-2xl whitespace-pre-wrap break-words text-sm leading-6 text-foreground/90">
        {activity.text}
      </div>
      {activity.blockingError && activity.blockingError !== activity.text && (
        <p className="mt-2 text-xs leading-relaxed text-destructive">{activity.blockingError}</p>
      )}
    </EventShell>
  );
}

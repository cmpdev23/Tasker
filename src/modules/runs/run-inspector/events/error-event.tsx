import { CircleAlertIcon } from "lucide-react";
import { activityShellProps, EventShell } from "../event-shell";
import type { ErrorActivity } from "../types";

export function ErrorEvent({ activity, last }: { activity: ErrorActivity; last?: boolean }) {
  return (
    <EventShell {...activityShellProps(activity)} title={activity.title} icon={<CircleAlertIcon className="size-3.5" />} last={last}>
      <p className="max-w-2xl whitespace-pre-wrap break-words text-sm leading-5 text-destructive">{activity.message}</p>
    </EventShell>
  );
}

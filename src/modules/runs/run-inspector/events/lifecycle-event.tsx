import { activityShellProps, EventShell } from "../event-shell";
import type { LifecycleActivity } from "../types";

export function LifecycleEvent({ activity, last }: { activity: LifecycleActivity; last?: boolean }) {
  return (
    <EventShell {...activityShellProps(activity)} title={activity.title} detail={activity.detail} last={last}>
      {activity.metadata && activity.metadata.length > 0 && (
        <p className="flex flex-wrap gap-x-3 gap-y-1 text-[0.6875rem] text-muted-foreground">
          {activity.metadata.map((value) => <span key={value}>{value}</span>)}
        </p>
      )}
    </EventShell>
  );
}

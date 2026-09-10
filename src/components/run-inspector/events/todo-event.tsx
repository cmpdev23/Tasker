import { CheckIcon, CircleIcon, ListChecksIcon } from "lucide-react";
import { activityShellProps, EventShell } from "../event-shell";
import type { TodoActivity } from "../types";

export function TodoEvent({ activity, last }: { activity: TodoActivity; last?: boolean }) {
  const completed = activity.items.filter((item) => item.completed).length;
  return (
    <EventShell {...activityShellProps(activity)} title="Plan de travail" detail={`${completed}/${activity.items.length} étapes terminées`} icon={<ListChecksIcon className="size-3.5" />} last={last}>
      <ul className="space-y-1.5 text-xs">
        {activity.items.map((item, index) => (
          <li key={`${item.text}:${index}`} className="flex gap-2 leading-5">
            {item.completed ? <CheckIcon className="mt-1 size-3 shrink-0 text-success" /> : <CircleIcon className="mt-1 size-3 shrink-0 text-muted-foreground" />}
            <span className={item.completed ? "text-muted-foreground line-through" : ""}>{item.text}</span>
          </li>
        ))}
      </ul>
    </EventShell>
  );
}

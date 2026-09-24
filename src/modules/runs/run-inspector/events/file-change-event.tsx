import { FilesIcon } from "lucide-react";
import { activityShellProps, EventShell } from "../event-shell";
import type { FileChangeActivity } from "../types";

const CHANGE_MARKS: Record<string, string> = { add: "A", update: "M", delete: "D" };

export function FileChangeEvent({ activity, last }: { activity: FileChangeActivity; last?: boolean }) {
  const count = activity.changes.length;
  const title = count ? `${count} fichier${count > 1 ? "s" : ""} modifié${count > 1 ? "s" : ""}` : "Modification de fichiers";
  return (
    <EventShell {...activityShellProps(activity)} title={title} icon={<FilesIcon className="size-3.5" />} last={last}>
      {count > 0 && (
        <ul className="space-y-1.5">
          {activity.changes.map((change, index) => (
            <li key={`${change.path}:${index}`} className="grid grid-cols-[1rem_minmax(0,1fr)] gap-2 font-mono text-xs leading-5">
              <span className="font-semibold text-muted-foreground">{CHANGE_MARKS[change.kind] ?? "M"}</span>
              <span className="break-all">{change.path}</span>
            </li>
          ))}
        </ul>
      )}
    </EventShell>
  );
}

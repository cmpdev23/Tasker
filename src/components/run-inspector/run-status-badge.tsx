import { Badge } from "@/components/reui/badge";
import { isActiveRun } from "@/components/task-ui-utils";

export function RunStatusBadge({ status }: { status: string }) {
  const tone = status === "SUCCESS"
    ? "success"
    : status === "FAILED"
      ? "destructive"
      : isActiveRun(status)
        ? "info"
        : "secondary";
  const normalizedStatus = status.toLowerCase().replaceAll("_", " ");
  const label = normalizedStatus.charAt(0).toUpperCase() + normalizedStatus.slice(1);

  return (
    <Badge tone={tone} variant="dot-outline">
      {label}
    </Badge>
  );
}

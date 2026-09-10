import { Loader2Icon } from "lucide-react";
import { Badge } from "@/components/reui/badge";
import { isActiveRun } from "@/components/task-ui-utils";

export function RunStatusBadge({ status }: { status: string }) {
  const variant = status === "SUCCESS"
    ? "success-light"
    : status === "FAILED"
      ? "destructive-light"
      : isActiveRun(status)
        ? "info-light"
        : "secondary";
  return (
    <Badge variant={variant} radius="full">
      {isActiveRun(status) && <Loader2Icon className="size-3 animate-spin" />}
      {status}
    </Badge>
  );
}


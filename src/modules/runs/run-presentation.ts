export function formatRunDate(value: string | null | undefined, timezone?: string) {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat("fr-CA", {
      dateStyle: "medium", timeStyle: "short", timeZone: timezone,
    }).format(new Date(value));
  } catch { return value; }
}

export function isActiveRun(status: string) {
  return ["QUEUED", "PREPARING", "RUNNING", "VALIDATING", "CLEANING_UP"].includes(status);
}

export function isRerunnableRun(status: string) {
  return status === "FAILED";
}

export function isRemovableRun(run: {
  status: string;
  terminationVerified: boolean;
  codexPid: number | null;
  worktreePath: string | null;
  runBranch: string | null;
}) {
  if (isActiveRun(run.status)) return run.status === "QUEUED" && run.terminationVerified;
  return run.terminationVerified || run.codexPid === null;
}

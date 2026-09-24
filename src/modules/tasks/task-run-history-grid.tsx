"use client";

import { useMemo, useState } from "react";
import type { Run } from "@db/schema";
import {
  createColumnHelper,
  createSortedRowModel,
  rowSortingFeature,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import {
  ArrowDownIcon,
  ArrowUpDownIcon,
  ArrowUpIcon,
  EyeIcon,
  Loader2Icon,
  RotateCcwIcon,
  Trash2Icon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import { RunStatusBadge } from "@/modules/runs/run-inspector/run-status-badge";
import { formatRunDate } from "@/modules/runs/run-presentation";

const runHistoryFeatures = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
});

const columnHelper = createColumnHelper<typeof runHistoryFeatures, Run>();

type TaskRunHistoryGridProps = {
  runs: Run[];
  isRerunnable: (run: Run) => boolean;
  isRemovable: (run: Run) => boolean;
  rerunningTaskId: string | null;
  removingRunId: string | null;
  onOpen: (run: Run) => void;
  onRerun: (run: Run) => void;
  onRemove: (run: Run) => void;
};

function runDuration(run: Run) {
  const startedAt = Date.parse(run.startedAt || run.queuedAt);
  const completedAt = Date.parse(run.completedAt || new Date().toISOString());
  if (!Number.isFinite(startedAt) || !Number.isFinite(completedAt)) return 0;
  return Math.max(0, completedAt - startedAt);
}

function statusBarClass(status: string) {
  if (status === "SUCCESS") return "bg-success";
  if (status === "FAILED") return "bg-destructive";
  if (status === "CANCELLED") return "bg-muted-foreground/70";
  return "bg-info animate-pulse";
}

function durationLabel(duration: number) {
  if (duration < 1_000) return "moins d’une seconde";
  if (duration < 60_000) return `${Math.round(duration / 1_000)} s`;
  if (duration < 3_600_000) return `${Math.round(duration / 60_000)} min`;
  return `${(duration / 3_600_000).toFixed(1)} h`;
}

function RunHistoryChart({ runs }: { runs: Run[] }) {
  const chartRuns = runs.slice(0, 12).reverse();
  const longestDuration = Math.max(
    1,
    ...chartRuns.map((run) => runDuration(run)),
  );

  return (
    <div
      className="flex h-9 min-w-28 items-end gap-0.5"
      role="img"
      aria-label={`Historique des ${chartRuns.length} dernières exécutions`}
    >
      {chartRuns.map((run) => {
        const duration = runDuration(run);
        const height = Math.max(
          7,
          Math.round((duration / longestDuration) * 32),
        );
        return (
          <span
            key={run.id}
            title={`${formatRunDate(run.startedAt || run.queuedAt)} · ${run.status.toLowerCase()} · ${durationLabel(duration)}`}
            className={`w-1.5 rounded-sm ${statusBarClass(run.status)}`}
            style={{ height }}
          />
        );
      })}
    </div>
  );
}

function SortHeader({
  label,
  column,
}: {
  label: string;
  column: {
    getIsSorted: () => false | "asc" | "desc";
    toggleSorting: () => void;
  };
}) {
  const sorted = column.getIsSorted();
  const Icon =
    sorted === "asc"
      ? ArrowUpIcon
      : sorted === "desc"
        ? ArrowDownIcon
        : ArrowUpDownIcon;
  return (
    <button
      type="button"
      onClick={() => column.toggleSorting()}
      className="-ml-2 inline-flex items-center gap-1 rounded-md px-2 py-1 text-left font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label={`Trier par ${label}${sorted ? `, ordre ${sorted === "asc" ? "croissant" : "décroissant"}` : ""}`}
    >
      {label}
      <Icon className="size-3.5 text-muted-foreground" aria-hidden />
    </button>
  );
}

export function TaskRunHistoryGrid({
  runs,
  isRerunnable,
  isRemovable,
  rerunningTaskId,
  removingRunId,
  onOpen,
  onRerun,
  onRemove,
}: TaskRunHistoryGridProps) {
  const [sorting, setSorting] = useState([{ id: "executedAt", desc: true }]);
  const historiesByTask = useMemo(() => {
    const histories = new Map<string, Run[]>();
    for (const run of runs) {
      const history = histories.get(run.taskId) || [];
      history.push(run);
      histories.set(run.taskId, history);
    }
    for (const history of histories.values()) {
      history.sort(
        (left, right) =>
          Date.parse(right.startedAt || right.queuedAt) -
          Date.parse(left.startedAt || left.queuedAt),
      );
    }
    return histories;
  }, [runs]);

  const columns = useMemo(
    () =>
      columnHelper.columns([
        columnHelper.accessor((run) => run.taskName || run.taskId, {
          id: "task",
          header: ({ column }) => <SortHeader label="Tâche" column={column} />,
          cell: ({ row }) => (
            <button
              type="button"
              onClick={() => onOpen(row.original)}
              className="block min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="block break-words font-medium text-foreground">
                {row.original.taskName || row.original.taskId}
              </span>
              <span className="mt-0.5 block truncate font-mono text-xs text-muted-foreground">
                {row.original.id}
              </span>
            </button>
          ),
        }),
        columnHelper.accessor(
          (run) => Date.parse(run.startedAt || run.queuedAt) || 0,
          {
            id: "executedAt",
            header: ({ column }) => (
              <SortHeader label="Exécutée le" column={column} />
            ),
            sortDescFirst: true,
            cell: ({ row }) => (
              <time
                dateTime={row.original.startedAt || row.original.queuedAt}
                className="whitespace-nowrap text-sm text-foreground"
              >
                {formatRunDate(row.original.startedAt || row.original.queuedAt)}
              </time>
            ),
          },
        ),
        columnHelper.accessor("status", {
          header: ({ column }) => <SortHeader label="Statut" column={column} />,
          cell: ({ getValue }) => <RunStatusBadge status={getValue()} />,
        }),
        columnHelper.display({
          id: "history",
          header: "History",
          cell: ({ row }) => (
            <RunHistoryChart
              runs={historiesByTask.get(row.original.taskId) || []}
            />
          ),
        }),
        columnHelper.display({
          id: "actions",
          header: () => <span className="sr-only">Actions</span>,
          cell: ({ row }) => {
            const run = row.original;
            const canRerun = isRerunnable(run);
            const canRemove = isRemovable(run);
            const isRerunning = rerunningTaskId === run.taskId;
            const isRemoving = removingRunId === run.id;
            return (
              <ButtonGroup
                aria-label={`Actions pour ${run.taskName || run.taskId}`}
              >
                <Button
                  type="button"
                  size="icon-sm"
                  variant="outline"
                  onClick={() => onOpen(run)}
                  aria-label={`Ouvrir le Run ${run.id}`}
                  title="Ouvrir"
                >
                  <EyeIcon />
                </Button>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="outline"
                  disabled={!canRerun || !!rerunningTaskId}
                  onClick={() => onRerun(run)}
                  aria-label={`Réexécuter ${run.taskName || run.taskId}`}
                  title={
                    canRerun
                      ? "Réexécuter"
                      : "La réexécution est disponible après un échec"
                  }
                >
                  {isRerunning ? (
                    <Loader2Icon className="animate-spin" />
                  ) : (
                    <RotateCcwIcon />
                  )}
                </Button>
                <Button
                  type="button"
                  size="icon-sm"
                  variant="outline"
                  className="hover:bg-destructive/10 hover:text-destructive"
                  disabled={!canRemove || !!removingRunId}
                  onClick={() => onRemove(run)}
                  aria-label={
                    run.status === "QUEUED"
                      ? `Retirer le Run ${run.id} de la file`
                      : `Supprimer le Run ${run.id}`
                  }
                  title={
                    !canRemove
                      ? "Ce Run ne peut pas encore être supprimé"
                      : run.status === "QUEUED"
                        ? "Retirer de la file"
                        : run.worktreePath || run.runBranch
                          ? "Supprimer le Run et son travail préservé"
                          : "Supprimer de l’historique"
                  }
                >
                  {isRemoving ? (
                    <Loader2Icon className="animate-spin" />
                  ) : (
                    <Trash2Icon />
                  )}
                </Button>
              </ButtonGroup>
            );
          },
        }),
      ]),
    [
      historiesByTask,
      isRemovable,
      isRerunnable,
      onOpen,
      onRemove,
      onRerun,
      removingRunId,
      rerunningTaskId,
    ],
  );

  const table = useTable({
    data: runs,
    columns,
    features: runHistoryFeatures,
    getRowId: (run) => run.id,
    state: { sorting },
    onSortingChange: setSorting,
  });

  return (
    <div className="max-h-[32rem] overflow-auto">
      <table className="w-full min-w-[58rem] border-collapse text-sm">
        <thead className="sticky top-0 z-10 border-b bg-card text-xs text-muted-foreground shadow-[0_1px_0_var(--color-border)]">
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id}>
              {headerGroup.headers.map((header) => (
                <th
                  key={header.id}
                  scope="col"
                  className="h-11 px-4 text-left font-medium first:pl-5 last:pr-5"
                >
                  {header.isPlaceholder ? null : (
                    <table.FlexRender header={header} />
                  )}
                </th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody className="divide-y">
          {table.getRowModel().rows.map((row) => (
            <tr key={row.id} className="transition-colors hover:bg-muted/35">
              {row.getAllCells().map((cell) => (
                <td
                  key={cell.id}
                  className="px-4 py-3 align-middle first:pl-5 last:pr-5"
                >
                  <table.FlexRender cell={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

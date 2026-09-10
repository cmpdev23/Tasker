import type { Run } from "@db/schema";
import { ChevronDownIcon, SlidersHorizontalIcon } from "lucide-react";
import { runExecutionRows } from "./execution-config";

export function ExecutionDetails({ run }: { run: Run }) {
  return (
    <details className="group border-y border-border/70 py-1">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md px-1 py-3 text-sm font-medium outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring">
        <SlidersHorizontalIcon className="size-4 text-muted-foreground" />
        Détails de l’exécution
        <ChevronDownIcon className="ml-auto size-4 text-muted-foreground transition-transform group-open:rotate-180" />
      </summary>
      <dl className="grid grid-cols-1 gap-x-8 gap-y-4 px-1 pt-2 pb-5 sm:grid-cols-2">
        {runExecutionRows(run).map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase">{label}</dt>
            <dd className="mt-1 break-all font-mono text-xs leading-5">{value}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}


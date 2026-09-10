"use client";

import { useState } from "react";
import type { RunEvent } from "@db/schema";
import { BracesIcon, ChevronDownIcon } from "lucide-react";
import { Badge } from "@/components/reui/badge";
import { prettyJson } from "./format";

export function RawEvents({ events }: { events: RunEvent[] }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="border-t border-border/70 pt-1">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 rounded-md px-1 py-3 text-left text-sm font-medium outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <BracesIcon className="size-4 text-muted-foreground" />
        Événements Codex bruts
        <span className="text-xs font-normal text-muted-foreground">({events.length})</span>
        <ChevronDownIcon className={`ml-auto size-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <ol className="mt-2 max-h-[55dvh] space-y-3 overflow-auto rounded-lg bg-muted/40 p-3">
          {events.map((event) => (
            <li key={event.id} className="border-b border-border/60 pb-3 last:border-0 last:pb-0">
              <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[0.6875rem] text-muted-foreground">
                <time dateTime={event.timestamp}>{event.timestamp}</time>
                <Badge variant={/error|stderr/i.test(event.type) ? "destructive-light" : "outline"} size="sm">{event.type}</Badge>
              </div>
              <pre className="whitespace-pre-wrap break-words font-mono text-[0.6875rem] leading-5">{prettyJson(event.rawPayload ?? event.message)}</pre>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}


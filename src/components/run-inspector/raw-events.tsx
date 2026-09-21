"use client";

import { useState } from "react";
import type { RunEvent } from "@db/schema";
import { BracesIcon, ChevronDownIcon } from "lucide-react";
import { Badge } from "@/components/reui/badge";
import { prettyJson } from "./format";

const RAW_EVENT_CHUNK_SIZE = 100;

export function RawEvents({ events, suppressedCount = 0 }: { events: RunEvent[]; suppressedCount?: number }) {
  const [open, setOpen] = useState(false);
  const [visibleLimit, setVisibleLimit] = useState(RAW_EVENT_CHUNK_SIZE);
  const hiddenCount = Math.max(0, events.length - visibleLimit);
  const visibleEvents = hiddenCount > 0 ? events.slice(hiddenCount) : events;
  return (
    <section className="border-t border-border/70 pt-1">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 rounded-md px-1 py-3 text-left text-sm font-medium outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <BracesIcon className="size-4 text-muted-foreground" />
        Diagnostic technique
        <span className="text-xs font-normal text-muted-foreground">
          ({events.length} conservé{events.length > 1 ? "s" : ""}{suppressedCount > 0 ? `, ${suppressedCount} verbeux masqué${suppressedCount > 1 ? "s" : ""}` : ""})
        </span>
        <ChevronDownIcon className={`ml-auto size-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <ol className="mt-2 max-h-[55dvh] space-y-3 overflow-auto rounded-lg bg-muted/40 p-3">
          {hiddenCount > 0 && (
            <li className="pb-2 text-center">
              <button
                type="button"
                className="text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                onClick={() => setVisibleLimit((value) => value + RAW_EVENT_CHUNK_SIZE)}
              >
                Afficher {Math.min(hiddenCount, RAW_EVENT_CHUNK_SIZE)} événements précédents
              </button>
            </li>
          )}
          {visibleEvents.map((event) => (
            <li key={event.id} className="border-b border-border/60 pb-3 last:border-0 last:pb-0">
              <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[0.6875rem] text-muted-foreground">
                <time dateTime={event.timestamp}>{event.timestamp}</time>
                <Badge
                  tone={/error|stderr/i.test(event.type) ? "destructive" : "outline"}
                  variant="dot-outline"
                >
                  {event.type}
                </Badge>
              </div>
              <pre className="whitespace-pre-wrap break-words font-mono text-[0.6875rem] leading-5">{prettyJson(event.rawPayload ?? event.message)}</pre>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

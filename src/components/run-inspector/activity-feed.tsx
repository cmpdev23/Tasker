"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDownIcon, ChevronDownIcon, Loader2Icon, PauseIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { EventRenderer } from "./event-renderer";
import type { NormalizedRunActivity } from "./types";

const ACTIVITY_CHUNK_SIZE = 200;

export function ActivityFeed({
  activities,
  loading,
  active,
  follow,
  onFollowChange,
  defaultOpen = false,
}: {
  activities: NormalizedRunActivity[];
  loading: boolean;
  active: boolean;
  follow: boolean;
  onFollowChange: (follow: boolean) => void;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [visibleLimit, setVisibleLimit] = useState(ACTIVITY_CHUNK_SIZE);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const hiddenCount = Math.max(0, activities.length - visibleLimit);
  const visibleActivities = hiddenCount > 0 ? activities.slice(hiddenCount) : activities;

  useEffect(() => {
    if (open && follow && active) {
      const container = scrollContainerRef.current;
      if (container) {
        container.scrollTop = container.scrollHeight;
        const raf = requestAnimationFrame(() => {
          if (scrollContainerRef.current) {
            scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
          }
        });
        return () => cancelAnimationFrame(raf);
      }
    }
  }, [open, follow, active, activities]);

  const handleScroll = () => {
    if (!scrollContainerRef.current || !active) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    const atBottom = scrollHeight - scrollTop - clientHeight < 40;
    if (!atBottom && follow) {
      onFollowChange(false);
    } else if (atBottom && !follow) {
      onFollowChange(true);
    }
  };

  return (
    <section aria-labelledby="run-activity-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((prev) => !prev)}
          className="group -ml-1.5 flex items-center gap-2.5 rounded-md px-1.5 py-1 text-left outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronDownIcon
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-hover:text-foreground",
              open && "rotate-180"
            )}
          />
          <div>
            <h2 id="run-activity-title" className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase group-hover:text-foreground">
              Activité
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {activities.length} activité{activities.length > 1 ? "s" : ""} interprétée{activities.length > 1 ? "s" : ""}
            </p>
          </div>
        </button>
        {open && active && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-pressed={follow}
            onClick={() => onFollowChange(!follow)}
            className="text-muted-foreground"
          >
            {follow ? <PauseIcon data-icon="inline-start" /> : <ArrowDownIcon data-icon="inline-start" />}
            {follow ? "Suivi automatique" : "Reprendre le suivi"}
          </Button>
        )}
      </div>

      {open && (
        <div className="mt-4">
          {loading && activities.length === 0 && (
            <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2Icon className="size-4 animate-spin" />Chargement de l’activité…
            </p>
          )}
          {!loading && activities.length === 0 && (
            <p className="text-sm text-muted-foreground">
              {active ? "En attente des premiers événements…" : "Aucune activité enregistrée."}
            </p>
          )}
          {activities.length > 0 && (
            <div
              ref={scrollContainerRef}
              onScroll={handleScroll}
              className="max-h-[55dvh] overflow-y-auto overflow-x-hidden rounded-lg border border-border/60 p-3.5 pr-2"
            >
              <ol>
                {hiddenCount > 0 && (
                  <li className="pb-5 text-center">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setVisibleLimit((value) => value + ACTIVITY_CHUNK_SIZE)}
                    >
                      Afficher {Math.min(hiddenCount, ACTIVITY_CHUNK_SIZE)} activités précédentes
                    </Button>
                  </li>
                )}
                {visibleActivities.map((activity, index) => (
                  <EventRenderer key={activity.key} activity={activity} last={index === visibleActivities.length - 1} />
                ))}
              </ol>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

"use client";

import { useState } from "react";
import { ArrowDownIcon, Loader2Icon, PauseIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EventRenderer } from "./event-renderer";
import type { NormalizedRunActivity } from "./types";

const ACTIVITY_CHUNK_SIZE = 200;

export function ActivityFeed({ activities, loading, active, follow, onFollowChange }: {
  activities: NormalizedRunActivity[];
  loading: boolean;
  active: boolean;
  follow: boolean;
  onFollowChange: (follow: boolean) => void;
}) {
  const [visibleLimit, setVisibleLimit] = useState(ACTIVITY_CHUNK_SIZE);
  const hiddenCount = Math.max(0, activities.length - visibleLimit);
  const visibleActivities = hiddenCount > 0 ? activities.slice(hiddenCount) : activities;
  return (
    <section aria-labelledby="run-activity-title">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 id="run-activity-title" className="text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">Activité</h2>
          <p className="mt-1 text-xs text-muted-foreground">{activities.length} activité{activities.length > 1 ? "s" : ""} interprétée{activities.length > 1 ? "s" : ""}</p>
        </div>
        {active && (
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
      {loading && activities.length === 0 && (
        <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2Icon className="size-4 animate-spin" />Chargement de l’activité…</p>
      )}
      {!loading && activities.length === 0 && (
        <p className="text-sm text-muted-foreground">{active ? "En attente des premiers événements…" : "Aucune activité enregistrée."}</p>
      )}
      {activities.length > 0 && (
        <ol>
          {hiddenCount > 0 && (
            <li className="pb-5 text-center">
              <Button type="button" variant="outline" size="sm" onClick={() => setVisibleLimit((value) => value + ACTIVITY_CHUNK_SIZE)}>
                Afficher {Math.min(hiddenCount, ACTIVITY_CHUNK_SIZE)} activités précédentes
              </Button>
            </li>
          )}
          {visibleActivities.map((activity, index) => (
            <EventRenderer key={activity.key} activity={activity} last={index === visibleActivities.length - 1} />
          ))}
        </ol>
      )}
    </section>
  );
}

import type { TaskDefinition } from "@/types/tasks";
import { formatRunDate } from "@/modules/runs/run-presentation";

export function localDateTime(value: string, timezone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(value));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

// datetime-local has no timezone. Resolve the wall-clock input in the selected
// IANA zone, explicitly rejecting missing or ambiguous DST times.
export function scheduleInstant(value: string, timezone: string) {
  const wall = Date.parse(`${value}:00Z`);
  if (!Number.isFinite(wall)) throw new Error("La date de début est invalide.");
  const candidates = new Set<number>();
  for (let hours = -48; hours <= 48; hours += 6) {
    const sample = wall + hours * 3_600_000;
    const offset = Date.parse(`${localDateTime(new Date(sample).toISOString(), timezone)}:00Z`) - sample;
    const candidate = wall - offset;
    if (localDateTime(new Date(candidate).toISOString(), timezone) === value) candidates.add(candidate);
  }
  if (!candidates.size) throw new Error("Cette heure n’existe pas dans ce fuseau (changement d’heure). Choisissez une autre heure.");
  if (candidates.size > 1) throw new Error("Cette heure se produit deux fois lors du changement d’heure. Choisissez une heure non ambiguë.");
  return new Date([...candidates][0]).toISOString();
}

export const WEEKDAYS = [
  ["monday", "Lundi"], ["tuesday", "Mardi"], ["wednesday", "Mercredi"],
  ["thursday", "Jeudi"], ["friday", "Vendredi"], ["saturday", "Samedi"], ["sunday", "Dimanche"],
] as const;

export const SCHEDULE_LABELS = { manual: "Manuelle", once: "Une seule fois", hourly: "Chaque heure", daily: "Chaque jour", weekly: "Chaque semaine" };

export function scheduleLabel(task: TaskDefinition) {
  const { type, startsAt, time, timezone, days } = task.schedule;
  if (type === "manual") return "Manuelle";
  if (type === "once") return `${formatRunDate(startsAt, timezone)} · ${timezone}`;
  if (type === "hourly") return `Chaque heure · ${timezone}`;
  const frequency = type === "daily"
    ? SCHEDULE_LABELS.daily
    : WEEKDAYS.filter(([day]) => days?.includes(day))
        .map(([, label]) => label.slice(0, 3))
        .join(", ");
  return `${frequency} à ${time} · ${timezone}`;
}

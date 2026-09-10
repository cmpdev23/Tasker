import type { TaskDefinition } from "../../src/types/tasks";

type Schedule = TaskDefinition["schedule"];
const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const formatters = new Map<string, Intl.DateTimeFormat>();
function parts(date: Date, timezone: string) {
  let formatter = formatters.get(timezone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit",
      day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
    formatters.set(timezone, formatter);
  }
  return Object.fromEntries(formatter.formatToParts(date).map(p => [p.type, p.value]));
}

// Enumerate offsets around the local date: gaps are skipped; a repeated hour runs once, at its first occurrence.
export function localOccurrence(date: string, time: string, timezone: string): Date | null {
  const nominal = Date.parse(`${date}T${time}:00Z`);
  const offsets = new Set<number>();
  for (let hours = -36; hours <= 36; hours += 6) {
    const probe = new Date(nominal + hours * 3_600_000);
    const p = parts(probe, timezone);
    offsets.add(Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`) - probe.getTime());
  }
  const candidates = [...offsets].map(offset => new Date(nominal - offset)).filter(candidate => {
    const p = parts(candidate, timezone);
    return `${p.year}-${p.month}-${p.day}` === date && `${p.hour}:${p.minute}` === time;
  });
  return candidates.sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
}

export function latestDueOccurrence(schedule: Schedule, after: Date, now: Date): string | null {
  if (schedule.type === "manual") return null;
  if (schedule.type === "once") {
    const start = new Date(schedule.startsAt!);
    return start > after && start <= now ? start.toISOString() : null;
  }
  const p = parts(now, schedule.timezone);
  if (schedule.type === "hourly") {
    const candidate = localOccurrence(`${p.year}-${p.month}-${p.day}`, `${p.hour}:00`, schedule.timezone);
    if (candidate && candidate <= now && candidate > after &&
      (!schedule.startsAt || candidate >= new Date(schedule.startsAt))) return candidate.toISOString();
    return null;
  }
  const day = new Date(`${p.year}-${p.month}-${p.day}T00:00:00Z`);
  for (let i = 0; i < 16; i++) {
    const candidateDay = new Date(day.getTime() - i * 86_400_000);
    if (schedule.type === "weekly" && !schedule.days?.includes(weekdays[candidateDay.getUTCDay()])) continue;
    const candidate = localOccurrence(candidateDay.toISOString().slice(0, 10), schedule.time!, schedule.timezone);
    if (candidate && candidate <= now && candidate > after &&
      (!schedule.startsAt || candidate >= new Date(schedule.startsAt))) return candidate.toISOString();
  }
  return null;
}

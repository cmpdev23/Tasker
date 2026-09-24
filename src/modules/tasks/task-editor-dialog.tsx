"use client";

import { useState } from "react";
import type { TaskDefinition, TaskInput } from "@/types/tasks";
import { Loader2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { errorMessage } from "@/lib/client-request";
import { localDateTime, scheduleInstant, SCHEDULE_LABELS, WEEKDAYS } from "@/modules/tasks/schedule-presentation";

export function TaskEditorDialog({ task, onClose, onSave }: {
  task: TaskDefinition | null;
  onClose: () => void;
  onSave: (value: TaskInput, id?: string) => Promise<void>;
}) {
  const [name, setName] = useState(task?.name ?? "");
  const [instructions, setInstructions] = useState(task?.instructions ?? "");
  const [enabled, setEnabled] = useState(task?.enabled ?? true);
  const [expectChanges, setExpectChanges] = useState(task?.expectChanges ?? true);
  const [scheduleType, setScheduleType] = useState<TaskDefinition["schedule"]["type"]>(task?.schedule.type ?? "manual");
  const [timezone, setTimezone] = useState(task?.schedule.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [time, setTime] = useState(task?.schedule.time ?? "09:00");
  const [days, setDays] = useState(task?.schedule.days ?? ["monday"]);
  const [startsAt, setStartsAt] = useState(() => {
    if (!task?.schedule.startsAt) return "";
    try { return localDateTime(task.schedule.startsAt, task.schedule.timezone); } catch { return ""; }
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    setError(null);
    try {
      if (!name.trim() || !instructions.trim()) throw new Error("Le nom et les instructions sont obligatoires.");
      const zone = timezone.trim();
      try {
        if (!zone || /^[+-]/.test(zone)) throw new Error("Named zone required");
        new Intl.DateTimeFormat("en", { timeZone: zone }).format();
      }
      catch { throw new Error("Saisissez un fuseau valide, par exemple America/Toronto."); }
      if (scheduleType === "once" && !startsAt) throw new Error("Choisissez une date et une heure de début.");
      if (scheduleType === "weekly" && !days.length) throw new Error("Sélectionnez au moins un jour.");
      const schedule: TaskDefinition["schedule"] = { type: scheduleType, timezone: zone };
      if (scheduleType === "daily" || scheduleType === "weekly") {
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error("Choisissez une heure valide.");
        schedule.time = time;
      }
      if (scheduleType === "weekly") schedule.days = WEEKDAYS.map(([day]) => day).filter((day) => days.includes(day));
      if (scheduleType !== "manual" && startsAt) {
        // Keep the original instant (including seconds and DST offset) on unchanged edits.
        const original = task?.schedule.startsAt;
        schedule.startsAt = original && zone === task.schedule.timezone && localDateTime(original, zone) === startsAt
          ? original : scheduleInstant(startsAt, zone);
      }
      setSaving(true);
      await onSave({ name: name.trim(), instructions, enabled, expectChanges, schedule }, task?.id);
    } catch (error) { setError(errorMessage(error)); }
    finally { setSaving(false); }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl" showCloseButton={!saving}>
        <DialogHeader>
          <DialogTitle>{task ? "Modifier la tâche" : "Créer une tâche"}</DialogTitle>
          <DialogDescription>Les instructions du projet et la configuration de l’agent principal s’appliquent à cette tâche.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-5">
          <fieldset disabled={saving} className="flex min-w-0 flex-col gap-5">
            <div className="grid gap-2">
              <Label htmlFor="task-name">Nom de la tâche</Label>
              <Input id="task-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Analyser la qualité du projet" maxLength={200} required autoFocus />
              {task?.id && <p className="text-xs text-muted-foreground">Identifiant : <code>{task.id}</code></p>}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="task-instructions">Instructions Markdown</Label>
              <Textarea id="task-instructions" className="min-h-48 font-mono text-sm" rows={9} value={instructions} onChange={(event) => setInstructions(event.target.value)} placeholder="Décrivez le travail à réaliser et le résultat attendu…" required />
            </div>
            <div className="grid gap-4 border-t pt-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="task-schedule">Planification</Label>
                <Select value={scheduleType} onValueChange={(value) => { if (value) setScheduleType(value); }}>
                  <SelectTrigger id="task-schedule" className="w-full"><SelectValue>{SCHEDULE_LABELS[scheduleType]}</SelectValue></SelectTrigger>
                  <SelectContent>{Object.entries(SCHEDULE_LABELS).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="task-timezone">Fuseau horaire</Label>
                <Input id="task-timezone" value={timezone} onChange={(event) => setTimezone(event.target.value)} placeholder="America/Toronto" required />
              </div>
              {scheduleType !== "manual" && <div className="grid gap-2 sm:col-span-2">
                <Label htmlFor="task-start">{scheduleType === "once" ? "Date et heure de début" : "Démarrer à partir de (facultatif)"}</Label>
                <Input id="task-start" type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} required={scheduleType === "once"} aria-describedby="task-start-help" />
                <p id="task-start-help" className="text-xs text-muted-foreground">Date et heure dans le fuseau sélectionné.{scheduleType !== "once" && " Sans date, la planification prend effet dès l’enregistrement."}</p>
              </div>}
              {(scheduleType === "daily" || scheduleType === "weekly") && <div className="grid gap-2">
                <Label htmlFor="task-time">Heure d’exécution</Label>
                <Input id="task-time" type="time" value={time} onChange={(event) => setTime(event.target.value)} required />
              </div>}
              {scheduleType === "weekly" && <fieldset className="sm:col-span-2">
                <legend className="mb-2 text-sm font-medium">Jours d’exécution</legend>
                <div className="flex flex-wrap gap-2">{WEEKDAYS.map(([day, label]) => <label key={day} className="flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-xs has-checked:border-primary has-checked:bg-primary/5">
                  <input type="checkbox" className="accent-primary" checked={days.includes(day)} onChange={(event) => setDays((current) => event.target.checked ? [...current, day] : current.filter((value) => value !== day))} />{label}
                </label>)}</div>
              </fieldset>}
            </div>
            <div className="grid gap-3 border-t pt-4">
              <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1 accent-primary" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /><span>Tâche activée<span className="mt-0.5 block text-xs text-muted-foreground">Autorise ses déclenchements planifiés.</span></span></label>
              <label className="flex items-start gap-3 text-sm"><input type="checkbox" className="mt-1 accent-primary" checked={expectChanges} onChange={(event) => setExpectChanges(event.target.checked)} /><span>Modifications Git attendues<span className="mt-0.5 block text-xs text-muted-foreground">Le Run doit produire un diff pour réussir. Désactivez pour une analyse seule.</span></span></label>
            </div>
          </fieldset>
          {error && <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={saving} onClick={onClose}>Annuler</Button>
            <Button type="submit" disabled={saving}>{saving && <Loader2Icon className="size-4 animate-spin" />}{saving ? "Enregistrement…" : "Enregistrer la tâche"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

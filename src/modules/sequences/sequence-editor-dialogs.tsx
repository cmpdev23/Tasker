"use client";

import { useState } from "react";
import { Loader2Icon } from "lucide-react";
import type { SequenceDefinition, SequenceFailurePolicy, SequenceInput, SequenceStepDefinition, SequenceStepInput } from "@/types/sequences";
import {
  DEFAULT_SEQUENCE_FAILURE_POLICY,
  DEFAULT_SEQUENCE_MAX_CONSECUTIVE_FAILURES,
  DEFAULT_SEQUENCE_PULL_REQUEST_STRATEGY,
  type SequencePullRequestStrategy,
} from "@/types/sequences";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { errorMessage } from "@/lib/client-request";

export function SequenceEditorDialog({ sequence, onClose, onSave }: {
  sequence: SequenceDefinition | null;
  onClose: () => void;
  onSave: (value: SequenceInput, id?: string) => Promise<void>;
}) {
  const [name, setName] = useState(sequence?.name ?? "");
  const [pullRequestStrategy, setPullRequestStrategy] = useState<SequencePullRequestStrategy>(
    sequence?.pullRequestStrategy ?? DEFAULT_SEQUENCE_PULL_REQUEST_STRATEGY
  );
  const [failurePolicy, setFailurePolicy] = useState<SequenceFailurePolicy>(
    sequence?.failurePolicy ?? DEFAULT_SEQUENCE_FAILURE_POLICY,
  );
  const [maxConsecutiveFailures, setMaxConsecutiveFailures] = useState(
    sequence?.maxConsecutiveFailures ?? DEFAULT_SEQUENCE_MAX_CONSECUTIVE_FAILURES,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    setError(null);
    try {
      if (!name.trim()) throw new Error("Le nom de la Sequence est obligatoire.");
      setSaving(true);
      await onSave({ name: name.trim(), pullRequestStrategy, failurePolicy, maxConsecutiveFailures }, sequence?.id);
    } catch (caught) { setError(errorMessage(caught)); }
    finally { setSaving(false); }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
      <DialogContent showCloseButton={!saving}>
        <DialogHeader>
          <DialogTitle>{sequence ? "Configurer la Sequence" : "Créer une Sequence"}</DialogTitle>
          <DialogDescription>Définissez son nom et le moment où ses pull requests doivent être créées.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-5">
          <fieldset disabled={saving} className="grid gap-2">
            <Label htmlFor="sequence-name">Nom de la Sequence</Label>
            <Input id="sequence-name" value={name} onChange={(event) => setName(event.target.value)}
              placeholder="Production SEO" maxLength={200} required autoFocus />
            {sequence?.id && <p className="text-xs text-muted-foreground">Identifiant : <code>{sequence.id}</code></p>}
          </fieldset>
          <fieldset disabled={saving} className="grid gap-2">
            <legend className="text-sm font-medium">Publication des pull requests</legend>
            <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm">
              <input type="radio" name="pull-request-strategy" value="after_sequence"
                className="mt-1 accent-primary" checked={pullRequestStrategy === "after_sequence"}
                onChange={() => setPullRequestStrategy("after_sequence")} />
              <span>Après toute la Sequence<span className="mt-0.5 block text-xs text-muted-foreground">Une seule PR est créée lorsque toutes les étapes ont réussi. Aucune PR n’est créée si la Sequence échoue avant la fin.</span></span>
            </label>
            <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm">
              <input type="radio" name="pull-request-strategy" value="after_each_step"
                className="mt-1 accent-primary" checked={pullRequestStrategy === "after_each_step"}
                onChange={() => setPullRequestStrategy("after_each_step")} />
              <span>Après chaque étape<span className="mt-0.5 block text-xs text-muted-foreground">Chaque étape qui produit un commit reçoit sa propre PR empilée. Les PR déjà créées restent disponibles si une étape suivante échoue.</span></span>
            </label>
            <label className="flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm">
              <input type="radio" name="pull-request-strategy" value="independent_after_each_step"
                className="mt-1 accent-primary" checked={pullRequestStrategy === "independent_after_each_step"}
                onChange={() => setPullRequestStrategy("independent_after_each_step")} />
              <span>PR indépendante après chaque étape<span className="mt-0.5 block text-xs text-muted-foreground">Chaque étape repart de la branche de base et crée sa propre PR. Aucun merge des PR précédentes n’est requis pour lancer la suivante.</span></span>
            </label>
            <p className="text-xs text-muted-foreground">La publication doit aussi être activée dans Project Settings → Git publication.</p>
          </fieldset>
          {pullRequestStrategy === "independent_after_each_step" && (
            <fieldset disabled={saving} className="grid gap-2">
              <legend className="text-sm font-medium">En cas d’échec</legend>
              <Select value={failurePolicy} onValueChange={(value) => setFailurePolicy(value as SequenceFailurePolicy)}>
                <SelectTrigger id="sequence-failure-policy" className="w-full">
                  <SelectValue>{failurePolicy === "stop" ? "Arrêter la Sequence" : "Passer à l’étape suivante"}</SelectValue>
                </SelectTrigger>
                <SelectContent align="start" alignItemWithTrigger={false}>
                  <SelectItem value="stop">Arrêter la Sequence</SelectItem>
                  <SelectItem value="continue">Passer à l’étape suivante</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {failurePolicy === "stop"
                  ? "Option prudente : les étapes restantes ne démarrent pas."
                  : "L’étape échouée est enregistrée, puis le worker repart de la branche de base pour la suivante."}
              </p>
              {failurePolicy === "continue" && (
                <label className="grid max-w-sm gap-1 text-sm">
                  Arrêter après combien d’échecs consécutifs ?
                  <Input type="number" min={1} max={20} value={maxConsecutiveFailures}
                    onChange={(event) => setMaxConsecutiveFailures(Number(event.target.value))} />
                  <span className="text-xs text-muted-foreground">Par défaut : 2. Une étape réussie remet le compteur à zéro.</span>
                </label>
              )}
            </fieldset>
          )}
          {error && <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={saving} onClick={onClose}>Annuler</Button>
            <Button type="submit" disabled={saving}>{saving && <Loader2Icon className="animate-spin" />}{saving ? "Enregistrement…" : "Enregistrer"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function SequenceStepEditorDialog({ step, onClose, onSave }: {
  step: SequenceStepDefinition | null;
  onClose: () => void;
  onSave: (value: SequenceStepInput, id?: string) => Promise<void>;
}) {
  const [name, setName] = useState(step?.name ?? "");
  const [instructions, setInstructions] = useState(step?.instructions ?? "");
  const [expectChanges, setExpectChanges] = useState(step?.expectChanges ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    setError(null);
    try {
      if (!name.trim() || !instructions.trim()) throw new Error("Le nom et les instructions sont obligatoires.");
      setSaving(true);
      await onSave({ name: name.trim(), instructions, expectChanges }, step?.id);
    } catch (caught) { setError(errorMessage(caught)); }
    finally { setSaving(false); }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl" showCloseButton={!saving}>
        <DialogHeader>
          <DialogTitle>{step ? "Modifier l’étape" : "Créer une étape"}</DialogTitle>
          <DialogDescription>Cette SequenceStep appartient uniquement à sa Sequence et ne sera pas ajoutée aux Tasks.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex flex-col gap-5">
          <fieldset disabled={saving} className="flex min-w-0 flex-col gap-5">
            <div className="grid gap-2">
              <Label htmlFor="sequence-step-name">Nom de l’étape</Label>
              <Input id="sequence-step-name" value={name} onChange={(event) => setName(event.target.value)}
                placeholder="Analyser Search Console" maxLength={200} required autoFocus />
              {step?.id && <p className="text-xs text-muted-foreground">Identifiant : <code>{step.id}</code></p>}
            </div>
            <div className="grid gap-2">
              <Label htmlFor="sequence-step-instructions">Instructions Markdown</Label>
              <Textarea id="sequence-step-instructions" className="min-h-56 font-mono text-sm" rows={10}
                value={instructions} onChange={(event) => setInstructions(event.target.value)}
                placeholder="Décrivez le travail de cette étape et son résultat attendu…" required />
            </div>
            <label className="flex items-start gap-3 border-t pt-4 text-sm">
              <input type="checkbox" className="mt-1 accent-primary" checked={expectChanges}
                onChange={(event) => setExpectChanges(event.target.checked)} />
              <span>Modifications Git attendues<span className="mt-0.5 block text-xs text-muted-foreground">Désactivez cette option pour une étape d’analyse qui ne modifie aucun fichier.</span></span>
            </label>
          </fieldset>
          {error && <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={saving} onClick={onClose}>Annuler</Button>
            <Button type="submit" disabled={saving}>{saving && <Loader2Icon className="animate-spin" />}{saving ? "Enregistrement…" : "Enregistrer l’étape"}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

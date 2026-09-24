import type { RunEvent } from "@db/schema";

interface SequenceStepEventMarker {
  kind?: unknown;
  state?: unknown;
  stepId?: unknown;
  sequenceStepId?: unknown;
}

function marker(event: RunEvent): SequenceStepEventMarker | null {
  try {
    const value = JSON.parse(event.rawPayload ?? "null") as unknown;
    return value !== null && typeof value === "object" && !Array.isArray(value)
      ? value as SequenceStepEventMarker
      : null;
  } catch {
    return null;
  }
}

/**
 * Selects one Sequence step's journal from the shared parent Run journal.
 *
 * Older Runs only mark step boundaries, so their untagged Codex output is
 * selected between the matching start marker and the next step marker. Newer
 * structured events that carry `sequenceStepId` are selected directly.
 */
export function sequenceStepEvents(events: RunEvent[], stepId: string): RunEvent[] {
  let withinStep = false;

  return events.filter((event) => {
    const value = marker(event);
    const eventStepId = typeof value?.sequenceStepId === "string" ? value.sequenceStepId : null;
    if (eventStepId) return eventStepId === stepId;

    const boundaryStepId = value?.kind === "sequence-step" && typeof value.stepId === "string"
      ? value.stepId
      : null;
    if (!boundaryStepId) return withinStep;

    if (boundaryStepId !== stepId) {
      withinStep = false;
      return false;
    }

    if (value?.state === "success") {
      withinStep = false;
      return true;
    }

    withinStep = true;
    return true;
  });
}

import { ConflictError } from "@backend/errors";
import { runRepository } from "@backend/runs/run.repository";
import { sequenceService } from "@backend/sequences/sequence.service";
import { errorResponse, assertLocalRequest } from "@backend/http/api";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string; sequenceId: string }> };

export async function PUT(request: Request, { params }: Context) {
  try {
    assertLocalRequest(request);
    const { id, sequenceId } = await params;
    if (runRepository.hasActiveSequence(id, sequenceId)) {
      throw new ConflictError("Attendez la fin de la Sequence ou annulez son Run avant de réordonner ses étapes.");
    }
    const body = await request.json();
    return Response.json({ sequence: await sequenceService.reorderSteps(id, sequenceId, body.orderedStepIds) });
  } catch (error) { return errorResponse(error); }
}


import { ConflictError } from "@backend/errors";
import { runRepository } from "@backend/runs/run.repository";
import { sequenceService } from "@backend/sequences/sequence.service";
import { errorResponse, assertLocalRequest } from "@backend/http/api";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string; sequenceId: string; stepId: string }> };

function assertEditable(projectId: string, sequenceId: string) {
  if (runRepository.hasActiveSequence(projectId, sequenceId)) {
    throw new ConflictError("Attendez la fin de la Sequence ou annulez son Run avant de modifier ses étapes.");
  }
}

export async function PUT(request: Request, { params }: Context) {
  try {
    assertLocalRequest(request);
    const { id, sequenceId, stepId } = await params;
    assertEditable(id, sequenceId);
    const body = await request.json();
    return Response.json({ sequence: await sequenceService.updateStep(id, sequenceId, stepId, body.step ?? body) });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request, { params }: Context) {
  try {
    assertLocalRequest(request);
    const { id, sequenceId, stepId } = await params;
    assertEditable(id, sequenceId);
    return Response.json({ sequence: await sequenceService.deleteStep(id, sequenceId, stepId) });
  } catch (error) { return errorResponse(error); }
}


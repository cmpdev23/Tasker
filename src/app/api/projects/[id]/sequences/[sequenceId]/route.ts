import { ConflictError } from "@backend/errors";
import { runRepository } from "@backend/runs/run.repository";
import { sequenceService } from "@backend/sequences/sequence.service";
import { errorResponse, assertLocalRequest } from "@backend/http/api";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string; sequenceId: string }> };

function assertEditable(projectId: string, sequenceId: string) {
  if (runRepository.hasActiveSequence(projectId, sequenceId)) {
    throw new ConflictError("Attendez la fin de la Sequence ou annulez son Run avant de modifier sa définition.");
  }
}

export async function GET(_request: Request, { params }: Context) {
  try {
    const { id, sequenceId } = await params;
    return Response.json({ sequence: await sequenceService.get(id, sequenceId) });
  } catch (error) { return errorResponse(error); }
}

export async function PUT(request: Request, { params }: Context) {
  try {
    assertLocalRequest(request);
    const { id, sequenceId } = await params;
    assertEditable(id, sequenceId);
    const body = await request.json();
    return Response.json({ sequence: await sequenceService.update(id, sequenceId, body.sequence ?? body) });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request, { params }: Context) {
  try {
    assertLocalRequest(request);
    const { id, sequenceId } = await params;
    assertEditable(id, sequenceId);
    await sequenceService.delete(id, sequenceId);
    return Response.json({ success: true, queue: runRepository.queueStatus() });
  } catch (error) { return errorResponse(error); }
}


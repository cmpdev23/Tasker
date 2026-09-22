import { errorResponse } from "@backend/http/api";
import { sequenceRunService } from "@backend/sequences/sequence-run.service";

export async function GET(_: Request, { params }: { params: Promise<{ id: string; sequenceId: string }> }) {
  try {
    const { id, sequenceId } = await params;
    return Response.json({ checkpoint: await sequenceRunService.portableCheckpoint(id, sequenceId) });
  } catch (error) { return errorResponse(error); }
}

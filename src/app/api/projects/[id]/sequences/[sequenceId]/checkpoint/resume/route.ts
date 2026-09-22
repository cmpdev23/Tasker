import { assertLocalRequest, errorResponse } from "@backend/http/api";
import { sequenceRunService } from "@backend/sequences/sequence-run.service";

export async function POST(request: Request, { params }: { params: Promise<{ id: string; sequenceId: string }> }) {
  try {
    assertLocalRequest(request);
    const { id, sequenceId } = await params;
    return Response.json({ run: await sequenceRunService.resumePortableCheckpoint(id, sequenceId) }, { status: 202 });
  } catch (error) { return errorResponse(error); }
}

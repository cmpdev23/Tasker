import { errorResponse, assertLocalRequest } from "@backend/http/api";
import { sequenceRunService } from "@backend/sequences/sequence-run.service";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string; runId: string }> }) {
  try {
    assertLocalRequest(request);
    const { id, runId } = await params;
    return Response.json({ run: await sequenceRunService.resume(id, runId) }, { status: 202 });
  } catch (error) { return errorResponse(error); }
}

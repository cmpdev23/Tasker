import { errorResponse, assertLocalRequest } from "@backend/http/api";
import { publishSequenceStepDraft } from "@backend/sequences/sequence-step-publication.service";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string; runId: string; stepId: string }> }) {
  try {
    assertLocalRequest(request);
    const { id, runId, stepId } = await params;
    return Response.json(await publishSequenceStepDraft(id, runId, stepId));
  } catch (error) {
    return errorResponse(error);
  }
}

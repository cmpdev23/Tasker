import { runService } from "@backend/runs/run.service";
import { errorResponse, assertLocalRequest } from "@backend/http/api";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ id: string; runId: string }> }) {
  try {
    assertLocalRequest(request);
    const { id, runId } = await params;
    const result = await runService.saveLogs(id, runId);
    return Response.json(result);
  } catch (error) {
    return errorResponse(error);
  }
}

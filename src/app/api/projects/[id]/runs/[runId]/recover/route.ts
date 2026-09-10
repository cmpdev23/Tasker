import { runService } from "@backend/runs/run.service";
import { errorResponse, assertLocalRequest } from "@backend/http/api";

export const runtime = "nodejs";

export async function POST(request: Request, {params}: {params: Promise<{id: string; runId: string}>}) {
  try {
    assertLocalRequest(request);
    const {id, runId} = await params;
    return Response.json({run: runService.confirmTermination(id, runId)}, {status: 202});
  } catch (error) { return errorResponse(error); }
}

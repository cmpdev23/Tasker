import { runRepository } from "@backend/runs/run.repository";
import { errorResponse } from "@backend/http/api";
export const runtime = "nodejs";
export async function GET(request: Request, {params}: {params: Promise<{id: string; runId: string}>}) {
  try { const {id, runId} = await params; const run = runRepository.get(id,runId);
    const after = Math.max(0, Number(new URL(request.url).searchParams.get("after")) || 0);
    return Response.json({run, events: runRepository.events(runId, after)}); }
  catch(error) { return errorResponse(error); }
}

import { runRepository } from "@backend/runs/run.repository";
import { errorResponse } from "@backend/http/api";
export const runtime = "nodejs";
export async function GET(request: Request, {params}: {params: Promise<{id: string}>}) {
  try { const {id} = await params; const url = new URL(request.url);
    return Response.json({runs: runRepository.list(id, url.searchParams.get("taskId") ?? undefined, url.searchParams.get("before") ?? undefined)}); }
  catch(error) { return errorResponse(error); }
}

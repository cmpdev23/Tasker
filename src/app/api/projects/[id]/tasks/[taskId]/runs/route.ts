import { runService } from "@backend/runs/run.service";
import { runRepository } from "@backend/runs/run.repository";
import { errorResponse, assertLocalRequest } from "@backend/http/api";
export const runtime = "nodejs";
type Context = {params: Promise<{id: string; taskId: string}>};
export async function POST(request: Request, {params}: Context) {
  try { assertLocalRequest(request); const {id, taskId} = await params;
    return Response.json({run: await runService.enqueue(id, taskId)}, {status: 202}); }
  catch(error) { return errorResponse(error); }
}
export async function GET(_request: Request, {params}: Context) {
  try { const {id,taskId} = await params; return Response.json({runs: runRepository.list(id,taskId)}); }
  catch(error) { return errorResponse(error); }
}

import { runRepository } from "@backend/runs/run.repository";
import { runService } from "@backend/runs/run.service";
import { errorResponse, assertLocalRequest } from "@backend/http/api";
import { sequenceRunRepository } from "@backend/sequences/sequence-run.repository";
export const runtime = "nodejs";
export async function GET(request: Request, {params}: {params: Promise<{id: string; runId: string}>}) {
  try { const {id, runId} = await params; const run = runRepository.get(id,runId);
    const after = Math.max(0, Number(new URL(request.url).searchParams.get("after")) || 0);
    return Response.json({run, events: runRepository.events(runId, after), queue: runRepository.queueStatus(runId),
      sequenceSteps: run.kind === "SEQUENCE" ? sequenceRunRepository.list(runId) : []}); }
  catch(error) { return errorResponse(error); }
}
export async function DELETE(request: Request, {params}: {params: Promise<{id: string; runId: string}>}) {
  try { assertLocalRequest(request); const {id, runId} = await params;
    const searchParams = new URL(request.url).searchParams;
    const deleteArtifacts = searchParams.get("deleteArtifacts") === "true";
    const confirmTermination = searchParams.get("confirmTermination") === "true";
    const run = await runService.remove(id, runId, { deleteArtifacts, confirmTermination });
    return Response.json({run, queue: runRepository.queueStatus()}); }
  catch(error) { return errorResponse(error); }
}

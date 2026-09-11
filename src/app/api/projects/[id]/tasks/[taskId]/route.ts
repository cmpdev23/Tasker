import { taskService } from "@backend/tasks/task.service";
import { runRepository } from "@backend/runs/run.repository";
import { ConflictError } from "@backend/errors";
import { errorResponse, assertLocalRequest } from "@backend/http/api";
export const runtime = "nodejs";
type Context = {params: Promise<{id: string; taskId: string}>};
export async function PUT(request: Request, {params}: Context) {
  try { assertLocalRequest(request); const {id, taskId} = await params; const body = await request.json();
    return Response.json({task: await taskService.update(id, taskId, body.task ?? body)}); }
  catch(error) { return errorResponse(error); }
}
export async function DELETE(request: Request, {params}: Context) {
  try { assertLocalRequest(request); const {id, taskId} = await params;
    if(runRepository.hasActive(id, taskId))
      throw new ConflictError("Annulez l’exécution active ou retirez ses Runs de la file avant de supprimer cette tâche.");
    await taskService.delete(id, taskId); return Response.json({success: true, queue: runRepository.queueStatus()}); }
  catch(error) { return errorResponse(error); }
}

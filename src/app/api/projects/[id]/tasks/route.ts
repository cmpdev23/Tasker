import { taskService } from "@backend/tasks/task.service";
import { errorResponse, assertLocalRequest } from "@backend/http/api";
export const runtime = "nodejs";
export async function GET(_request: Request, {params}: {params: Promise<{id: string}>}) {
  try { const {id} = await params; return Response.json({tasks: await taskService.list(id)}); }
  catch(error) { return errorResponse(error); }
}
export async function POST(request: Request, {params}: {params: Promise<{id: string}>}) {
  try { assertLocalRequest(request); const {id} = await params; const body = await request.json();
    return Response.json({task: await taskService.create(id, body.task ?? body)}, {status: 201}); }
  catch(error) { return errorResponse(error); }
}

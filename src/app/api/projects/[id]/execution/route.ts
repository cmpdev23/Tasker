import { taskerService } from "@backend/tasker/tasker.service";
import { projectExecutionRuntimeStatus } from "@backend/runs/project-command-runner";
import { assertLocalRequest, errorResponse } from "@backend/http/api";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const result = await taskerService.getProjectExecutionSettings(id);
    return Response.json({
      ...result,
      runtime: projectExecutionRuntimeStatus(result.settings.packageManager),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    assertLocalRequest(request);
    const { id } = await params;
    const body = await request.json();
    const result = await taskerService.updateProjectExecutionSettings(id, body.settings ?? body);
    return Response.json({
      success: true,
      ...result,
      runtime: projectExecutionRuntimeStatus(result.settings.packageManager),
    });
  } catch (error) {
    return errorResponse(error);
  }
}

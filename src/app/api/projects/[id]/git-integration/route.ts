import { taskerService } from "@backend/tasker/tasker.service";
import { projectService } from "@backend/projects/project.service";
import { githubCliService } from "@backend/git/github-cli.service";
import { assertLocalRequest, errorResponse } from "@backend/http/api";

export const runtime = "nodejs";

async function responseFor(projectId: string) {
  const result = await taskerService.getProjectGitSettings(projectId);
  const project = await projectService.getProjectById(projectId);
  const runtimeStatus = project.repositoryPath
    ? await githubCliService.inspect(project.repositoryPath, result.settings.remote)
    : { available: false, authenticated: false, executable: null, detail: "Configure the Project repository first." };
  return { ...result, runtime: runtimeStatus };
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    return Response.json(await responseFor(id));
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    assertLocalRequest(request);
    const { id } = await params;
    const body = await request.json();
    await taskerService.updateProjectGitSettings(id, body.settings ?? body);
    return Response.json({ success: true, ...await responseFor(id) });
  } catch (error) {
    return errorResponse(error);
  }
}

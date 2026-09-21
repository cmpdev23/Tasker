import { taskerService } from "@backend/tasker/tasker.service";
import { projectExecutionRuntimeStatus } from "@backend/runs/project-command-runner";
import { projectRuntimePreferenceService, normalizePythonExecutablePreference } from "@backend/runs/project-runtime-preference.service";
import {
  normalizeProjectEnvironmentVariableInputs,
  projectEnvironmentVariableService,
} from "@backend/runs/project-environment-variable.service";
import { probePythonSandbox } from "@backend/codex/codex-sandbox-preflight";
import { agentsService } from "@backend/tasker/agents.service";
import { projectService } from "@backend/projects/project.service";
import { validateProjectExecutionSettings } from "@backend/tasker/project-execution";
import { ValidationError } from "@backend/errors";
import { assertLocalRequest, errorResponse } from "@backend/http/api";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const result = await taskerService.getProjectExecutionSettings(id);
    const runtimePreference = await projectRuntimePreferenceService.get(id);
    const localRuntime = {
      ...runtimePreference,
      environmentVariables: projectEnvironmentVariableService.list(id),
    };
    const runtime = projectExecutionRuntimeStatus(result.settings, localRuntime.pythonExecutable);
    const project = await projectService.getProjectById(id);
    const agents = await agentsService.getAgents(id);
    if (project.repositoryPath && runtime.python.available) {
      runtime.python.sandbox = await probePythonSandbox(runtime.python, project.repositoryPath, agents.main);
    }
    return Response.json({
      ...result,
      localRuntime,
      runtime,
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
    const settings = validateProjectExecutionSettings(body.settings ?? body);
    const requestedExecutable = normalizePythonExecutablePreference(body.localRuntime?.pythonExecutable ?? null);
    const requestedEnvironment = body.localRuntime?.environmentVariables;
    if (requestedEnvironment !== undefined) normalizeProjectEnvironmentVariableInputs(requestedEnvironment);
    const candidate = projectExecutionRuntimeStatus(settings, requestedExecutable).python;
    if (requestedExecutable && !candidate.available) {
      throw new ValidationError(`The selected Python interpreter could not be executed. ${candidate.detail}`);
    }
    const result = await taskerService.updateProjectExecutionSettings(id, settings);
    const runtimePreference = await projectRuntimePreferenceService.set(id, requestedExecutable);
    const environmentVariables = requestedEnvironment === undefined
      ? projectEnvironmentVariableService.list(id)
      : projectEnvironmentVariableService.setAll(id, requestedEnvironment);
    const localRuntime = { ...runtimePreference, environmentVariables };
    const runtime = projectExecutionRuntimeStatus(result.settings, localRuntime.pythonExecutable);
    const project = await projectService.getProjectById(id);
    const agents = await agentsService.getAgents(id);
    if (project.repositoryPath && runtime.python.available) {
      runtime.python.sandbox = await probePythonSandbox(runtime.python, project.repositoryPath, agents.main);
    }
    return Response.json({
      success: true,
      ...result,
      localRuntime,
      runtime,
    });
  } catch (error) {
    return errorResponse(error);
  }
}

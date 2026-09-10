import { NextResponse } from "next/server";
import { agentsService } from "@backend/tasker/agents.service";
import { codexModelsService } from "@backend/codex/codex-models.service";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
} from "@backend/errors";

function errorResponse(error: unknown, operation: string) {
  if (error instanceof NotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }
  if (error instanceof ConflictError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }
  if (error instanceof ValidationError) {
    if (error.message.startsWith("NO_REPOSITORY:")) {
      return NextResponse.json(
        { code: "NO_REPOSITORY", error: "Configure the project repository in Settings first." },
        { status: 400 }
      );
    }
    if (error.message.startsWith("NOT_INITIALIZED:")) {
      return NextResponse.json(
        { code: "NOT_INITIALIZED", error: "Initialize Tasker in Settings first." },
        { status: 400 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  console.error(`${operation} /api/projects/[id]/agents error:`, error);
  return NextResponse.json({ error: "Internal server error." }, { status: 500 });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const [{ main, mainFileExists, subagents }, modelResult] = await Promise.all([
      agentsService.getAgents(id),
      codexModelsService
        .listAvailableModels()
        .then((models) => ({ models, error: null }))
        .catch((error: unknown) => ({
          models: [],
          error:
            error instanceof Error
              ? error.message
              : "Codex model discovery failed.",
        })),
    ]);
    return NextResponse.json({
      main,
      mainFileExists,
      mainFilePath: ".tasker/agents/main.toml",
      subagents,
      models: modelResult.models,
      modelDiscoveryError: modelResult.error,
    });
  } catch (error) {
    return errorResponse(error, "GET");
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const main = await agentsService.updateMainAgent(id, body.main);
    return NextResponse.json({
      success: true,
      main,
      mainFileExists: true,
      mainFilePath: ".tasker/agents/main.toml",
    });
  } catch (error) {
    return errorResponse(error, "PUT");
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const subagent = await agentsService.createSubagent(id, body.subagent);
    return NextResponse.json({ success: true, subagent }, { status: 201 });
  } catch (error) {
    return errorResponse(error, "POST");
  }
}

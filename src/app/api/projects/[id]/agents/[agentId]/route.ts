import { NextResponse } from "next/server";
import { agentsService } from "@backend/tasker/agents.service";
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
    return NextResponse.json({ error: error.message }, { status: 400 });
  }
  console.error(`${operation} /api/projects/[id]/agents/[agentId] error:`, error);
  return NextResponse.json({ error: "Internal server error." }, { status: 500 });
}

export async function PUT(
  request: Request,
  {
    params,
  }: { params: Promise<{ id: string; agentId: string }> }
) {
  try {
    const { id, agentId } = await params;
    const body = await request.json();
    const subagent = await agentsService.updateSubagent(
      id,
      agentId,
      body.subagent
    );
    return NextResponse.json({ success: true, subagent });
  } catch (error) {
    return errorResponse(error, "PUT");
  }
}

export async function DELETE(
  _request: Request,
  {
    params,
  }: { params: Promise<{ id: string; agentId: string }> }
) {
  try {
    const { id, agentId } = await params;
    await agentsService.deleteSubagent(id, agentId);
    return NextResponse.json({ success: true });
  } catch (error) {
    return errorResponse(error, "DELETE");
  }
}

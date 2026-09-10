import { NextResponse } from "next/server";
import { projectService } from "@backend/projects/project.service";
import { ValidationError, ConflictError, NotFoundError } from "@backend/errors";

export async function GET() {
  try {
    const projects = await projectService.listProjects();
    return NextResponse.json(projects);
  } catch (error) {
    console.error("GET /api/projects error:", error);
    return NextResponse.json(
      { error: "Failed to fetch projects." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const project = await projectService.createProject({
      name: body.name,
      repositoryPath: body.repositoryPath ?? null,
    });
    return NextResponse.json(project, { status: 201 });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof ConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("POST /api/projects error:", error);
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 }
    );
  }
}

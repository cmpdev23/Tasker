import { NextResponse } from "next/server";
import { projectService } from "@backend/projects/project.service";
import { taskerService } from "@backend/tasker/tasker.service";
import { gitService } from "@backend/git/git.service";
import { NotFoundError, ValidationError, ConflictError } from "@backend/errors";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const project = await projectService.getProjectById(id);

    if (!project.repositoryPath) {
      return NextResponse.json(
        { error: "A repository path must be selected before initializing Tasker." },
        { status: 400 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const baseBranch =
      body.baseBranch?.trim() ||
      project.defaultBranch ||
      "main";

    await taskerService.initTasker({
      repoPath: project.repositoryPath,
      projectName: project.name,
      baseBranch,
    });

    // Update SQLite defaultBranch as well
    const updated = await projectService.updateProject(id, {
      defaultBranch: baseBranch,
    });

    const inspection = await gitService.inspectRepository(project.repositoryPath);

    return NextResponse.json({
      success: true,
      project: updated,
      inspection,
      effectiveDefaultBranch: baseBranch,
    });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof ConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    console.error("POST /api/projects/[id]/init-tasker error:", error);
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 }
    );
  }
}

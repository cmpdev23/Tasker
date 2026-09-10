import { NextResponse } from "next/server";
import { projectService } from "@backend/projects/project.service";
import { gitService } from "@backend/git/git.service";
import { NotFoundError, ValidationError } from "@backend/errors";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const project = await projectService.getProjectById(id);

    const { searchParams } = new URL(request.url);
    const customPath = searchParams.get("path");
    const targetPath = customPath !== null ? customPath : project.repositoryPath;

    const inspection = await gitService.inspectRepository(targetPath);

    // Rule: if .tasker/project.toml has base_branch, it is the authoritative source of truth
    const effectiveDefaultBranch =
      inspection.projectTomlBaseBranch ||
      project.defaultBranch ||
      inspection.currentBranch ||
      (inspection.branches.length > 0 ? inspection.branches[0] : "main");

    return NextResponse.json({
      project,
      inspection,
      effectiveDefaultBranch,
    });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof ValidationError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("GET /api/projects/[id]/git error:", error);
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 }
    );
  }
}

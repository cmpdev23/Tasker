import { NextResponse } from "next/server";
import { taskerService } from "@backend/tasker/tasker.service";
import { NotFoundError, ValidationError } from "@backend/errors";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const result = await taskerService.getProjectInstructions(id);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof ValidationError) {
      if (error.message.startsWith("NO_REPOSITORY:")) {
        return NextResponse.json(
          {
            code: "NO_REPOSITORY",
            error: "Configurez d'abord le repository du projet dans Settings.",
          },
          { status: 400 }
        );
      }
      if (error.message.startsWith("NOT_INITIALIZED:")) {
        return NextResponse.json(
          {
            code: "NOT_INITIALIZED",
            error: "Initialisez Tasker dans Settings avant de configurer les instructions.",
          },
          { status: 400 }
        );
      }
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("GET /api/projects/[id]/instructions error:", error);
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));

    if (typeof body.instructions !== "string") {
      return NextResponse.json(
        { error: "Le champ 'instructions' est requis et doit être une chaîne de caractères." },
        { status: 400 }
      );
    }

    const result = await taskerService.updateProjectInstructions(
      id,
      body.instructions
    );

    return NextResponse.json({
      success: true,
      instructions: result.instructions,
      filePath: result.filePath,
    });
  } catch (error) {
    if (error instanceof NotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    if (error instanceof ValidationError) {
      if (error.message.startsWith("NO_REPOSITORY:")) {
        return NextResponse.json(
          {
            code: "NO_REPOSITORY",
            error: "Configurez d'abord le repository du projet dans Settings.",
          },
          { status: 400 }
        );
      }
      if (error.message.startsWith("NOT_INITIALIZED:")) {
        return NextResponse.json(
          {
            code: "NOT_INITIALIZED",
            error: "Initialisez Tasker dans Settings avant de configurer les instructions.",
          },
          { status: 400 }
        );
      }
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    console.error("PUT /api/projects/[id]/instructions error:", error);
    return NextResponse.json(
      { error: "Internal server error." },
      { status: 500 }
    );
  }
}

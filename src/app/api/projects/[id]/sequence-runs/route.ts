import { runRepository } from "@backend/runs/run.repository";
import { errorResponse } from "@backend/http/api";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const url = new URL(request.url);
    return Response.json({
      runs: runRepository.listSequences(id, url.searchParams.get("sequenceId") ?? undefined,
        url.searchParams.get("before") ?? undefined),
      queue: runRepository.queueStatus(),
    });
  } catch (error) { return errorResponse(error); }
}


import { runRepository } from "@backend/runs/run.repository";
import { sequenceRunRepository } from "@backend/sequences/sequence-run.repository";
import { errorResponse } from "@backend/http/api";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const url = new URL(request.url);
    const runs = runRepository.listSequences(
      id,
      url.searchParams.get("sequenceId") ?? undefined,
      url.searchParams.get("before") ?? undefined,
    );
    const runIds = runs.slice(0, 50).map((run) => run.id);
    const stepRuns = sequenceRunRepository.listForRuns(runIds);
    return Response.json({
      runs,
      stepRuns,
      queue: runRepository.queueStatus(),
    });
  } catch (error) { return errorResponse(error); }
}

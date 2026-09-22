import { runRepository } from "@backend/runs/run.repository";
import { sequenceRunRepository } from "@backend/sequences/sequence-run.repository";
import { sequenceRunService } from "@backend/sequences/sequence-run.service";
import { errorResponse, assertLocalRequest } from "@backend/http/api";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string; sequenceId: string }> };

export async function POST(request: Request, { params }: Context) {
  try {
    assertLocalRequest(request);
    const { id, sequenceId } = await params;
    return Response.json({ run: await sequenceRunService.enqueue(id, sequenceId) }, { status: 202 });
  } catch (error) { return errorResponse(error); }
}

export async function GET(request: Request, { params }: Context) {
  try {
    const { id, sequenceId } = await params;
    const before = new URL(request.url).searchParams.get("before") ?? undefined;
    const runs = runRepository.listSequences(id, sequenceId, before);
    const runIds = runs.slice(0, 50).map((r) => r.id);
    const stepRuns = sequenceRunRepository.listForRuns(runIds);
    return Response.json({ runs, stepRuns });
  } catch (error) { return errorResponse(error); }
}

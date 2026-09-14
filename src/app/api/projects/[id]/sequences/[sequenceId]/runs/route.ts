import { runRepository } from "@backend/runs/run.repository";
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
    return Response.json({ runs: runRepository.listSequences(id, sequenceId, before) });
  } catch (error) { return errorResponse(error); }
}


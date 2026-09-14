import { sequenceService } from "@backend/sequences/sequence.service";
import { errorResponse, assertLocalRequest } from "@backend/http/api";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return Response.json({ sequences: await sequenceService.list(id) });
  } catch (error) { return errorResponse(error); }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    assertLocalRequest(request);
    const { id } = await params;
    const body = await request.json();
    return Response.json({ sequence: await sequenceService.create(id, body.sequence ?? body) }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}


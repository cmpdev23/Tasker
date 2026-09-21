import { NextResponse } from "next/server";
import { filesystemService } from "@backend/filesystem/filesystem.service";
import { assertLocalRequest } from "@backend/http/api";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    assertLocalRequest(request);
    return NextResponse.json(await filesystemService.openPythonExecutablePicker());
  } catch (error) {
    console.error("POST /api/filesystem/browse-python error:", error);
    return NextResponse.json({ error: "Failed to open the local Python picker." }, { status: 500 });
  }
}

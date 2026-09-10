import { NextResponse } from "next/server";
import { filesystemService } from "@backend/filesystem/filesystem.service";

export async function POST() {
  try {
    const result = await filesystemService.openDirectoryPicker();
    return NextResponse.json(result);
  } catch (error) {
    console.error("POST /api/filesystem/browse error:", error);
    return NextResponse.json(
      { error: "Failed to open directory picker." },
      { status: 500 }
    );
  }
}

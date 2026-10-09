import { NextResponse, type NextRequest } from "next/server";
import { hasValidSession } from "@/lib/auth/session";
import {
  createSupabaseHusMediaRepository,
  isSupabaseHusMediaError,
} from "@/lib/repositories/supabase-hus-media-repository";
import { isSupabaseServerConfigured } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  const guard = await requireReadySession(request);
  if (guard) {
    return guard;
  }

  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: "Expected photo id." }, { status: 400 });
  }

  try {
    const result = await createSupabaseHusMediaRepository().downloadPhoto(id);
    return new NextResponse(await result.file.arrayBuffer(), {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": contentDisposition(result.photo.originalFileName),
        "Content-Type": result.photo.contentType,
      },
    });
  } catch (error) {
    logServerError(error);
    const status = error instanceof Error && error.message.includes("metadatus") ? 404 : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Supabase operation failed." }, { status });
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const guard = await requireReadySession(request);
  if (guard) {
    return guard;
  }

  const { id } = await context.params;
  if (!id) {
    return NextResponse.json({ error: "Expected photo id." }, { status: 400 });
  }

  try {
    const result = await createSupabaseHusMediaRepository().deletePhoto(id);
    return NextResponse.json({ ok: true, storageRemoved: result.storageRemoved });
  } catch (error) {
    logServerError(error);
    const status = error instanceof Error && error.message.includes("metadatus") ? 404 : 500;
    return NextResponse.json({ error: error instanceof Error ? error.message : "Supabase operation failed." }, { status });
  }
}

async function requireReadySession(request: NextRequest): Promise<NextResponse | null> {
  if (!(await hasValidSession(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isSupabaseServerConfigured()) {
    return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  }

  return null;
}

function contentDisposition(fileName: string): string {
  const fallback = safeAsciiFileName(fileName);
  return `inline; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

function safeAsciiFileName(fileName: string): string {
  const safe = fileName
    .normalize("NFKD")
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/[\\"]/g, "")
    .trim();

  return safe || "hus-photo";
}

function logServerError(error: unknown) {
  if (isSupabaseHusMediaError(error)) {
    console.error("Supabase HUS media photo API error", {
      code: error.code,
      details: error.details,
      hint: error.hint,
      message: error.message,
    });
    return;
  }

  console.error("HUS media photo API error", error);
}

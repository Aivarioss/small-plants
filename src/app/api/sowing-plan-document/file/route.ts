import { NextResponse, type NextRequest } from "next/server";
import { hasValidSession } from "@/lib/auth/session";
import {
  createSupabaseSowingPlanDocumentRepository,
  isSupabasePlanDocumentError,
} from "@/lib/repositories/supabase-sowing-plan-document-repository";
import { isSupabaseServerConfigured } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const guard = await requireReadySession(request);
  if (guard) {
    return guard;
  }

  try {
    const result = await createSupabaseSowingPlanDocumentRepository().downloadCurrent();
    if (!result) {
      return NextResponse.json({ error: "No sowing plan document." }, { status: 404 });
    }

    return new NextResponse(await result.file.arrayBuffer(), {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Disposition": contentDisposition(result.document.originalFileName),
        "Content-Type": result.document.contentType,
      },
    });
  } catch (error) {
    logServerError(error);
    return NextResponse.json({ error: error instanceof Error ? error.message : "Supabase operation failed." }, { status: 500 });
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

  return safe || "sowing-plan";
}

function logServerError(error: unknown) {
  if (isSupabasePlanDocumentError(error)) {
    console.error("Supabase sowing-plan-document file API error", {
      code: error.code,
      details: error.details,
      hint: error.hint,
      message: error.message,
    });
    return;
  }

  console.error("Sowing-plan-document file API error", error);
}

import { NextResponse, type NextRequest } from "next/server";
import { hasValidSession } from "@/lib/auth/session";
import {
  createSupabaseSowingPlanDocumentRepository,
  isSupabasePlanDocumentError,
  validateSowingPlanDocumentFile,
} from "@/lib/repositories/supabase-sowing-plan-document-repository";
import { isSupabaseServerConfigured } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const guard = await requireReadySession(request);
  if (guard) {
    return guard;
  }

  try {
    const document = await createSupabaseSowingPlanDocumentRepository().loadCurrent();
    return NextResponse.json({ document });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const guard = await requireReadySession(request);
  if (guard) {
    return guard;
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Expected file." }, { status: 400 });
  }

  try {
    validateSowingPlanDocumentFile(file);
    const document = await createSupabaseSowingPlanDocumentRepository().saveCurrent(file);
    return NextResponse.json({ document });
  } catch (error) {
    return errorResponse(error);
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

function errorResponse(error: unknown): NextResponse {
  logServerError(error);

  const status = error instanceof Error && (error.message.includes("Atļauti tikai") || error.message.includes("Fails ir"))
    ? error.message.includes("10 MB") ? 413 : 400
    : 500;

  return NextResponse.json({ error: safeErrorMessage(error) }, { status });
}

function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return "Supabase operation failed.";
}

function logServerError(error: unknown) {
  if (isSupabasePlanDocumentError(error)) {
    console.error("Supabase sowing-plan-document API error", {
      code: error.code,
      details: error.details,
      hint: error.hint,
      message: error.message,
    });
    return;
  }

  console.error("Sowing-plan-document API error", error);
}

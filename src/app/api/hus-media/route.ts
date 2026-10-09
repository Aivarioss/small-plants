import { NextResponse, type NextRequest } from "next/server";
import { hasValidSession } from "@/lib/auth/session";
import {
  createSupabaseHusMediaRepository,
  isSupabaseHusMediaError,
  validateHusPhotoFile,
} from "@/lib/repositories/supabase-hus-media-repository";
import { isSupabaseServerConfigured } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const guard = await requireReadySession(request);
  if (guard) {
    return guard;
  }

  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json({ error: "Expected form data." }, { status: 400 });
  }

  const rowId = stringField(formData, "rowId");
  const eventId = stringField(formData, "eventId");
  const note = stringField(formData, "note");
  const observationDate = stringField(formData, "observationDate");
  const files = formData.getAll("photos").filter((value): value is File => value instanceof File && value.size > 0);

  if (!rowId) {
    return NextResponse.json({ error: "Expected Hus id." }, { status: 400 });
  }

  if (!note && files.length === 0) {
    return NextResponse.json({ error: "Pievieno piezīmi vai fotogrāfiju." }, { status: 400 });
  }

  try {
    files.forEach(validateHusPhotoFile);
    const result = await createSupabaseHusMediaRepository().save({
      eventId,
      files,
      note,
      observationDate,
      rowId,
    });
    return NextResponse.json(result);
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

function stringField(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function errorResponse(error: unknown): NextResponse {
  logServerError(error);

  if (error instanceof Error) {
    if (error.message.includes("Atļauti tikai") || error.message.includes("Fails ir tukšs")) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    if (error.message.includes("10 MB")) {
      return NextResponse.json({ error: error.message }, { status: 413 });
    }

    if (error.message.includes("netika atrasts")) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
  }

  return NextResponse.json({ error: safeErrorMessage(error) }, { status: 500 });
}

function safeErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Supabase operation failed.";
}

function logServerError(error: unknown) {
  if (isSupabaseHusMediaError(error)) {
    console.error("Supabase HUS media API error", {
      code: error.code,
      details: error.details,
      hint: error.hint,
      message: error.message,
    });
    return;
  }

  console.error("HUS media API error", error);
}

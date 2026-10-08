import { NextResponse, type NextRequest } from "next/server";
import { hasValidSession } from "@/lib/auth/session";
import {
  createSupabaseSowingPlanRepository,
  SowingPlanArchivedError,
  SowingPlanConflictError,
  SowingPlanNotFoundError,
} from "@/lib/repositories/supabase-sowing-plan-repository";
import { isSupabaseServerConfigured } from "@/lib/supabase/server";

type ArchiveRequestBody = {
  id?: unknown;
  note?: unknown;
};

export async function GET(request: NextRequest) {
  const guard = await requireReadySession(request);
  if (guard) {
    return guard;
  }

  try {
    const repository = createSupabaseSowingPlanRepository();
    const rows = await repository.loadArchived();
    return NextResponse.json({ rows });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  const guard = await requireReadySession(request);
  if (guard) {
    return guard;
  }

  const body = await parseBody(request);
  if (!body || typeof body.id !== "string") {
    return NextResponse.json({ error: "Expected a Hus id." }, { status: 400 });
  }

  try {
    const repository = createSupabaseSowingPlanRepository();
    const row = await repository.archive(body.id, typeof body.note === "string" ? body.note : undefined);
    return NextResponse.json({ row });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  const guard = await requireReadySession(request);
  if (guard) {
    return guard;
  }

  const body = await parseBody(request);
  if (!body || typeof body.id !== "string") {
    return NextResponse.json({ error: "Expected a Hus id." }, { status: 400 });
  }

  try {
    const repository = createSupabaseSowingPlanRepository();
    const row = await repository.restore(body.id);
    return NextResponse.json({ row });
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

async function parseBody(request: NextRequest): Promise<ArchiveRequestBody | null> {
  return (await request.json().catch(() => null)) as ArchiveRequestBody | null;
}

function errorResponse(error: unknown): NextResponse {
  if (error instanceof SowingPlanConflictError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }

  if (error instanceof SowingPlanNotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }

  if (error instanceof SowingPlanArchivedError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }

  console.error("HUS archive API error", error);
  return NextResponse.json({ error: error instanceof Error ? error.message : "HUS archive operation failed." }, { status: 500 });
}

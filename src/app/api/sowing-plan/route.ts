import { NextResponse, type NextRequest } from "next/server";
import { hasValidSession } from "@/lib/auth/session";
import {
  createSupabaseSowingPlanRepository,
  SowingPlanConflictError,
  SowingPlanNotFoundError,
} from "@/lib/repositories/supabase-sowing-plan-repository";
import { isSupabaseServerConfigured } from "@/lib/supabase/server";
import type { SowingPlanRow } from "@/lib/types";

type RowRequestBody = {
  expectedUpdatedAt?: unknown;
  id?: unknown;
  row?: unknown;
};

export async function GET(request: NextRequest) {
  const guard = await requireReadySession(request);
  if (guard) {
    return guard;
  }

  try {
    const repository = createSupabaseSowingPlanRepository();
    const rows = await repository.load();

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
  const validationError = validateRow(body?.row);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }
  if (!body) {
    return NextResponse.json({ error: "Expected a request body." }, { status: 400 });
  }

  try {
    const repository = createSupabaseSowingPlanRepository();
    const row = await repository.create(body.row as SowingPlanRow);
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
  const validationError = validateRow(body?.row);
  if (validationError) {
    return NextResponse.json({ error: validationError }, { status: 400 });
  }
  if (!body) {
    return NextResponse.json({ error: "Expected a request body." }, { status: 400 });
  }

  try {
    const repository = createSupabaseSowingPlanRepository();
    const row = await repository.update(
      body.row as SowingPlanRow,
      typeof body.expectedUpdatedAt === "string" ? body.expectedUpdatedAt : undefined,
    );
    return NextResponse.json({ row });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest) {
  const guard = await requireReadySession(request);
  if (guard) {
    return guard;
  }

  const body = await parseBody(request);
  if (!body || typeof body.id !== "string") {
    return NextResponse.json({ error: "Expected a row id." }, { status: 400 });
  }

  try {
    const repository = createSupabaseSowingPlanRepository();
    await repository.delete(body.id, typeof body.expectedUpdatedAt === "string" ? body.expectedUpdatedAt : undefined);
    return NextResponse.json({ ok: true });
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

async function parseBody(request: NextRequest): Promise<RowRequestBody | null> {
  return (await request.json().catch(() => null)) as RowRequestBody | null;
}

function validateRow(row: unknown): string | null {
  if (!isRecord(row)) {
    return "Expected a row object.";
  }

  if (
    typeof row.id !== "string" ||
    typeof row.sectorName !== "string" ||
    typeof row.variety !== "string" ||
    typeof row.sowingDate !== "string" ||
    typeof row.harvestDate !== "string"
  ) {
    return "Every row must include id, Hus, variety, sowing date and move-out date.";
  }

  if (
    !Number.isFinite(Number(row.requiredPlants)) ||
    !Number.isFinite(Number(row.extraPlants)) ||
    !Number.isFinite(Number(row.cycleLength)) ||
    ![26, 39].includes(Number(row.sectorType))
  ) {
    return "Every row must include valid plant counts, cycle length and sector type.";
  }

  if (
    row.greenhouseRequiredPlants !== undefined &&
    row.greenhouseRequiredPlants !== null &&
    (!Number.isFinite(Number(row.greenhouseRequiredPlants)) || Number(row.greenhouseRequiredPlants) <= 0)
  ) {
    return "Greenhouse required plants must be a positive number when provided.";
  }

  return null;
}

function errorResponse(error: unknown): NextResponse {
  if (error instanceof SowingPlanConflictError) {
    return NextResponse.json({ error: error.message }, { status: 409 });
  }

  if (error instanceof SowingPlanNotFoundError) {
    return NextResponse.json({ error: error.message }, { status: 404 });
  }

  return NextResponse.json({ error: error instanceof Error ? error.message : "Supabase operation failed." }, { status: 500 });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

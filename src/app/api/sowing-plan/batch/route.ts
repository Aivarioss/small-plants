import { NextResponse, type NextRequest } from "next/server";
import { hasValidSession } from "@/lib/auth/session";
import { importPlanBatch, SowingPlanConflictError } from "@/lib/repositories/supabase-sowing-plan-repository";
import { isSupabaseServerConfigured } from "@/lib/supabase/server";
import { validateRow } from "@/lib/sowing-plan-validation";
import { WriteOutcomeError } from "@/lib/write-outcome";
import type { PlanImportBatch } from "@/lib/repositories/types";

export async function POST(request: NextRequest) {
  if (!(await hasValidSession(request))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSupabaseServerConfigured()) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  const body = await request.json().catch(() => null) as PlanImportBatch | null;
  if (!body || typeof body.id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.id)
    || !Array.isArray(body.items) || body.items.length < 1 || body.items.length > 500
    || body.items.some(item => !item || !["create", "update"].includes(item.operation) || validateRow(item.row))) {
    return NextResponse.json({ error: "Nederīgs importa komplekts." }, { status: 400 });
  }
  try {
    const ids = await importPlanBatch(body);
    return NextResponse.json({ writeStatus: "committed", ids });
  } catch (error) {
    if (error instanceof WriteOutcomeError) return NextResponse.json({ writeStatus: error.writeStatus, ids: error.ids, error: error.message }, { status: 503 });
    return NextResponse.json({ writeStatus: "failed", error: error instanceof Error ? error.message : "Imports nav saglabāts." }, { status: error instanceof SowingPlanConflictError ? 409 : 500 });
  }
}

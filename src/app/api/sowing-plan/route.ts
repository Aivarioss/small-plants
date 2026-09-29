import { NextResponse } from "next/server";
import { createSupabaseSowingPlanRepository } from "@/lib/repositories/supabase-sowing-plan-repository";
import { isSupabaseServerConfigured } from "@/lib/supabase/server";

export async function GET() {
  if (!isSupabaseServerConfigured()) {
    return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  }

  const repository = createSupabaseSowingPlanRepository();
  const rows = await repository.load();

  return NextResponse.json({ rows });
}

export function PUT() {
  return NextResponse.json(
    { error: "Supabase writes are prepared in the server repository but not enabled for migration yet." },
    { status: 501 },
  );
}

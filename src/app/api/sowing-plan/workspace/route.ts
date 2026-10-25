import { NextResponse, type NextRequest } from "next/server";
import { hasValidSession } from "@/lib/auth/session";
import { isSupabaseServerConfigured } from "@/lib/supabase/server";
import { loadWorkspaceRowsFromSupabase } from "@/lib/repositories/supabase-sowing-plan-repository";

export async function GET(request: NextRequest) {
  if (!(await hasValidSession(request))) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!isSupabaseServerConfigured()) return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  try {
    const rows = await loadWorkspaceRowsFromSupabase();
    return NextResponse.json({ rows }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Neizdevās ielādēt pilno plānu." }, { status: 500 });
  }
}

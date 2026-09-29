import "server-only";
import type { SowingPlanRow } from "@/lib/types";
import type { SowingPlanRowRecord, SowingPlanRowWithRelations } from "@/lib/supabase/database";
import { recordToSowingPlanRow, sowingPlanRowToRecord } from "@/lib/supabase/mappers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { RemoteSowingPlanRepository } from "./types";

export function createSupabaseSowingPlanRepository(): RemoteSowingPlanRepository {
  return {
    load: loadRowsFromSupabase,
    save: saveRowsToSupabase,
  };
}

async function loadRowsFromSupabase(): Promise<SowingPlanRow[]> {
  const client = createSupabaseServerClient();

  const { data, error } = await client
    .from("sowing_plan_rows")
    .select("*, work_adjustments(*), table_placements(*), change_history(*)")
    .order("sowing_date", { ascending: true });

  if (error) {
    throw error;
  }

  return ((data ?? []) as SowingPlanRowWithRelations[]).map(recordToSowingPlanRow);
}

async function saveRowsToSupabase(rows: SowingPlanRow[]): Promise<void> {
  const client = createSupabaseServerClient();

  const records = rows.map(sowingPlanRowToRecord).filter((record): record is SowingPlanRowRecord => Boolean(record));

  if (records.length === 0) {
    return;
  }

  const { error } = await client.from("sowing_plan_rows").upsert(records, { onConflict: "id" });

  if (error) {
    throw error;
  }
}

import "server-only";
import type { SowingPlanRow } from "@/lib/types";
import type {
  ChangeHistoryRecord,
  PlantCorrectionRecord,
  SowingPlanRowWithRelations,
  TablePlacementRecord,
  WorkAdjustmentRecord,
} from "@/lib/supabase/database";
import {
  recordToSowingPlanRow,
  rowAdjustmentsToRecords,
  rowChangeHistoryToRecords,
  rowPlantCorrectionsToRecords,
  rowPlacementToRecord,
  sowingPlanRowToRecord,
} from "@/lib/supabase/mappers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { RemoteSowingPlanRepository } from "./types";

export class SowingPlanConflictError extends Error {
  constructor(message = "This Hus changed elsewhere. Reload and review before saving again.") {
    super(message);
    this.name = "SowingPlanConflictError";
  }
}

export class SowingPlanNotFoundError extends Error {
  constructor(message = "This Hus no longer exists.") {
    super(message);
    this.name = "SowingPlanNotFoundError";
  }
}

export function createSupabaseSowingPlanRepository(): RemoteSowingPlanRepository {
  return {
    create: createRowInSupabase,
    delete: deleteRowFromSupabase,
    load: loadRowsFromSupabase,
    update: updateRowInSupabase,
  };
}

async function loadRowsFromSupabase(): Promise<SowingPlanRow[]> {
  const client = createSupabaseServerClient();

  const { data, error } = await client
    .from("sowing_plan_rows")
    .select("*, work_adjustments(*), table_placements(*), change_history(*), plant_corrections(*)")
    .order("sowing_date", { ascending: true });

  if (error && isPlantCorrectionsRelationError(error)) {
    const fallback = await client
      .from("sowing_plan_rows")
      .select("*, work_adjustments(*), table_placements(*), change_history(*)")
      .order("sowing_date", { ascending: true });

    if (fallback.error) {
      throw fallback.error;
    }

    return ((fallback.data ?? []) as SowingPlanRowWithRelations[]).map(recordToSowingPlanRow);
  }

  if (error) {
    throw error;
  }

  return ((data ?? []) as SowingPlanRowWithRelations[]).map(recordToSowingPlanRow);
}

async function createRowInSupabase(row: SowingPlanRow): Promise<SowingPlanRow> {
  const client = createSupabaseServerClient();
  const record = sowingPlanRowToRecord(row);

  if (!record) {
    throw new Error("Demo rows cannot be saved to Supabase.");
  }

  const { error } = await client.from("sowing_plan_rows").insert(record);
  if (error) {
    throw error;
  }

  await replaceWorkAdjustments(row);
  await replaceTablePlacement(row);
  await replacePlantCorrections(row);
  await upsertChangeHistory(row);

  return loadRowById(row.id);
}

async function updateRowInSupabase(row: SowingPlanRow, expectedUpdatedAt?: string): Promise<SowingPlanRow> {
  const client = createSupabaseServerClient();
  const record = sowingPlanRowToRecord(row);

  if (!record) {
    throw new Error("Demo rows cannot be saved to Supabase.");
  }

  await assertCurrentVersion(row.id, expectedUpdatedAt);

  const patch = rowRecordUpdatePatch(record);
  let query = client.from("sowing_plan_rows").update(patch).eq("id", row.id);
  if (expectedUpdatedAt) {
    query = query.eq("updated_at", expectedUpdatedAt);
  }

  const { data, error } = await query.select("id").maybeSingle();
  if (error) {
    throw error;
  }

  if (!data) {
    throw new SowingPlanConflictError();
  }

  await replaceWorkAdjustments(row);
  await replaceTablePlacement(row);
  await replacePlantCorrections(row);
  await upsertChangeHistory(row);

  return loadRowById(row.id);
}

async function deleteRowFromSupabase(id: string, expectedUpdatedAt?: string): Promise<void> {
  const client = createSupabaseServerClient();

  await assertCurrentVersion(id, expectedUpdatedAt);

  let query = client.from("sowing_plan_rows").delete().eq("id", id);
  if (expectedUpdatedAt) {
    query = query.eq("updated_at", expectedUpdatedAt);
  }

  const { data, error } = await query.select("id").maybeSingle();
  if (error) {
    throw error;
  }

  if (!data) {
    throw new SowingPlanConflictError();
  }
}

async function loadRowById(id: string): Promise<SowingPlanRow> {
  const client = createSupabaseServerClient();
  const { data, error } = await client
    .from("sowing_plan_rows")
    .select("*, work_adjustments(*), table_placements(*), change_history(*), plant_corrections(*)")
    .eq("id", id)
    .single();

  if (error && isPlantCorrectionsRelationError(error)) {
    const fallback = await client
      .from("sowing_plan_rows")
      .select("*, work_adjustments(*), table_placements(*), change_history(*)")
      .eq("id", id)
      .single();

    if (fallback.error) {
      throw fallback.error;
    }

    return recordToSowingPlanRow(fallback.data as SowingPlanRowWithRelations);
  }

  if (error) {
    throw error;
  }

  return recordToSowingPlanRow(data as SowingPlanRowWithRelations);
}

async function assertCurrentVersion(id: string, expectedUpdatedAt?: string): Promise<void> {
  if (!expectedUpdatedAt) {
    return;
  }

  const client = createSupabaseServerClient();
  const { data, error } = await client.from("sowing_plan_rows").select("updated_at").eq("id", id).maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    throw new SowingPlanNotFoundError();
  }

  if (data.updated_at !== expectedUpdatedAt) {
    throw new SowingPlanConflictError();
  }
}

async function replaceWorkAdjustments(row: SowingPlanRow): Promise<void> {
  const client = createSupabaseServerClient();

  const { error: deleteError } = await client.from("work_adjustments").delete().eq("sowing_plan_row_id", row.id);
  if (deleteError) {
    throw deleteError;
  }

  const records = rowAdjustmentsToRecords(row, "manual");
  if (records.length === 0) {
    return;
  }

  const { error } = await client
    .from("work_adjustments")
    .upsert(records as WorkAdjustmentRecord[], { onConflict: "sowing_plan_row_id,work_type" });

  if (error) {
    throw error;
  }
}

async function replaceTablePlacement(row: SowingPlanRow): Promise<void> {
  const client = createSupabaseServerClient();

  const { error: deleteError } = await client.from("table_placements").delete().eq("sowing_plan_row_id", row.id);
  if (deleteError) {
    throw deleteError;
  }

  const record = rowPlacementToRecord(row);
  if (!record) {
    return;
  }

  const { error } = await client.from("table_placements").upsert(record as TablePlacementRecord, {
    onConflict: "sowing_plan_row_id",
  });

  if (error) {
    throw error;
  }
}

async function replacePlantCorrections(row: SowingPlanRow): Promise<void> {
  const client = createSupabaseServerClient();

  const { error: deleteError } = await client.from("plant_corrections").delete().eq("sowing_plan_row_id", row.id);
  if (deleteError && isPlantCorrectionsRelationError(deleteError) && (row.plantCorrections ?? []).length === 0) {
    return;
  }
  if (deleteError) {
    throw deleteError;
  }

  const records = rowPlantCorrectionsToRecords(row);
  if (records.length === 0) {
    return;
  }

  const { error } = await client.from("plant_corrections").upsert(records as PlantCorrectionRecord[], { onConflict: "id" });

  if (error) {
    throw error;
  }
}

async function upsertChangeHistory(row: SowingPlanRow): Promise<void> {
  const client = createSupabaseServerClient();
  const records = rowChangeHistoryToRecords(row).filter((record): record is ChangeHistoryRecord => Boolean(record.id));

  if (records.length === 0) {
    return;
  }

  const { error } = await client.from("change_history").upsert(records, { onConflict: "id" });

  if (error) {
    throw error;
  }
}

function rowRecordUpdatePatch(record: NonNullable<ReturnType<typeof sowingPlanRowToRecord>>) {
  return {
    correction: record.correction,
    cycle_length: record.cycle_length,
    extra_plants: record.extra_plants,
    hus: record.hus,
    move_out_date: record.move_out_date,
    previcure_date: record.previcure_date,
    required_plants: record.required_plants,
    sector_type: record.sector_type,
    source: record.source,
    sowing_tables: record.sowing_tables,
    sowing_date: record.sowing_date,
    status: record.status,
    variety: record.variety,
    week_number: record.week_number,
  };
}

function isPlantCorrectionsRelationError(error: unknown): boolean {
  const candidate = error as { code?: unknown; message?: unknown };
  const code = typeof candidate.code === "string" ? candidate.code : "";
  const message = typeof candidate.message === "string" ? candidate.message : "";
  const haystack = `${code} ${message}`.toLowerCase();

  return (
    haystack.includes("plant_corrections") &&
    (haystack.includes("pgrst200") ||
      haystack.includes("pgrst205") ||
      haystack.includes("42p01") ||
      haystack.includes("relationship") ||
      haystack.includes("schema cache") ||
      haystack.includes("does not exist"))
  );
}

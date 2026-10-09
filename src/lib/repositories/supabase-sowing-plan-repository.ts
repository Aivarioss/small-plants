import "server-only";
import { plannerConfig } from "@/lib/demo-data";
import { buildArchiveSnapshot, freezeWorkAdjustmentsForStableActiveSchedule } from "@/lib/planning";
import type { SowingPlanRow, WorkAdjustments } from "@/lib/types";
import type {
  ChangeHistoryRecord,
  HusEventRecord,
  PlantCorrectionRecord,
  SowingPlanRowWithRelations,
  TablePlacementRecord,
  WorkAdjustmentRecord,
} from "@/lib/supabase/database";
import {
  recordToSowingPlanRow,
  rowAdjustmentsToRecords,
  rowChangeHistoryToRecords,
  rowHusEventsToRecords,
  rowPlantCorrectionsToRecords,
  rowPlacementToRecord,
  sowingPlanRowToRecord,
} from "@/lib/supabase/mappers";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const SOWING_PLAN_SELECT =
  "*, work_adjustments(*), table_placements(*), change_history(*), plant_corrections(*), hus_events(*), hus_notes(*), hus_photos(*)";
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

export class SowingPlanArchivedError extends Error {
  constructor(message = "This Hus is archived and can only be viewed or restored.") {
    super(message);
    this.name = "SowingPlanArchivedError";
  }
}

export class SupabasePersistenceError extends Error {
  code?: string;
  details?: string;
  hint?: string;
  operation: string;

  constructor(operation: string, error: unknown) {
    const summary = supabaseErrorSummary(error);
    super(`${operation}: ${summary}`);
    this.name = "SupabasePersistenceError";
    this.operation = operation;

    const candidate = error as { code?: unknown; details?: unknown; hint?: unknown };
    this.code = typeof candidate.code === "string" ? candidate.code : undefined;
    this.details = typeof candidate.details === "string" ? candidate.details : undefined;
    this.hint = typeof candidate.hint === "string" ? candidate.hint : undefined;
  }
}

export function createSupabaseSowingPlanRepository(): RemoteSowingPlanRepository {
  return {
    archive: archiveRowInSupabase,
    create: createRowInSupabase,
    delete: deleteRowFromSupabase,
    load: loadRowsFromSupabase,
    loadArchived: loadArchivedRowsFromSupabase,
    restore: restoreRowInSupabase,
    update: updateRowInSupabase,
  };
}

async function loadRowsFromSupabase(): Promise<SowingPlanRow[]> {
  const client = createSupabaseServerClient();

  const { data, error } = await client
    .from("sowing_plan_rows")
    .select(SOWING_PLAN_SELECT)
    .is("archived_at", null)
    .order("sowing_date", { ascending: true });

  if (error && isOptionalRelationError(error)) {
    const fallbackSelect = isHusEventsRelationError(error)
      ? "*, work_adjustments(*), table_placements(*), change_history(*), plant_corrections(*)"
      : "*, work_adjustments(*), table_placements(*), change_history(*)";
    const fallback = await client.from("sowing_plan_rows").select(fallbackSelect).is("archived_at", null).order("sowing_date", { ascending: true });

    if (fallback.error) {
      throw fallback.error;
    }

    return ((fallback.data ?? []) as unknown as SowingPlanRowWithRelations[]).map(recordToSowingPlanRow);
  }

  if (error) {
    throw error;
  }

  return ((data ?? []) as SowingPlanRowWithRelations[]).map(recordToSowingPlanRow);
}

async function loadArchivedRowsFromSupabase(): Promise<SowingPlanRow[]> {
  const client = createSupabaseServerClient();

  const { data, error } = await client
    .from("sowing_plan_rows")
    .select(SOWING_PLAN_SELECT)
    .not("archived_at", "is", null)
    .order("archived_at", { ascending: false });

  if (error && isOptionalRelationError(error)) {
    const fallbackSelect = isHusEventsRelationError(error)
      ? "*, work_adjustments(*), table_placements(*), change_history(*), plant_corrections(*)"
      : "*, work_adjustments(*), table_placements(*), change_history(*)";
    const fallback = await client
      .from("sowing_plan_rows")
      .select(fallbackSelect)
      .not("archived_at", "is", null)
      .order("archived_at", { ascending: false });

    if (fallback.error) {
      throw fallback.error;
    }

    return ((fallback.data ?? []) as unknown as SowingPlanRowWithRelations[]).map(recordToSowingPlanRow);
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
  await replaceHusEvents(row);
  await upsertChangeHistory(row);

  return loadRowById(row.id);
}

async function updateRowInSupabase(row: SowingPlanRow, expectedUpdatedAt?: string): Promise<SowingPlanRow> {
  const client = createSupabaseServerClient();
  const record = sowingPlanRowToRecord(row);

  if (!record) {
    throw new Error("Demo rows cannot be saved to Supabase.");
  }

  const currentUpdatedAt = await assertCurrentVersion(row.id, expectedUpdatedAt);

  const patch = rowRecordUpdatePatch(record);
  let query = client.from("sowing_plan_rows").update(patch).eq("id", row.id).is("archived_at", null);
  if (currentUpdatedAt) {
    query = query.eq("updated_at", currentUpdatedAt);
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
  await replaceHusEvents(row);
  await upsertChangeHistory(row);

  return loadRowById(row.id);
}

async function deleteRowFromSupabase(id: string, expectedUpdatedAt?: string): Promise<void> {
  const client = createSupabaseServerClient();

  const currentUpdatedAt = await assertCurrentVersion(id, expectedUpdatedAt);

  let query = client.from("sowing_plan_rows").delete().eq("id", id).is("archived_at", null);
  if (currentUpdatedAt) {
    query = query.eq("updated_at", currentUpdatedAt);
  }

  const { data, error } = await query.select("id").maybeSingle();
  if (error) {
    throw error;
  }

  if (!data) {
    throw new SowingPlanConflictError();
  }
}

async function archiveRowInSupabase(id: string, note?: string): Promise<SowingPlanRow> {
  const client = createSupabaseServerClient();
  const row = await loadRowById(id);

  if (row.archivedAt) {
    throw new SowingPlanArchivedError("This Hus is already archived.");
  }

  const activeRows = await loadRowsFromSupabase();
  await freezeActiveRowsForArchive(client, activeRows, id);
  const archivedAt = new Date().toISOString();
  const snapshot = buildArchiveSnapshot(row, activeRows, plannerConfig, archivedAt, note?.trim() || undefined);

  let query = client
    .from("sowing_plan_rows")
    .update({
      archived_at: archivedAt,
      archived_note: note?.trim() || null,
      archive_snapshot: snapshot,
    })
    .eq("id", id)
    .is("archived_at", null);

  if (row.updatedAt) {
    query = query.eq("updated_at", row.updatedAt);
  }

  const { data, error } = await query.select("id").maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    throw new SowingPlanConflictError("This Hus changed while it was being archived. Reload and archive again.");
  }

  return loadRowById(id);
}

async function restoreRowInSupabase(id: string): Promise<SowingPlanRow> {
  const client = createSupabaseServerClient();
  const row = await loadRowById(id);

  if (!row.archivedAt) {
    return row;
  }

  await assertNoActiveDuplicateForRestore(row);
  const activeRows = await loadRowsFromSupabase();
  await freezeActiveRowsForArchive(client, activeRows, id);

  const { data, error } = await client
    .from("sowing_plan_rows")
    .update({
      archived_at: null,
      archived_note: null,
    })
    .eq("id", id)
    .not("archived_at", "is", null)
    .select("id")
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    throw new SowingPlanConflictError("This Hus was restored elsewhere. Reload and review before trying again.");
  }

  return loadRowById(id);
}

async function assertNoActiveDuplicateForRestore(row: SowingPlanRow): Promise<void> {
  const client = createSupabaseServerClient();
  const { data, error } = await client
    .from("sowing_plan_rows")
    .select("id, hus, sowing_date, move_out_date")
    .eq("sowing_date", row.sowingDate)
    .eq("move_out_date", row.harvestDate)
    .is("archived_at", null);

  if (error) {
    throw error;
  }

  const duplicate = ((data ?? []) as Array<{ id: string; hus: string; sowing_date: string; move_out_date: string }>).find(
    (candidate) =>
      candidate.id !== row.id &&
      normalizeHusIdentity(candidate.hus) === normalizeHusIdentity(row.sectorName) &&
      candidate.sowing_date === row.sowingDate &&
      candidate.move_out_date === row.harvestDate,
  );

  if (duplicate) {
    throw new SowingPlanConflictError("Aktīvajā plānā jau ir identisks HUS cikls. Restore blocked because an identical active cycle already exists.");
  }
}

async function freezeActiveRowsForArchive(
  client: ReturnType<typeof createSupabaseServerClient>,
  activeRows: SowingPlanRow[],
  archivedRowId: string,
): Promise<void> {
  const frozenRows = freezeWorkAdjustmentsForStableActiveSchedule(activeRows, archivedRowId, plannerConfig);
  const originalById = new Map(activeRows.map((row) => [row.id, row]));

  for (const frozenRow of frozenRows) {
    const originalRow = originalById.get(frozenRow.id);
    if (!originalRow || originalRow.id === archivedRowId) {
      continue;
    }

    const records = optimizerAdjustmentRecordsAddedByFreeze(originalRow, frozenRow);
    if (records.length === 0) {
      continue;
    }

    let touchQuery = client
      .from("sowing_plan_rows")
      .update({ status: originalRow.status ?? "planned" })
      .eq("id", originalRow.id)
      .is("archived_at", null);

    if (originalRow.updatedAt) {
      touchQuery = touchQuery.eq("updated_at", originalRow.updatedAt);
    }

    const { data, error } = await touchQuery.select("id").maybeSingle();
    if (error) {
      throw error;
    }

    if (!data) {
      throw new SowingPlanConflictError("Aktīvais plāns mainījās arhivēšanas laikā. Pārlādē un mēģini vēlreiz.");
    }

    const { error: upsertError } = await client
      .from("work_adjustments")
      .upsert(records as WorkAdjustmentRecord[], { onConflict: "sowing_plan_row_id,work_type" });

    if (upsertError) {
      throw upsertError;
    }
  }
}

function optimizerAdjustmentRecordsAddedByFreeze(
  originalRow: SowingPlanRow,
  frozenRow: SowingPlanRow,
): WorkAdjustmentRecord[] {
  return (["thinning", "sideShoots", "sticks"] as Array<keyof WorkAdjustments>).flatMap((workType) => {
    const existing = originalRow.adjustments?.[workType];
    const frozen = frozenRow.adjustments?.[workType];
    const frozenDates = adjustmentDatesForRecord(frozen);

    if (adjustmentDatesForRecord(existing).length > 0 || frozenDates.length === 0) {
      return [];
    }

    return [{
      id: crypto.randomUUID(),
      sowing_plan_row_id: originalRow.id,
      work_type: workType,
      dates: frozenDates,
      source: "optimizer",
      locked: true,
    }];
  });
}

function adjustmentDatesForRecord(value: WorkAdjustments[keyof WorkAdjustments] | undefined): string[] {
  if (Array.isArray(value)) {
    return value.filter(Boolean);
  }

  return value ? [value] : [];
}

function normalizeHusIdentity(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("lv-LV");
}

async function loadRowById(id: string): Promise<SowingPlanRow> {
  const client = createSupabaseServerClient();
  const { data, error } = await client
    .from("sowing_plan_rows")
    .select(SOWING_PLAN_SELECT)
    .eq("id", id)
    .single();

  if (error && isOptionalRelationError(error)) {
    const fallbackSelect = isHusEventsRelationError(error)
      ? "*, work_adjustments(*), table_placements(*), change_history(*), plant_corrections(*)"
      : "*, work_adjustments(*), table_placements(*), change_history(*)";
    const fallback = await client.from("sowing_plan_rows").select(fallbackSelect).eq("id", id).single();

    if (fallback.error) {
      throw fallback.error;
    }

    return recordToSowingPlanRow(fallback.data as unknown as SowingPlanRowWithRelations);
  }

  if (error) {
    throw error;
  }

  return recordToSowingPlanRow(data as SowingPlanRowWithRelations);
}

async function assertCurrentVersion(id: string, expectedUpdatedAt?: string): Promise<string | undefined> {
  if (!expectedUpdatedAt) {
    return undefined;
  }

  const client = createSupabaseServerClient();
  const { data, error } = await client.from("sowing_plan_rows").select("updated_at").eq("id", id).maybeSingle();

  if (error) {
    throw error;
  }

  if (!data) {
    throw new SowingPlanNotFoundError();
  }

  if (!isSameTimestamp(data.updated_at, expectedUpdatedAt)) {
    throw new SowingPlanConflictError();
  }

  return data.updated_at;
}

function isSameTimestamp(left: string, right: string): boolean {
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);

  if (Number.isFinite(leftTime) && Number.isFinite(rightTime)) {
    return leftTime === rightTime;
  }

  return left === right;
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
  if (deleteError && isPlantCorrectionsRelationError(deleteError)) {
    throw new Error("plant_corrections tabula vai relācija nav pieejama. Pārbaudi, vai Supabase plant_corrections migrācija ir palaista un schema cache ir atjaunots.");
  }
  if (deleteError) {
    throw new SupabasePersistenceError("Neizdevās dzēst iepriekšējās stādu korekcijas", deleteError);
  }

  const records = rowPlantCorrectionsToRecords(row);
  if (records.length === 0) {
    return;
  }

  const { error } = await client.from("plant_corrections").upsert(records as PlantCorrectionRecord[], { onConflict: "id" });

  if (error) {
    throw new SupabasePersistenceError("Neizdevās saglabāt stādu korekcijas", error);
  }
}

async function replaceHusEvents(row: SowingPlanRow): Promise<void> {
  const client = createSupabaseServerClient();

  const { error: deleteError } = await client.from("hus_events").delete().eq("sowing_plan_row_id", row.id);
  if (deleteError && isHusEventsRelationError(deleteError) && (row.husEvents ?? []).length === 0) {
    return;
  }
  if (deleteError && isHusEventsRelationError(deleteError)) {
    throw new Error("hus_events tabula vai relācija nav pieejama. Pārbaudi, vai Supabase hus_events migrācija ir palaista un schema cache ir atjaunots.");
  }
  if (deleteError) {
    throw new SupabasePersistenceError("Neizdevās dzēst iepriekšējos HUS žurnāla ierakstus", deleteError);
  }

  const records = rowHusEventsToRecords(row);
  if (records.length === 0) {
    return;
  }

  const { error } = await client.from("hus_events").upsert(records as HusEventRecord[], { onConflict: "id" });

  if (error) {
    throw new SupabasePersistenceError("Neizdevās saglabāt HUS žurnāla ierakstus", error);
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
    greenhouse_required_plants: record.greenhouse_required_plants,
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

function isHusEventsRelationError(error: unknown): boolean {
  return isMissingRelationError(error, "hus_events");
}

function isOptionalRelationError(error: unknown): boolean {
  return (
    isPlantCorrectionsRelationError(error) ||
    isHusEventsRelationError(error) ||
    isMissingRelationError(error, "hus_notes") ||
    isMissingRelationError(error, "hus_photos")
  );
}

function isMissingRelationError(error: unknown, relation: string): boolean {
  const candidate = error as { code?: unknown; message?: unknown };
  const code = typeof candidate.code === "string" ? candidate.code : "";
  const message = typeof candidate.message === "string" ? candidate.message : "";
  const haystack = `${code} ${message}`.toLowerCase();

  return (
    haystack.includes(relation) &&
    (haystack.includes("pgrst200") ||
      haystack.includes("pgrst205") ||
      haystack.includes("42p01") ||
      haystack.includes("relationship") ||
      haystack.includes("schema cache") ||
      haystack.includes("does not exist"))
  );
}

function supabaseErrorSummary(error: unknown): string {
  const candidate = error as { code?: unknown; details?: unknown; hint?: unknown; message?: unknown };
  const parts = [
    typeof candidate.code === "string" ? candidate.code : "",
    typeof candidate.message === "string" ? candidate.message : "",
    typeof candidate.details === "string" ? candidate.details : "",
    typeof candidate.hint === "string" ? candidate.hint : "",
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" · ") : "Supabase operation failed.";
}

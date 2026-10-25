import "server-only";
import { WriteOutcomeError } from "@/lib/write-outcome";
import type { PlanImportBatch } from "./types";
import { plannerConfig } from "@/lib/demo-data";
import { buildArchiveSnapshot, freezeWorkAdjustmentsForStableActiveSchedule } from "@/lib/planning";
import type { SowingPlanRow, WorkAdjustments } from "@/lib/types";
import type {
  SowingPlanRowWithRelations,
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

/** One PostgREST SELECT (including relations) supplies the complete workspace. */
export async function loadWorkspaceRowsFromSupabase(): Promise<SowingPlanRow[]> {
  const { data, error, count } = await createSupabaseServerClient()
    .from("sowing_plan_rows").select(SOWING_PLAN_SELECT, { count: "exact" })
    .order("sowing_date", { ascending: true });
  if (error) throw error;
  // A server row limit must fail closed, not make older/active cycles disappear.
  if (!Array.isArray(data) || count === null || count !== data.length) {
    throw new Error("Pilnā plāna ielāde ir nepilnīga. Dati nav atjaunoti; pārbaudi servera rindu limitu.");
  }
  return (data as SowingPlanRowWithRelations[]).map(recordToSowingPlanRow);
}

async function loadRowsFromSupabase(): Promise<SowingPlanRow[]> {
  const client = createSupabaseServerClient();

  const { data, error } = await client
    .from("sowing_plan_rows")
    .select(SOWING_PLAN_SELECT)
    .is("archived_at", null)
    .order("sowing_date", { ascending: true });

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

  if (error) {
    throw error;
  }

  return ((data ?? []) as SowingPlanRowWithRelations[]).map(recordToSowingPlanRow);
}

async function createRowInSupabase(row: SowingPlanRow): Promise<SowingPlanRow> {
  return saveRowAtomically(row, "create");
}

async function updateRowInSupabase(row: SowingPlanRow, expectedUpdatedAt?: string): Promise<SowingPlanRow> {
  const expected = expectedUpdatedAt ?? row.updatedAt;
  if (!expected) throw new SowingPlanConflictError("Pārlādē HUS pirms saglabāšanas. / Reload the HUS before saving.");
  return saveRowAtomically(row, "update", expected);
}

async function saveRowAtomically(row: SowingPlanRow, operation: "create" | "update", expected?: string): Promise<SowingPlanRow> {
  const record = sowingPlanRowToRecord(row);
  if (!record) throw new Error("Demo rows cannot be saved to Supabase.");
  const client = createSupabaseServerClient();
  const { data, error } = await rpcWrite(client, "save_sowing_plan_row", [row.id], {
    p_operation: operation,
    p_row: record,
    p_expected_updated_at: expected ?? null,
    p_work_adjustments: rowAdjustmentsToRecords(row, "manual"),
    p_table_placement: rowPlacementToRecord(row),
    p_plant_corrections: rowPlantCorrectionsToRecords(row),
    p_hus_events: rowHusEventsToRecords(row),
    p_change_history: rowChangeHistoryToRecords(row),
  });
  if (error) {
    if (["PT409", "40001"].includes(error.code)) throw new SowingPlanConflictError();
    if (error.code === "P0002") throw new SowingPlanNotFoundError();
    if (error.code === "55000") throw new SowingPlanArchivedError();
    if (error.code === "PGRST202" || error.code === "42883") {
      throw new SupabasePersistenceError("Droša saglabāšana vēl nav sagatavota datubāzē. Nepieciešama save_sowing_plan_row migrācija; dati nav mainīti", error);
    }
    throw new SupabasePersistenceError("Neizdevās atomiski saglabāt HUS", error);
  }
  if (data !== row.id) throw new WriteOutcomeError("unknown", [row.id]);
  return readConfirmedWrite(row.id);
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
  return changeArchiveState(id, "archive", note);
}

async function restoreRowInSupabase(id: string): Promise<SowingPlanRow> {
  return changeArchiveState(id, "restore");
}

async function changeArchiveState(id: string, operation: "archive" | "restore", note?: string): Promise<SowingPlanRow> {
  const row = await loadRowById(id);
  if (operation === "archive" && row.archivedAt) throw new SowingPlanArchivedError();
  if (operation === "restore" && !row.archivedAt) return row;
  const activeRows = await loadRowsFromSupabase();
  if (!row.updatedAt || activeRows.some((candidate) => !candidate.updatedAt)) throw new SowingPlanConflictError();
  if (operation === "archive" && activeRows.find((candidate) => candidate.id === id)?.updatedAt !== row.updatedAt) {
    throw new SowingPlanConflictError();
  }
  const archivedAt = new Date().toISOString();
  const originalById = new Map(activeRows.map((candidate) => [candidate.id, candidate]));
  const frozen = freezeWorkAdjustmentsForStableActiveSchedule(activeRows, id, plannerConfig)
    .flatMap((candidate) => {
      const original = originalById.get(candidate.id);
      return original && candidate.id !== id ? optimizerAdjustmentRecordsAddedByFreeze(original, candidate) : [];
    });
  const { data, error } = await rpcWrite(createSupabaseServerClient(), "change_sowing_plan_archive", [id], {
    p_id: id, p_operation: operation, p_expected_updated_at: row.updatedAt,
    p_active_versions: activeRows.map((candidate) => ({ id: candidate.id, updated_at: candidate.updatedAt })),
    p_freeze: frozen,
    p_archived_at: operation === "archive" ? archivedAt : null,
    p_note: note?.trim() || null,
    p_snapshot: operation === "archive" ? buildArchiveSnapshot(row, activeRows, plannerConfig, archivedAt, note?.trim() || undefined) : null,
  });
  if (error) {
    if (["PT409", "40001", "23505", "40P01", "55P03"].includes(error.code)) throw new SowingPlanConflictError();
    if (error.code === "P0002") throw new SowingPlanNotFoundError();
    if (["PGRST202", "42883"].includes(error.code)) {
      throw new SupabasePersistenceError("Arhīva operācija nav sagatavota datubāzē; nepieciešama change_sowing_plan_archive migrācija", error);
    }
    throw new SupabasePersistenceError("Neizdevās atomiski mainīt arhīvu", error);
  }
  if (data !== id) throw new WriteOutcomeError("unknown", [id]);
  return readConfirmedWrite(id);
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

async function loadRowById(id: string): Promise<SowingPlanRow> {
  const client = createSupabaseServerClient();
  const { data, error } = await client
    .from("sowing_plan_rows")
    .select(SOWING_PLAN_SELECT)
    .eq("id", id)
    .single();

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

async function readConfirmedWrite(id: string): Promise<SowingPlanRow> {
  try { return await loadRowById(id); }
  catch { throw new WriteOutcomeError("committed", [id]); }
}

export async function importPlanBatch(batch: PlanImportBatch): Promise<string[]> {
  if (!batch.items.length || batch.items.length > 500) throw new Error("Imports drīkst saturēt 1–500 rindas.");
  const items = batch.items.map(({ operation, row }) => {
    const record = sowingPlanRowToRecord(row);
    if (!record) throw new Error("Demo rows cannot be imported.");
    if (operation === "update" && !row.updatedAt) throw new SowingPlanConflictError();
    return { operation, row: record, expected_updated_at: operation === "update" ? row.updatedAt : null,
      work: rowAdjustmentsToRecords(row, "manual"), placement: rowPlacementToRecord(row),
      losses: rowPlantCorrectionsToRecords(row), events: rowHusEventsToRecords(row), history: rowChangeHistoryToRecords(row) };
  });
  const ids = batch.items.map(item => item.row.id);
  let result;
  try { result = await createSupabaseServerClient().rpc("import_sowing_plan_rows", { p_id: batch.id, p_request: batch.items, p_items: items }); }
  catch { throw new WriteOutcomeError("unknown", ids); }
  if (result.error) {
    if (!result.error.code) throw new WriteOutcomeError("unknown", ids);
    // This retry may have timed out waiting for an earlier request's receipt.
    // Aborting the retry says nothing about the original transaction's outcome.
    if (["55P03", "40P01"].includes(result.error.code)) throw new WriteOutcomeError("unknown", ids);
    if (["PT409", "40001", "23505"].includes(result.error.code)) throw new SowingPlanConflictError();
    throw new SupabasePersistenceError(["PGRST202", "42883"].includes(result.error.code)
      ? "Imports nav saglabāts; nepieciešama import_sowing_plan_rows migrācija" : "Neizdevās atomiski saglabāt importu", result.error);
  }
  if (!Array.isArray(result.data) || result.data.length !== ids.length || ids.some(id => !result.data.includes(id))) {
    throw new WriteOutcomeError("unknown", ids);
  }
  return result.data as string[];
}

async function rpcWrite(client: ReturnType<typeof createSupabaseServerClient>, name: string, ids: string[], args: Record<string, unknown>) {
  let result;
  try { result = await client.rpc(name, args); }
  catch { throw new WriteOutcomeError("unknown", ids); }
  if (result.error && !result.error.code) throw new WriteOutcomeError("unknown", ids);
  return result;
}

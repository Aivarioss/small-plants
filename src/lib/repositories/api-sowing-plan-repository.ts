import { WriteOutcomeError } from "@/lib/write-outcome";
import type { PlanImportBatch } from "./types";
import type { SowingPlanRow } from "@/lib/types";
import type { SowingPlanRepository } from "./types";

export class SowingPlanApiConflictError extends Error {
  constructor(message = "Šis Hus ir mainīts citur. Pārlādē un pārbaudi jaunāko versiju pirms saglabāšanas.") {
    super(message);
    this.name = "SowingPlanApiConflictError";
  }
}

export const apiSowingPlanRepository: SowingPlanRepository = {
  create: createRow,
  delete: deleteRow,
  load: loadRows,
  update: updateRow,
};

export async function loadWorkspaceRows(): Promise<SowingPlanRow[]> {
  const response = await fetch("/api/sowing-plan/workspace", { cache: "no-store" });
  const result = await response.json().catch(() => null) as { rows?: SowingPlanRow[]; error?: string } | null;
  if (!response.ok || !Array.isArray(result?.rows)) throw new Error(result?.error ?? "Neizdevās ielādēt pilno plānu.");
  return result.rows;
}

export async function loadArchivedRows(): Promise<SowingPlanRow[]> {
  const response = await fetch("/api/hus-archive", {
    cache: "no-store",
  });
  const result = (await response.json().catch(() => null)) as { rows?: SowingPlanRow[]; error?: string } | null;

  if (!response.ok || !result?.rows) {
    throw new Error(result?.error ?? "Neizdevās ielādēt HUS arhīvu.");
  }

  return result.rows;
}

export async function archiveRow(id: string, note?: string): Promise<SowingPlanRow> {
  const result = await writeRequest("/api/hus-archive", "POST", { id, note }, [id]);

  if (!result.row) {
    throw new Error("Serveris neatgrieza arhivēto Hus rindu.");
  }

  return result.row;
}

export async function restoreArchivedRow(id: string): Promise<SowingPlanRow> {
  const result = await writeRequest("/api/hus-archive", "PATCH", { id }, [id]);

  if (!result.row) {
    throw new Error("Serveris neatgrieza atjaunoto Hus rindu.");
  }

  return result.row;
}

async function loadRows(): Promise<SowingPlanRow[]> {
  const response = await fetch("/api/sowing-plan", {
    cache: "no-store",
  });
  const result = (await response.json().catch(() => null)) as { rows?: SowingPlanRow[]; error?: string } | null;

  if (!response.ok || !result?.rows) {
    throw new Error(result?.error ?? "Neizdevās ielādēt Supabase plānu.");
  }

  return result.rows;
}

async function createRow(row: SowingPlanRow): Promise<SowingPlanRow> {
  return writeRow("POST", { row });
}

async function updateRow(row: SowingPlanRow): Promise<SowingPlanRow> {
  return writeRow("PATCH", { expectedUpdatedAt: row.updatedAt, row });
}

async function deleteRow(row: SowingPlanRow): Promise<void> {
  const result = await writeRequest("/api/sowing-plan", "DELETE", { expectedUpdatedAt: row.updatedAt, id: row.id }, [row.id]);
  if (result.ok !== true) throw new WriteOutcomeError("unknown", [row.id]);
}

async function writeRow(method: "POST" | "PATCH", body: { row: SowingPlanRow; expectedUpdatedAt?: string }): Promise<SowingPlanRow> {
  const result = await writeRequest("/api/sowing-plan", method, body, [body.row.id]);
  if (!result.row) throw new WriteOutcomeError("unknown", [body.row.id]);
  return result.row;
}

export async function submitPlanImport(batch: PlanImportBatch): Promise<string[]> {
  const expected = batch.items.map(item => item.row.id);
  const result = await writeRequest("/api/sowing-plan/batch", "POST", batch, expected, true);
  if (!result.ids || result.ids.length !== expected.length || expected.some(id => !result.ids!.includes(id))) {
    throw new WriteOutcomeError("unknown", expected);
  }
  return result.ids;
}

async function writeRequest(url: string, method: string, body: unknown, ids: string[], receiptOnly = false): Promise<{ row?: SowingPlanRow; ids?: string[]; ok?: boolean }> {
  let response: Response;
  try { response = await fetch(url, { body: JSON.stringify(body), headers: { "Content-Type": "application/json" }, method }); }
  catch { throw new WriteOutcomeError("unknown", ids); }
  const result = await response.json().catch(() => null) as { row?: SowingPlanRow; ids?: string[]; ok?: boolean; error?: string; writeStatus?: string } | null;
  if (result?.writeStatus === "unknown" || (result?.writeStatus === "committed" && !receiptOnly)) {
    throw new WriteOutcomeError(result.writeStatus === "committed" ? "committed" : "unknown", ids);
  }
  if (response.status === 409) throw new SowingPlanApiConflictError(result?.error);
  if (!result) throw new WriteOutcomeError("unknown", ids);
  if (!response.ok) {
    if (response.status >= 500 && result.writeStatus !== "failed") throw new WriteOutcomeError("unknown", ids);
    throw new Error(result.error ?? "Neizdevās saglabāt Supabase plānu.");
  }
  if (receiptOnly && result.writeStatus !== "committed") throw new WriteOutcomeError("unknown", ids);
  return result;
}

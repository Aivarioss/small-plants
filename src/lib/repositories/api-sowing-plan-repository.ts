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
  const response = await fetch("/api/hus-archive", {
    body: JSON.stringify({ id, note }),
    headers: {
      "Content-Type": "application/json",
    },
    method: "POST",
  });
  const result = await parseWriteResponse(response);

  if (!result.row) {
    throw new Error("Serveris neatgrieza arhivēto Hus rindu.");
  }

  return result.row;
}

export async function restoreArchivedRow(id: string): Promise<SowingPlanRow> {
  const response = await fetch("/api/hus-archive", {
    body: JSON.stringify({ id }),
    headers: {
      "Content-Type": "application/json",
    },
    method: "PATCH",
  });
  const result = await parseWriteResponse(response);

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
  const response = await fetch("/api/sowing-plan", {
    body: JSON.stringify({ expectedUpdatedAt: row.updatedAt, id: row.id }),
    headers: {
      "Content-Type": "application/json",
    },
    method: "DELETE",
  });
  await parseWriteResponse(response);
}

async function writeRow(method: "POST" | "PATCH", body: unknown): Promise<SowingPlanRow> {
  const response = await fetch("/api/sowing-plan", {
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
    },
    method,
  });
  const result = await parseWriteResponse(response);

  if (!result.row) {
    throw new Error("Serveris neatgrieza saglabāto Hus rindu.");
  }

  return result.row;
}

async function parseWriteResponse(response: Response): Promise<{ row?: SowingPlanRow; error?: string }> {
  const result = (await response.json().catch(() => null)) as { row?: SowingPlanRow; error?: string } | null;

  if (response.status === 409) {
    throw new SowingPlanApiConflictError(result?.error);
  }

  if (!response.ok) {
    throw new Error(result?.error ?? "Neizdevās saglabāt Supabase plānu.");
  }

  return result ?? {};
}

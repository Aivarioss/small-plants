import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { hasValidSession } from "@/lib/auth/session";
import {
  importIdentityFromValues,
  importPreviewForRow,
  type ImportPreviewRow,
  type SupabaseImportMode,
  type ValidatedImportRow,
  validateImportRow,
} from "@/lib/migration/sowing-plan-import";
import type { SowingPlanRowRecord } from "@/lib/supabase/database";
import { createSupabaseServerClient, isSupabaseServerConfigured } from "@/lib/supabase/server";

export const runtime = "nodejs";

type ImportRequestBody = {
  mode?: SupabaseImportMode;
  rows?: unknown[];
};

type ExistingIdentityRecord = {
  hus: string;
  sowing_date: string;
  move_out_date: string;
};

export async function POST(request: NextRequest) {
  if (!(await hasValidSession(request))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!isSupabaseServerConfigured()) {
    return NextResponse.json({ error: "Supabase is not configured." }, { status: 503 });
  }

  const body = (await request.json().catch(() => null)) as ImportRequestBody | null;
  const mode = body?.mode === "import" ? "import" : "preview";
  const rows = Array.isArray(body?.rows) ? body.rows : [];

  if (rows.length === 0) {
    return NextResponse.json({ error: "No rows were provided." }, { status: 400 });
  }

  if (rows.length > 500) {
    return NextResponse.json({ error: "Too many rows for one import." }, { status: 400 });
  }

  const validation = rows.map(validateImportRow);
  const validRows = validation.filter((result): result is { ok: true; row: ValidatedImportRow } => result.ok).map((result) => result.row);
  const excludedRows = validation.filter((result): result is { ok: false; preview: ImportPreviewRow } => !result.ok).map((result) => result.preview);
  const existingIdentities = await loadExistingIdentities();

  const previewRows = [
    ...validRows.map((row) =>
      existingIdentities.has(row.identityKey)
        ? importPreviewForRow(row, "skipDuplicate", "Šāds Hus cikls jau ir Supabase.")
        : importPreviewForRow(row, "create"),
    ),
    ...excludedRows,
  ];
  const rowsToCreate = validRows.filter((row) => !existingIdentities.has(row.identityKey));

  if (mode === "import" && rowsToCreate.length > 0) {
    await insertRows(rowsToCreate);
  }

  return NextResponse.json({
    mode,
    rows: previewRows,
    createdCount: mode === "import" ? rowsToCreate.length : 0,
    duplicateCount: previewRows.filter((row) => row.action === "skipDuplicate").length,
    excludedCount: previewRows.filter((row) => row.action === "exclude").length,
    importableCount: previewRows.filter((row) => row.action === "create").length,
  });
}

async function loadExistingIdentities(): Promise<Set<string>> {
  const client = createSupabaseServerClient();
  const { data, error } = await client.from("sowing_plan_rows").select("hus, sowing_date, move_out_date");

  if (error) {
    throw error;
  }

  return new Set(
    ((data ?? []) as ExistingIdentityRecord[]).map((row) =>
      importIdentityFromValues(row.hus, row.sowing_date, row.move_out_date),
    ),
  );
}

async function insertRows(rows: ValidatedImportRow[]): Promise<void> {
  const client = createSupabaseServerClient();
  const records = rows.map(importRowToRecord);

  const { error } = await client.from("sowing_plan_rows").upsert(records, {
    ignoreDuplicates: true,
    onConflict: "id",
  });

  if (error) {
    throw error;
  }
}

function importRowToRecord(row: ValidatedImportRow): SowingPlanRowRecord {
  return {
    id: stableUuidFromIdentity(row.identityKey),
    hus: row.hus,
    required_plants: row.requiredPlants,
    extra_plants: row.extraPlants,
    variety: row.variety,
    week_number: row.weekNumber,
    sowing_date: row.sowingDate,
    move_out_date: row.moveOutDate,
    previcure_date: row.previcureDate,
    cycle_length: row.cycleLength,
    sector_type: row.sectorType,
    correction: row.correction,
    status: row.status,
    source: row.source,
  };
}

function stableUuidFromIdentity(identityKey: string): string {
  const hex = createHash("sha256").update(`small-plants:sowing-plan:${identityKey}`).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variantNibble(hex[16])}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function variantNibble(value: string): string {
  return ((Number.parseInt(value, 16) & 0x3) | 0x8).toString(16);
}

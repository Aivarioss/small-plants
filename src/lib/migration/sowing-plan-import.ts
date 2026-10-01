import { demoPlanRows } from "../demo-data";
import { deriveCycleLength } from "../hus-templates";
import type { SectorType, SowingPlanRow } from "../types";

export const PLAN_STORAGE_KEY = "cucumber-planner:sowing-plan:v2";

export type SupabaseImportMode = "preview" | "import";

export type ValidatedImportRow = {
  clientId: string;
  hus: string;
  requiredPlants: number;
  extraPlants: number;
  variety: string;
  weekNumber: number | null;
  sowingDate: string;
  moveOutDate: string;
  previcureDate: string | null;
  cycleLength: number;
  sectorType: SectorType;
  correction: number;
  status: "planned" | "imported" | "active" | "done";
  source: "user" | "import";
  identityKey: string;
  plantCount: number;
};

export type ImportPreviewRow = {
  clientId: string;
  identityKey: string;
  hus: string;
  variety: string;
  plantCount: number;
  sowingDate: string;
  moveOutDate: string;
  action: "create" | "skipDuplicate" | "exclude";
  reason?: string;
};

export type ImportValidationResult =
  | { ok: true; row: ValidatedImportRow }
  | { ok: false; preview: ImportPreviewRow };

const demoIdentityKeys = new Set(demoPlanRows.map((row) => importIdentityFromValues(row.sectorName, row.sowingDate, row.harvestDate)));
const demoIds = new Set(demoPlanRows.map((row) => row.id));
const testPattern = /\b(demo|mock|test|tests|testa|paraugs)\b/i;

export function validateImportRow(candidate: unknown): ImportValidationResult {
  if (!isRecord(candidate)) {
    return invalidPreview("unknown", "Nederīga rinda.");
  }

  const clientId = stringValue(candidate.id) || cryptoSafeFallbackId(candidate);
  const hus = stringValue(candidate.sectorName).trim();
  const variety = stringValue(candidate.variety).trim() || "Nav norādīta";
  const sowingDate = stringValue(candidate.sowingDate);
  const moveOutDate = stringValue(candidate.harvestDate);
  const requiredPlants = numberValue(candidate.requiredPlants);
  const extraPlants = numberValue(candidate.extraPlants ?? 0);
  const sectorType = numberValue(candidate.sectorType) as SectorType;

  const basicPreview = {
    clientId,
    identityKey: hus && sowingDate && moveOutDate ? importIdentityFromValues(hus, sowingDate, moveOutDate) : clientId,
    hus: hus || "Nav norādīts",
    variety,
    plantCount: Math.max(0, requiredPlants + extraPlants),
    sowingDate,
    moveOutDate,
    action: "exclude" as const,
  };

  if (!hus) {
    return { ok: false, preview: { ...basicPreview, reason: "Nav Hus nosaukuma." } };
  }

  if (!isIsoDate(sowingDate) || !isIsoDate(moveOutDate)) {
    return { ok: false, preview: { ...basicPreview, reason: "Datumiem jābūt ISO formātā." } };
  }

  if (moveOutDate < sowingDate) {
    return { ok: false, preview: { ...basicPreview, reason: "Izvākšanas datums ir pirms sēšanas datuma." } };
  }

  if (requiredPlants <= 0 || requiredPlants + extraPlants <= 0) {
    return { ok: false, preview: { ...basicPreview, reason: "Stādu skaitam jābūt pozitīvam." } };
  }

  if (![26, 39].includes(sectorType)) {
    return { ok: false, preview: { ...basicPreview, reason: "Sektora tipam jābūt 26 vai 39 galdi." } };
  }

  const rowLike = candidate as Partial<SowingPlanRow>;
  const exclusionReason = getImportExclusionReason({
    id: clientId,
    sectorName: hus,
    variety,
    source: rowLike.source,
    sowingDate,
    harvestDate: moveOutDate,
  });

  if (exclusionReason) {
    return { ok: false, preview: { ...basicPreview, reason: exclusionReason } };
  }

  const cycleLength = numberValue(candidate.cycleLength) || deriveCycleLength(sowingDate, moveOutDate);
  const status = stringValue(candidate.status);

  return {
    ok: true,
    row: {
      clientId,
      hus,
      requiredPlants,
      extraPlants,
      variety,
      weekNumber: numberValue(candidate.weekNumber) || null,
      sowingDate,
      moveOutDate,
      previcureDate: isIsoDate(stringValue(candidate.previcureDate)) ? stringValue(candidate.previcureDate) : null,
      cycleLength: cycleLength > 0 ? cycleLength : deriveCycleLength(sowingDate, moveOutDate),
      sectorType,
      correction: numberValue(candidate.correction),
      status: isStatus(status) ? status : "planned",
      source: rowLike.source === "import" ? "import" : "user",
      identityKey: importIdentityFromValues(hus, sowingDate, moveOutDate),
      plantCount: requiredPlants + extraPlants,
    },
  };
}

export function importPreviewForRow(
  row: ValidatedImportRow,
  action: ImportPreviewRow["action"],
  reason?: string,
): ImportPreviewRow {
  return {
    clientId: row.clientId,
    identityKey: row.identityKey,
    hus: row.hus,
    variety: row.variety,
    plantCount: row.plantCount,
    sowingDate: row.sowingDate,
    moveOutDate: row.moveOutDate,
    action,
    reason,
  };
}

export function importIdentityFromValues(hus: string, sowingDate: string, moveOutDate: string): string {
  return `${normalizeIdentityPart(hus)}|${sowingDate}|${moveOutDate}`;
}

export function importIdentityFromRow(row: Pick<ValidatedImportRow, "hus" | "sowingDate" | "moveOutDate">): string {
  return importIdentityFromValues(row.hus, row.sowingDate, row.moveOutDate);
}

export function countImportableRows(previewRows: ImportPreviewRow[]): number {
  return previewRows.filter((row) => row.action === "create").length;
}

function getImportExclusionReason(
  row: Pick<SowingPlanRow, "id" | "sectorName" | "variety" | "source" | "sowingDate" | "harvestDate">,
): string | null {
  const identityKey = importIdentityFromValues(row.sectorName, row.sowingDate, row.harvestDate);

  if (row.source === "demo" || demoIds.has(row.id) || demoIdentityKeys.has(identityKey)) {
    return "Demo rinda netiek importēta.";
  }

  if (testPattern.test(row.sectorName) || testPattern.test(row.variety)) {
    return "Testa/demo nosaukums netiek importēts.";
  }

  return null;
}

function invalidPreview(clientId: string, reason: string): ImportValidationResult {
  return {
    ok: false,
    preview: {
      clientId,
      identityKey: clientId,
      hus: "Nederīga rinda",
      variety: "",
      plantCount: 0,
      sowingDate: "",
      moveOutDate: "",
      action: "exclude",
      reason,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T12:00:00`).getTime());
}

function isStatus(value: string): value is ValidatedImportRow["status"] {
  return ["planned", "imported", "active", "done"].includes(value);
}

function normalizeIdentityPart(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function cryptoSafeFallbackId(candidate: Record<string, unknown>): string {
  return importIdentityFromValues(stringValue(candidate.sectorName) || "unknown", stringValue(candidate.sowingDate), stringValue(candidate.harvestDate));
}

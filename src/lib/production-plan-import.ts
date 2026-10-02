import { deriveCycleLength, findHusTemplate, sectorTypeForOperationalTotal } from "./hus-templates";
import type { PlanImportCandidate, PlanImportResult } from "./types";

export const DEFAULT_IMPORT_WORKER_EXTRA = 100;

export type ExtractedProductionPlanRow = {
  id?: string;
  hus?: string;
  agronomistRequiredPlants?: number | string | null;
  variety?: string | null;
  weekNumber?: number | string | null;
  moveOutDate?: string | null;
  sowingDate?: string | null;
  sowingCount?: number | string | null;
  confidence?: Partial<Record<"hus" | "agronomistRequiredPlants" | "variety" | "weekNumber" | "moveOutDate" | "sowingDate" | "sowingCount", number>>;
};

export type ExtractedProductionPlan = {
  provider: string;
  fileName: string;
  extractedAt: string;
  rows: ExtractedProductionPlanRow[];
};

export function buildProductionPlanImportResult(extracted: ExtractedProductionPlan): PlanImportResult {
  return {
    mode: "vision",
    fileName: extracted.fileName,
    importedAt: extracted.extractedAt,
    provider: extracted.provider,
    providerConfigured: true,
    candidates: extracted.rows.map((row, index) => extractedRowToCandidate(row, index)),
  };
}

export function unconfiguredProductionPlanImportResult(fileName: string, provider = "not-configured"): PlanImportResult {
  return {
    mode: "unconfigured",
    fileName,
    importedAt: new Date().toISOString(),
    provider,
    providerConfigured: false,
    message: "Foto atpazīšanas providers vēl nav konfigurēts. Augšupielāde strādā, bet automātiska nolasīšana vēl nav ieslēgta.",
    candidates: [],
  };
}

export function extractedRowToCandidate(row: ExtractedProductionPlanRow, index = 0): PlanImportCandidate {
  const hus = String(row.hus ?? "").trim();
  const template = findHusTemplate(hus);
  const agronomistRequiredPlants = numberOrNull(row.agronomistRequiredPlants);
  const sowingCount = numberOrNull(row.sowingCount);
  const extraPlants = DEFAULT_IMPORT_WORKER_EXTRA;
  const operationalTotal = Math.max(0, (sowingCount ?? 0) + extraPlants);
  const sowingDate = normalizePlanDate(row.sowingDate);
  const harvestDate = normalizePlanDate(row.moveOutDate);
  const cycleLength = sowingDate && harvestDate ? deriveCycleLength(sowingDate, harvestDate) : null;
  const weekNumber = numberOrNull(row.weekNumber);
  const warnings = candidateWarnings({
    cycleLength,
    harvestDate,
    hus,
    sowingCount,
    sowingDate,
    templateSowingCount: template?.agronomistSowCount,
  });

  return {
    id: row.id ?? `extracted-${index + 1}`,
    selected: warnings.length === 0,
    warnings,
    fields: {
      sectorName: field(hus, confidence(row, "hus"), !hus || !template),
      agronomistRequiredPlants: field(agronomistRequiredPlants, confidence(row, "agronomistRequiredPlants"), false),
      requiredPlants: field(sowingCount ?? 0, confidence(row, "sowingCount"), !sowingCount),
      extraPlants: field(extraPlants, 1, false),
      variety: field(String(row.variety ?? template?.variety ?? "").trim(), confidence(row, "variety"), !row.variety),
      weekNumber: field(weekNumber, confidence(row, "weekNumber"), false),
      sowingDate: field(sowingDate ?? "", confidence(row, "sowingDate"), !sowingDate),
      harvestDate: field(harvestDate ?? "", confidence(row, "moveOutDate"), !harvestDate),
    },
    cycleLength,
    operationalTotal,
    duplicateAction: "createNew",
  };
}

export function normalizePlanDate(value: unknown, fallbackYear = 2026): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return isValidIsoDate(trimmed) ? trimmed : null;
  }

  const match = trimmed.match(/^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{2,4}))?$/);
  if (!match) {
    return null;
  }

  const day = Number(match[1]);
  const month = Number(match[2]);
  const rawYear = match[3] ? Number(match[3]) : fallbackYear;
  const year = rawYear < 100 ? 2000 + rawYear : rawYear;
  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  return isValidIsoDate(iso) ? iso : null;
}

export function importCandidateSectorType(candidate: PlanImportCandidate) {
  return sectorTypeForOperationalTotal(candidate.operationalTotal);
}

function candidateWarnings(input: {
  cycleLength: number | null;
  harvestDate: string | null;
  hus: string;
  sowingCount: number | null;
  sowingDate: string | null;
  templateSowingCount?: number;
}): string[] {
  const warnings: string[] = [];

  if (!input.hus) {
    warnings.push("Nav nolasīts Hus.");
  } else if (!findHusTemplate(input.hus)) {
    warnings.push("Nezināms Hus.");
  }

  if (!input.sowingDate) {
    warnings.push("Trūkst vai nederīgs sēšanas datums.");
  }

  if (!input.harvestDate) {
    warnings.push("Trūkst vai nederīgs izvākšanas datums.");
  }

  if (!input.sowingCount || input.sowingCount <= 0) {
    warnings.push("Trūkst agronoma sējamais skaits.");
  }

  if (input.cycleLength !== null && (input.cycleLength < 18 || input.cycleLength > 28)) {
    warnings.push(`Neparasts cikla garums: ${input.cycleLength} dienas.`);
  }

  if (input.templateSowingCount && input.sowingCount && input.templateSowingCount !== input.sowingCount) {
    warnings.push(`Sējamais skaits atšķiras no Hus šablona (${input.templateSowingCount}).`);
  }

  return warnings;
}

function field<T>(value: T, confidence: number, forceReview: boolean) {
  return {
    value,
    confidence,
    needsReview: forceReview || confidence < 0.86,
  };
}

function confidence(row: ExtractedProductionPlanRow, key: NonNullable<ExtractedProductionPlanRow["confidence"]> extends infer T ? keyof T : never): number {
  return row.confidence?.[key as keyof NonNullable<ExtractedProductionPlanRow["confidence"]>] ?? 0.9;
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const number = Number(String(value).replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(number) ? number : null;
}

function isValidIsoDate(value: string): boolean {
  const date = new Date(`${value}T12:00:00`);
  return !Number.isNaN(date.getTime()) && value === `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

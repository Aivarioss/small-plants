import { addDays, toIsoDate } from "./planning";
import { calculateMoveOutDate, deriveCycleLength } from "./hus-templates";
import type { PlanImportCandidate, PlanImportResult } from "./types";

export type PlanImportService = {
  analyzeImage(file: File): Promise<PlanImportResult>;
};

function field<T>(value: T, confidence: number) {
  return {
    value,
    confidence,
    needsReview: confidence < 0.86,
  };
}

function candidate(
  id: string,
  seed: {
    sectorName: string;
    requiredPlants: number;
    variety: string;
    weekNumber: number;
    sowingDate: string;
    cycleLength?: number;
    confidence?: Partial<Record<keyof PlanImportCandidate["fields"], number>>;
  },
): PlanImportCandidate {
  const harvestDate = calculateMoveOutDate(seed.sowingDate, seed.cycleLength ?? 22);
  const confidence = seed.confidence ?? {};
  const extraPlants = 100;

  return {
    id,
    selected: true,
    warnings: [],
    fields: {
      sectorName: field(seed.sectorName, confidence.sectorName ?? 0.92),
      greenhouseRequiredPlants: field(null, 1),
      requiredPlants: field(seed.requiredPlants, confidence.requiredPlants ?? 0.9),
      extraPlants: field(extraPlants, 1),
      variety: field(seed.variety, confidence.variety ?? 0.88),
      weekNumber: field(seed.weekNumber, confidence.weekNumber ?? 0.82),
      sowingDate: field(seed.sowingDate, confidence.sowingDate ?? 0.93),
      harvestDate: field(harvestDate, confidence.harvestDate ?? 0.9),
    },
    cycleLength: deriveCycleLength(seed.sowingDate, harvestDate),
    operationalTotal: seed.requiredPlants + extraPlants,
    duplicateAction: "createNew",
  };
}

export const mockPlanImportService: PlanImportService = {
  async analyzeImage(file) {
    await new Promise((resolve) => setTimeout(resolve, 350));

    const today = toIsoDate(new Date());
    return {
      mode: "mock",
      fileName: file.name,
      importedAt: new Date().toISOString(),
      provider: "client-mock",
      providerConfigured: true,
      candidates: [
        candidate("mock-hus-4", {
          sectorName: "Hus 4",
          requiredPlants: 3542,
          variety: "Baltazasara",
          weekNumber: getIsoWeek(today),
          sowingDate: today,
          cycleLength: 22,
          confidence: {
            requiredPlants: 0.78,
          },
        }),
        candidate("mock-hus-5", {
          sectorName: "Hus 5",
          requiredPlants: 4200,
          variety: "Proloog",
          weekNumber: getIsoWeek(addDays(today, 2)),
          sowingDate: addDays(today, 2),
          cycleLength: 21,
        }),
        candidate("mock-hus-7", {
          sectorName: "Hus 7",
          requiredPlants: 5000,
          variety: "Media",
          weekNumber: getIsoWeek(addDays(today, 7)),
          sowingDate: addDays(today, 7),
          cycleLength: 23,
          confidence: {
            sectorName: 0.8,
            harvestDate: 0.83,
          },
        }),
      ],
    };
  },
};

export function candidateCycleLength(candidate: PlanImportCandidate): number {
  return deriveCycleLength(candidate.fields.sowingDate.value, candidate.fields.harvestDate.value);
}

function getIsoWeek(date: string): number {
  const value = new Date(`${date}T12:00:00`);
  const day = value.getDay() || 7;
  value.setDate(value.getDate() + 4 - day);
  const yearStart = new Date(value.getFullYear(), 0, 1, 12);
  return Math.ceil(((value.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

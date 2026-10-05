import { demoPlanRows, plannerConfig } from "./demo-data";
import { getTotalSow } from "./planning";
import { calculateMoveOutDate, deriveCycleLength } from "./hus-templates";
import type { SectorType, SowingPlanRow } from "./types";

const PLAN_STORAGE_KEY = "cucumber-planner:sowing-plan:v2";
const LEGACY_BATCH_STORAGE_KEY = "cucumber-planner:batches:v1";

type StoredPlan = {
  version: 2;
  rows: SowingPlanRow[];
};

type LegacyBatch = {
  id: string;
  name: string;
  sowingDate: string;
  plantCount: number;
  cycleLength: number;
  sectorType: SectorType;
  plantsPerBox?: number;
  adjustments?: SowingPlanRow["adjustments"];
  source?: "demo" | "user";
};

type LegacyStoredBatches = {
  batches?: LegacyBatch[];
};

export function loadPlanRowsFromStorage(): SowingPlanRow[] {
  const storage = getStorage();
  if (!storage) {
    return demoPlanRows;
  }

  const raw = storage.getItem(PLAN_STORAGE_KEY);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as StoredPlan;
      if (Array.isArray(parsed.rows)) {
        return parsed.rows.map(normalizePlanRow).filter(Boolean) as SowingPlanRow[];
      }
    } catch {
      return demoPlanRows;
    }
  }

  const migrated = migrateLegacyBatches(storage.getItem(LEGACY_BATCH_STORAGE_KEY));
  return migrated.length > 0 ? migrated : demoPlanRows;
}

export function savePlanRowsToStorage(rows: SowingPlanRow[]): void {
  const storage = getStorage();
  if (!storage) {
    return;
  }

  const payload: StoredPlan = {
    version: 2,
    rows,
  };
  storage.setItem(PLAN_STORAGE_KEY, JSON.stringify(payload));
}

function migrateLegacyBatches(raw: string | null): SowingPlanRow[] {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as LegacyStoredBatches;
    if (!Array.isArray(parsed.batches)) {
      return [];
    }

    return parsed.batches
      .map((batch): SowingPlanRow | null => {
        const cycleLength = Number(batch.cycleLength);
        const sowingDate = batch.sowingDate;
        const harvestDate = calculateMoveOutDate(sowingDate, cycleLength);
        const row = normalizePlanRow({
          id: batch.id,
          sectorName: batch.name,
          requiredPlants: Number(batch.plantCount),
          extraPlants: 0,
          variety: "Nav norādīta",
          sowingDate,
          harvestDate,
          cycleLength,
          sectorType: Number(batch.sectorType) as SectorType,
          plantsPerBox: Number(batch.plantsPerBox) || plannerConfig.defaultPlantsPerBox,
          correction: 0,
          status: "planned",
          adjustments: batch.adjustments,
          source: batch.source,
        });

        return row ? { ...row, source: batch.source === "demo" ? "demo" : "user" } : null;
      })
      .filter(Boolean) as SowingPlanRow[];
  } catch {
    return [];
  }
}

function normalizePlanRow(candidate: Partial<SowingPlanRow>): SowingPlanRow | null {
  const requiredPlants = Number(candidate.requiredPlants);
  const extraPlants = Number(candidate.extraPlants ?? 0);
  const cycleLength = Number(candidate.cycleLength);
  const sectorType = Number(candidate.sectorType) as SectorType;
  const plantsPerBox = Number(candidate.plantsPerBox ?? plannerConfig.defaultPlantsPerBox);
  const correction = Number(candidate.correction ?? 0);

  if (
    !candidate.id ||
    !candidate.sectorName ||
    !candidate.sowingDate ||
    !candidate.harvestDate ||
    ![26, 39].includes(sectorType) ||
    requiredPlants <= 0 ||
    getTotalSow({ requiredPlants, extraPlants }) <= 0 ||
    plantsPerBox <= 0
  ) {
    return null;
  }

  return {
    id: candidate.id,
    sectorName: candidate.sectorName,
    requiredPlants,
    extraPlants,
    variety: candidate.variety || "Nav norādīta",
    weekNumber: Number(candidate.weekNumber) || undefined,
    sowingTables: candidate.sowingTables,
    sowingDate: candidate.sowingDate,
    harvestDate: candidate.harvestDate,
    previcureDate: candidate.previcureDate,
    cycleLength: cycleLength > 0 ? cycleLength : deriveCycleLength(candidate.sowingDate, candidate.harvestDate),
    sectorType,
    plantsPerBox,
    correction,
    status: candidate.status ?? (candidate.source === "import" ? "imported" : "planned"),
    changeHistory: Array.isArray(candidate.changeHistory) ? candidate.changeHistory : [],
    plantCorrections: Array.isArray(candidate.plantCorrections) ? candidate.plantCorrections : [],
    placement: candidate.placement,
    adjustments: candidate.adjustments,
    source: candidate.source === "demo" ? "demo" : candidate.source === "import" ? "import" : "user",
  };
}

function getStorage(): Storage | null {
  if (typeof window === "undefined" || !("localStorage" in window)) {
    return null;
  }

  try {
    const storage = window.localStorage;
    const testKey = "cucumber-planner:storage-test";
    storage.setItem(testKey, "1");
    storage.removeItem(testKey);
    return storage;
  } catch {
    return null;
  }
}

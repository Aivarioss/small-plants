import type { SectorType, SowingPlanDraft } from "./types";
import { addDays, daysBetween } from "./planning";

export type HusTemplate = {
  hus: string;
  agronomistSowCount: number;
  variety: string;
};

export const DEFAULT_WORKER_EXTRA = 100;

export const standardHusTemplates: HusTemplate[] = [
  { hus: "Hus 3", agronomistSowCount: 3744, variety: "Baltazsara" },
  { hus: "Hus 2N", agronomistSowCount: 3588, variety: "Baltazsara" },
  { hus: "Hus 2S", agronomistSowCount: 3551, variety: "Baltazsara" },
  { hus: "Hus 1", agronomistSowCount: 4947, variety: "Baltazsara" },
  { hus: "Hus 10A", agronomistSowCount: 4195, variety: "Baltazsara" },
  { hus: "Hus 10B", agronomistSowCount: 3584, variety: "Baltazsara" },
  { hus: "Hus 11", agronomistSowCount: 3603, variety: "Baltazsara" },
  { hus: "Hus 4", agronomistSowCount: 3819, variety: "Baltazsara" },
  { hus: "Hus 5", agronomistSowCount: 3556, variety: "Baltazsara" },
  { hus: "Hus 6", agronomistSowCount: 3556, variety: "Baltazsara" },
  { hus: "Hus 7", agronomistSowCount: 6057, variety: "Baltazsara" },
  { hus: "Hus 9", agronomistSowCount: 3707, variety: "Baltazsara" },
  { hus: "Hus 8A", agronomistSowCount: 3457, variety: "Baltazsara" },
  { hus: "Hus 8B", agronomistSowCount: 4155, variety: "Baltazsara" },
];

export function findHusTemplate(hus: string): HusTemplate | undefined {
  const normalized = normalizeHus(hus);
  return standardHusTemplates.find((template) => normalizeHus(template.hus) === normalized);
}

export function applyHusTemplateToDraft(draft: SowingPlanDraft, hus: string): SowingPlanDraft {
  const template = findHusTemplate(hus);

  if (!template) {
    return {
      ...draft,
      sectorName: hus,
    };
  }

  return {
    ...draft,
    sectorName: template.hus,
    requiredPlants: String(template.agronomistSowCount),
    extraPlants: String(DEFAULT_WORKER_EXTRA),
    variety: template.variety,
    sectorType: sectorTypeForOperationalTotal(template.agronomistSowCount + DEFAULT_WORKER_EXTRA),
  };
}

export function updateDraftSowingDate(draft: SowingPlanDraft, sowingDate: string): SowingPlanDraft {
  if (draft.cycleMode === "moveOut") {
    return {
      ...draft,
      sowingDate,
      cycleLength: String(deriveCycleLength(sowingDate, draft.harvestDate)),
    };
  }

  return {
    ...draft,
    sowingDate,
    harvestDate: calculateMoveOutDate(sowingDate, Number(draft.cycleLength) || 22),
  };
}

export function updateDraftCycleLength(draft: SowingPlanDraft, cycleLength: number): SowingPlanDraft {
  return {
    ...draft,
    cycleMode: "length",
    cycleLength: String(cycleLength),
    harvestDate: calculateMoveOutDate(draft.sowingDate, cycleLength),
  };
}

export function updateDraftMoveOutDate(draft: SowingPlanDraft, harvestDate: string): SowingPlanDraft {
  return {
    ...draft,
    cycleMode: "moveOut",
    harvestDate,
    cycleLength: String(deriveCycleLength(draft.sowingDate, harvestDate)),
  };
}

// Business cycle length follows the agronomist plan: it is the calendar-day
// difference between sowing and move-out. Biological work-day numbering remains
// date-based in the scheduler, where sowing can still be displayed as day 1.
export function calculateMoveOutDate(sowingDate: string, cycleLength: number): string {
  return addDays(sowingDate, Math.max(1, cycleLength));
}

export function deriveCycleLength(sowingDate: string, moveOutDate: string): number {
  return Math.max(1, daysBetween(sowingDate, moveOutDate) - 1);
}

export function operationalTotal(agronomistSowCount: number, workerExtra: number): number {
  return Math.max(0, agronomistSowCount + workerExtra);
}

export function sectorTypeForOperationalTotal(total: number): SectorType {
  return total > 26 * 6 * 28 ? 39 : 26;
}

function normalizeHus(hus: string): string {
  const trimmed = hus.trim();
  return trimmed.toLocaleLowerCase("lv-LV").startsWith("hus ")
    ? trimmed.toLocaleLowerCase("lv-LV")
    : `hus ${trimmed.toLocaleLowerCase("lv-LV")}`;
}

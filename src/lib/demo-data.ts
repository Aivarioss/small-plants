import { deriveCycleLength } from "./hus-templates";
import type { PlannerConfig, SowingPlanRow } from "./types";

export const plannerConfig: PlannerConfig = {
  defaultPlantsPerBox: 30,
};

export const demoPlanRows: SowingPlanRow[] = [
  planRow({
    id: "plan-hus-3",
    sectorName: "Hus 3",
    requiredPlants: 3400,
    extraPlants: 144,
    variety: "Proloog",
    sowingDate: "2026-09-02",
    harvestDate: "2026-09-23",
    sectorType: 26,
    source: "demo",
  }),
  planRow({
    id: "plan-hus-2n",
    sectorName: "Hus 2N",
    requiredPlants: 5300,
    extraPlants: 500,
    variety: "Media",
    sowingDate: "2026-09-07",
    harvestDate: "2026-09-29",
    sectorType: 39,
    source: "demo",
    adjustments: {
      sideShoots: "2026-09-25",
    },
  }),
  planRow({
    id: "plan-hus-7",
    sectorName: "Hus 7",
    requiredPlants: 2800,
    extraPlants: 160,
    variety: "Deltastar",
    sowingDate: "2026-09-14",
    harvestDate: "2026-10-04",
    sectorType: 26,
    source: "demo",
  }),
];

function planRow(row: Omit<SowingPlanRow, "cycleLength" | "plantsPerBox" | "correction">): SowingPlanRow {
  return {
    ...row,
    cycleLength: deriveCycleLength(row.sowingDate, row.harvestDate),
    plantsPerBox: plannerConfig.defaultPlantsPerBox,
    correction: 0,
    weekNumber: getIsoWeek(row.sowingDate),
    status: row.source === "demo" ? "planned" : "planned",
    changeHistory: [],
  };
}

function getIsoWeek(date: string): number {
  const value = new Date(`${date}T12:00:00`);
  const day = value.getDay() || 7;
  value.setDate(value.getDate() + 4 - day);
  const yearStart = new Date(value.getFullYear(), 0, 1, 12);
  return Math.ceil(((value.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

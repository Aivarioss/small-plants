import { describe, expect, it } from "vitest";
import { plannerConfig } from "./demo-data";
import { buildGreenhouseOccupancyDay, simulateSowingDateChange } from "./greenhouse-simulation";
import { simulateGreenhouseSowing, simulateTwoHusSowing } from "./greenhouse-sowing-simulator";
import { simulateJointSowingPlan } from "./joint-greenhouse-simulation";
import { calculateSowingPlan, calculateWorkMaterialSummary, generateWorkItems, generateWorksheetDays, getTotalSow } from "./planning";
import { formatPrintSowingPlan, localizedMonthlyPrintRows, printMaterialSummary } from "./localization";
import type { SowingPlanRow } from "./types";

const row: SowingPlanRow = {
  id: "hus-3", sectorName: "Hus 3", requiredPlants: 3744, extraPlants: 100,
  greenhouseRequiredPlants: 3600, variety: "Baltazsara", sowingDate: "2026-10-01",
  harvestDate: "2026-10-23", cycleLength: 23, sectorType: 26, plantsPerBox: 12, correction: 0,
};

describe("sowing capacity without duplicate reserve", () => {
  it.each([
    [0, 0, 0], [1, 0, 1], [16, 0, 1], [17, 0, 2],
    [1456, 0, 91], [1457, 0, 92], [1471, 0, 92], [1472, 1, 0],
    [1473, 1, 1], [2944, 2, 0], [3844, 2, 57], [4415, 2, 92], [4416, 3, 0],
  ])("allocates %i plants as %i full tables and %i partial rows", (plants, full, partial) => {
    expect(calculateSowingPlan(plants)).toMatchObject({ fullTables: full, partialRows: partial, hasPartialTable: partial > 0 });
  });

  it("never exceeds 92 rows or adds more than rounding to a 16-place row", () => {
    for (let plants = 0; plants <= 13 * 1472; plants++) {
      const plan = calculateSowingPlan(plants);
      const places = plan.fullTables * 1472 + plan.partialRows * 16;
      expect(plan.partialRows).toBeLessThanOrEqual(92);
      expect(places - plants).toBeGreaterThanOrEqual(0);
      expect(places - plants).toBeLessThan(16);
    }
  });

  it("uses the entered Extra once and keeps wool equal to seeds despite later losses", () => {
    for (const extraPlants of [0, 35, 100, 200]) {
      const changed = { ...row, extraPlants, correction: -50 };
      const total = 3744 + extraPlants;
      expect(getTotalSow(changed)).toBe(total);
      expect(calculateWorkMaterialSummary(changed).sowing).toContain(`${total.toLocaleString("lv-LV")} vates`);
    }
  });

  it("propagates the HUS 3 result through work, worksheet and LV/EN print paths", () => {
    const lv = "2 pilni galdi + nepilns galds 16x57";
    const en = "2 full tables + partial table 16x57";
    const work = generateWorkItems(row, plannerConfig);
    expect(calculateWorkMaterialSummary(row).sowing).toBe(`${lv} · ${getTotalSow(row).toLocaleString("lv-LV")} vates`);
    expect(work.find(item => item.type === "sowing")).toMatchObject({ plantCount: 3844 });
    expect(work.find(item => item.type === "sowing")?.details.join(" ")).toContain(lv);
    expect(JSON.stringify(generateWorksheetDays(row, plannerConfig))).toContain(lv);
    for (const [language, label] of [["lv", lv], ["en", en]] as const) {
      expect(formatPrintSowingPlan(3844, language)).toBe(label);
      expect(printMaterialSummary(row, language).sowing).toBe(label);
      expect(localizedMonthlyPrintRows(work, [row], language).find(item => item.plantCount === 3844 && item.notes.includes(label))).toBeDefined();
    }
  });

  it("keeps calendar and date simulation capacity at three seeding tables", () => {
    expect(buildGreenhouseOccupancyDay([row], plannerConfig, row.sowingDate).seeding.usedTables).toBe(3);
    const simulation = simulateSowingDateChange([row], plannerConfig, row.id, "2026-10-02");
    expect(simulation.originalRowsUnchanged).toBe(true);
    expect(simulation.occupancy.find(day => day.date === "2026-10-02")?.seeding.usedTables).toBe(3);
    const joint = simulateJointSowingPlan({ rows: [row], config: plannerConfig,
      asOfDate: "2026-09-30", sowingChanges: [{ planRowId: row.id, sowingDate: "2026-10-02" }] });
    expect(joint.plans.length).toBeGreaterThan(0);
    for (const plan of joint.plans) {
      expect(plan.occupancy.find(day => day.date === "2026-10-02")?.seeding.usedTables).toBe(3);
      expect(plan.workItems.find(item => item.type === "sowing")?.details.join(" ")).toContain("16x57");
    }
  });

  it("preserves the HUS 3 material count in the single-HUS preview", () => {
    const rows = [structuredClone(row)];
    const before = structuredClone(rows);
    const result = simulateGreenhouseSowing(rows, plannerConfig, row.id, "2026-10-02", "2026-09-30");
    expect(result.recommendation).toBeDefined();
    expect(result.occupancy.find(day => day.date === "2026-10-02")?.seeding.usedTables).toBe(3);
    expect(calculateWorkMaterialSummary(result.scenarioRows[0]).sowing).toContain("16x57");
    expect(getTotalSow(result.scenarioRows[0])).toBe(3844);
    expect(rows).toEqual(before);
  });

  it("keeps both HUS previews at three seeding tables without changing input data", () => {
    const second: SowingPlanRow = { ...row, id: "hus-4", sectorName: "Hus 4", sowingDate: "2026-10-02", harvestDate: "2026-10-24" };
    const rows = [structuredClone(row), second];
    const before = structuredClone(rows);
    const result = simulateTwoHusSowing(rows, plannerConfig, [
      { planRowId: row.id, sowingDate: "2026-10-02" },
      { planRowId: second.id, sowingDate: "2026-10-03" },
    ], "2026-09-30");
    expect(result.proposals).toHaveLength(2);
    for (const proposal of result.proposals) expect(proposal.seedingTableCount).toBe(3);
    const sowingWork = result.plan?.workItems.filter(item => item.type === "sowing");
    expect(sowingWork).toHaveLength(2);
    for (const item of sowingWork ?? []) {
      expect(item.plantCount).toBe(3844);
      expect(item.details.join(" ")).toContain("16x57");
    }
    expect(rows).toEqual(before);
  });
});

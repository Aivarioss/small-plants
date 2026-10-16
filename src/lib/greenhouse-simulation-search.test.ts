import { describe, expect, it } from "vitest";
import { plannerConfig } from "./demo-data";
import { buildGreenhouseOccupancyDay, simulateSowingDateChange } from "./greenhouse-simulation";
import type { SowingPlanRow } from "./types";

const target: SowingPlanRow = {
  id: "target", sectorName: "HUS 8A", requiredPlants: 3656, extraPlants: 0, variety: "Test",
  sowingDate: "2026-10-20", harvestDate: "2026-11-11", cycleLength: 23,
  sectorType: 26, plantsPerBox: 12, correction: 0, source: "user",
};
const simulate = (rows: SowingPlanRow[]) => simulateSowingDateChange(rows, plannerConfig, "target", "2026-10-20");
const blocker = (id: string, primaryRow: "A" | "B" | "C" | "D", tables = 26, harvestDate = "2026-11-20"): SowingPlanRow => ({
  ...target, id, sectorName: id, requiredPlants: tables * 150, sowingDate: "2026-09-20", harvestDate,
  sowingTables: "A10–A13", placement: { primaryRow, tables, manual: true },
  adjustments: { thinning: "2026-09-28" },
});

describe("solution-seeking HUS simulation", () => {
  it("derives seeding count using the existing sowing capacity and proposes a compact free combination", () => {
    const result = simulate([target]);
    expect(result.status).toBe("can");
    expect(result.recommendation?.seedingTables).toEqual(["A1", "A2", "A3"]);
    expect(target.sowingTables).toBeUndefined();
  });

  it("does not offer a table that becomes occupied after sowing but before thinning", () => {
    const next = { ...target, id: "next", sectorName: "Next", requiredPlants: 900,
      sowingTables: "A1", sowingDate: "2026-10-21", harvestDate: "2026-11-12", adjustments: { thinning: "2026-10-28" } };
    const result = simulate([target, next]);
    expect(result.recommendation?.seedingTables).toEqual(["A2", "A3", "A4"]);
  });

  it("keeps seeding tables occupied on thinning day and chooses day 8 to release them for next sowing", () => {
    const next = { ...target, id: "next", sectorName: "Next", sowingTables: "A1–A3",
      sowingDate: "2026-10-28", harvestDate: "2026-11-19", adjustments: { thinning: "2026-11-04" } };
    const result = simulate([{ ...target, sowingTables: "A1–A3" }, next]);
    expect(result.recommendation?.cycleDay).toBe(8);
    expect(result.recommendation?.explanation).toContain("nākamajai sēšanai");
    expect(result.occupancy.find((day) => day.date === "2026-10-27")?.seeding.rows.some((row) => row.planRowId === "target")).toBe(true);
    expect(result.occupancy.find((day) => day.date === "2026-10-28")?.seeding.rows.map((row) => row.planRowId)).toEqual(["next"]);
  });

  it("evaluates earlier thinning when another HUS is seeded on day 9, without banning same-day sowing", () => {
    const next = { ...target, id: "next", sectorName: "Next", requiredPlants: 900, sowingTables: "A13",
      sowingDate: "2026-10-28", harvestDate: "2026-11-19", adjustments: { thinning: "2026-11-04" } };
    const result = simulate([target, next]);
    expect(result.recommendation?.cycleDay).toBe(8);
    const sameDay = result.alternatives.find((option) => option.cycleDay === 9);
    expect(sameDay).toBeDefined();
    expect(sameDay?.workload.sowingCount).toBe(1);
  });

  it("uses a row on Planting day with explicit work order and conditional status", () => {
    const rows = [blocker("B", "B", 26, "2026-10-27"), blocker("C", "C"), blocker("D", "D"), blocker("A", "A", 13)];
    const result = simulate([target, ...rows]);
    const handoff = result.alternatives.find((option) => option.cycleDay === 8);
    expect(handoff?.wateringZone).toBe("B");
    expect(handoff?.status).toBe("conditional");
    expect(handoff?.risks.join(" ")).toContain("vispirms jāizvāc");
  });

  it("finds an existing density class that fits the A extra block when normal placement does not fit", () => {
    const small = { ...target, requiredPlants: 2000 };
    const result = simulate([small, blocker("B", "B"), blocker("C", "C"), blocker("D", "D"), blocker("A", "A", 3)]);
    const best = result.recommendation!;
    expect(best).toBeDefined();
    expect(best.wateringZone).toBe("A");
    expect(best.normalTables).toBeGreaterThan(best.physicalTables);
    expect(best.physicalTables).toBeLessThanOrEqual(10);
    expect(best.plantsPerTrough).toBeLessThanOrEqual(35);
    expect(best.status).toBe("conditional");
    expect(best.risks.join(" ")).toContain("konkrētā HUS atļauja");
  });

  it("never offers a density above the production limit or a physically oversized A placement", () => {
    const result = simulate([{ ...target, requiredPlants: 2800 },
      blocker("B", "B"), blocker("C", "C"), blocker("D", "D"), blocker("A", "A", 3)]);
    expect(result.recommendation).toBeUndefined();
    expect(result.status).toBe("cannot");
  });

  it("checks future growing reservations throughout the entire stay", () => {
    const future = { ...target, id: "future", sectorName: "Future", sowingDate: "2026-10-24",
      harvestDate: "2026-11-15", sowingTables: "A10–A12", adjustments: { thinning: "2026-10-31" },
      placement: { primaryRow: "B" as const, tables: 26, manual: true } };
    const result = simulate([target, future]);
    expect(result.recommendation?.wateringZone).not.toBe("B");
  });

  it("preserves actual Moving data, photo/archive data and every input row", () => {
    const actual = { ...blocker("actual", "C"), husEvents: [{ id: "moving", eventType: "move" as const,
      eventDate: "2026-09-28", location: "A10–A13", destinationLocation: "B1–B26" }] };
    const rows = [target, actual];
    const before = structuredClone(rows);
    const result = simulate(rows);
    expect(rows).toEqual(before);
    expect(result.originalRowsUnchanged).toBe(true);
    expect(result.changedOtherWork).toEqual([]);
    expect(result.scenarioRows.find((row) => row.id === "actual")).toBe(actual);
    expect(result.recommendation?.wateringZone).not.toBe("B");
  });

  it("does not claim a fully verified solution when another HUS has unknown seeding tables", () => {
    const result = simulate([target, { ...target, id: "unknown", sectorName: "Unknown" }]);
    expect(result.status).toBe("conditional");
    expect(result.recommendation?.status).toBe(result.status);
    expect(result.warnings.join(" ")).toContain("Unknown: nav norādīti sēšanas galdi");
  });

  it("does not repeat equivalent dates, densities or identical B/C/D rows", () => {
    const result = simulate([target]);
    expect(result.alternatives.filter((option) => option.tier === "preferred")).toHaveLength(1);
    expect(result.alternatives.length).toBeLessThanOrEqual(4);
    expect(result.recommendation).toBe(result.alternatives[0]);
    expect(result.alternatives.every((option) => option.physicalTables === option.normalTables)).toBe(true);
  });

  it("does not change the existing occupancy calculation, including unassigned seeding data", () => {
    const rows = [target, blocker("C", "C")];
    const before = buildGreenhouseOccupancyDay(rows, plannerConfig, "2026-10-27");
    simulate(rows);
    expect(buildGreenhouseOccupancyDay(rows, plannerConfig, "2026-10-27")).toEqual(before);
    expect(before.seeding.incomplete).toBe(true);
    expect(before.growing.capacity).toBe(91);
    expect(before.seeding.capacity).toBe(13);
  });

  it("names the missing plant count instead of inventing a capacity", () => {
    const result = simulate([{ ...target, requiredPlants: Number.NaN }]);
    expect(result.status).toBe("insufficientData");
    expect(result.warnings.join(" ")).toContain("stādu skaita");
  });

  it("never interprets A14–A26 as having more than thirteen physical tables", () => {
    const result = simulate([{ ...target, requiredPlants: 2000, placement: { primaryRow: "A", tables: 14, manual: true } }]);
    expect(result.alternatives.length).toBeGreaterThan(0);
    expect(result.alternatives.every((option) => option.physicalTables <= 13)).toBe(true);
    expect(result.status).toBe("conditional");
  });

  it("leaves recorded Moving untouched when the target has already been moved", () => {
    const moved = { ...target, husEvents: [{ id: "actual", eventType: "move" as const, eventDate: "2026-10-27",
      location: "A1–A3", destinationLocation: "C1–C24" }] };
    const before = structuredClone(moved);
    const result = simulate([moved]);
    expect(result.status).toBe("insufficientData");
    expect(result.recommendation).toBeUndefined();
    expect(moved).toEqual(before);
    expect(result.warnings.join(" ")).toContain("faktiskais Moving");
  });

  it("counts every actual row, including a second row in one Moving record", () => {
    const actual = { ...blocker("actual-multi", "B"), husEvents: [{ id: "multi", eventType: "move" as const,
      eventDate: "2026-09-28", location: "A10–A13", destinationLocation: "B1–B13\nC1–C26" }] };
    const result = simulate([target, actual, blocker("D", "D"), blocker("A", "A", 13)]);
    expect(result.recommendation).toBeUndefined();
  });

  it("a shared proposal does not double-count the existing watering-row reservation", () => {
    const tiny = { ...target, requiredPlants: 900 };
    const result = simulate([tiny, blocker("B", "B", 20), blocker("C", "C", 20), blocker("D", "D", 20), blocker("A", "A", 13)]);
    expect(result.recommendation?.placementKind).toBe("sharedRow");
    const day = result.occupancy.find((day) => day.date === result.recommendation?.thinningDate)!;
    expect(day.growing.usedTables).toBeLessThanOrEqual(91);
    expect(day.growing.overCapacity).toBe(false);
  });
});

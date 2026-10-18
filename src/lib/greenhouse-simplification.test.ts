import { describe, expect, it } from "vitest";
import { plannerConfig } from "./demo-data";
import { buildGreenhouseOccupancyDay, greenhouseSimulationModel as model, simulateSowingDateChange } from "./greenhouse-simulation";
import { simulateGreenhouseSowing } from "./greenhouse-sowing-simulator";
import type { HusEventEntry, SowingPlanRow } from "./types";

function hus(overrides: Partial<SowingPlanRow> = {}): SowingPlanRow {
  return { id: "target", sectorName: "HUS 8A", requiredPlants: 3656, extraPlants: 0, variety: "Synthetic",
    sowingDate: "2026-10-20", harvestDate: "2026-11-11", cycleLength: 23, sectorType: 26,
    plantsPerBox: 12, correction: 0, source: "user", ...overrides };
}
function moving(location: string | undefined, destinationLocation = "B1–B24", eventDate = "2026-10-09", note?: string): HusEventEntry {
  return { id: eventDate + location, eventType: "move", eventDate, location, destinationLocation, note };
}
function previous(events?: HusEventEntry[]): SowingPlanRow {
  return hus({ id: "previous", sectorName: "HUS previous", requiredPlants: 3000, sowingDate: "2026-10-01",
    harvestDate: "2026-10-23", sowingTables: "A1–A3", adjustments: { thinning: "2026-10-09" },
    placement: { primaryRow: "B", tables: 25, manual: true }, husEvents: events });
}
const snapshot = (row: SowingPlanRow, date: string) => buildGreenhouseOccupancyDay([row], plannerConfig, date);

describe("actual seeding table release", () => {
  it("keeps the planned thinning day reserved and releases the next day", () => {
    expect(snapshot(previous(), "2026-10-09").seeding.usedTables).toBe(3);
    expect(snapshot(previous(), "2026-10-10").seeding.usedTables).toBe(0);
  });

  it("releases all explicitly moved source tables on the Moving date", () => {
    const row = previous([moving("A1–A3")]);
    expect(snapshot(row, "2026-10-08").seeding.usedTables).toBe(3);
    expect(snapshot(row, "2026-10-09").seeding.usedTables).toBe(0);
    expect(snapshot(row, "2026-10-09").seeding.freeTableIds).toEqual(expect.arrayContaining(["A1", "A2", "A3"]));
    expect(model.seedingOccupancy([row], model.growingPlacements([row]), "2026-10-09").usedTables).toBe(0);
  });

  it("releases only fully identified tables during successive partial HUS movements", () => {
    const row = previous([moving("A1", "B1–B8"), moving("A2", "B9–B16", "2026-10-10"), moving("A3", "B17–B24", "2026-10-12")]);
    expect(snapshot(row, "2026-10-09").seeding.occupiedTableIds).toEqual(["A2", "A3"]);
    expect(snapshot(row, "2026-10-10").seeding.occupiedTableIds).toEqual(["A3"]);
    expect(snapshot(row, "2026-10-11").seeding.occupiedTableIds).toEqual(["A3"]);
    expect(snapshot(row, "2026-10-12").seeding.usedTables).toBe(0);
    expect(model.seedingOccupancy([row], model.growingPlacements([row]), "2026-10-10").usedTables).toBe(1);
  });

  it("can establish full release from explicit Moving sources even without previously assigned A numbers", () => {
    const row = { ...previous([moving("A1 A2; A3")]), sowingTables: undefined };
    expect(snapshot(row, "2026-10-09").seeding.unknownRows).toEqual([]);
    expect(model.seedingOccupancy([row], model.growingPlacements([row]), "2026-10-09").usedTables).toBe(0);
    const partial = { ...row, husEvents: [moving("A1")] };
    expect(snapshot(partial, "2026-10-09").seeding).toMatchObject({ usedTables: 2, freeTables: 11, incomplete: true });
    expect(model.seedingOccupancy([partial], model.growingPlacements([partial]), "2026-10-09").usedTables).toBe(2);
  });

  it.each([
    moving(undefined), moving("A1 (daļa)"), moving("A1", "B rinda"), moving("A1", "B1–B8", "2026-10-09", "Pārvietota tikai daļa; pārējie paliek"),
  ])("does not invent complete release from ambiguous Moving %#", (event) => {
    const row = previous([event]);
    expect(snapshot(row, "2026-10-11").seeding.occupiedTableIds).toEqual(["A1", "A2", "A3"]);
    expect(model.seedingOccupancy([row], model.growingPlacements([row]), "2026-10-11")).toMatchObject({ usedTables: 3, incomplete: true });
  });

  it("does not count repeated source tables or growing-to-growing moves as additional seeding release", () => {
    const row = previous([moving("A1", "B1–B8"), moving("A1", "B1–B8", "2026-10-10"), moving("B1–B8", "C1–C8", "2026-10-11")]);
    expect(snapshot(row, "2026-10-12").seeding.occupiedTableIds).toEqual(["A2", "A3"]);
    expect(snapshot(row, "2026-10-12").growing.rows[0]?.rowLabel).toBe("C1-C8");
  });

  it("does not let later-event Moving change any historical occupancy or warnings", () => {
    const first = moving("A1", "B1–B8");
    const future = moving("A2–A3", "C1–C16", "2026-10-12");
    expect(snapshot(previous([first, future]), "2026-10-10")).toEqual(snapshot(previous([first]), "2026-10-10"));
    expect(snapshot(previous([future]), "2026-10-10")).toEqual(snapshot(previous(), "2026-10-10"));
  });

  it("removes count-only mismatch warnings while retaining actual occupancy and real table conflicts", () => {
    const row = previous([moving("A1–A3")]);
    const one = snapshot(row, "2026-10-09");
    expect(one.growing.physicalUsedTables).toBe(24);
    expect(one.growing.usedTables).toBe(26);
    expect(one.warnings).toEqual([]);
    const other = { ...row, id: "second", sectorName: "Second HUS" };
    const conflict = buildGreenhouseOccupancyDay([row, other], plannerConfig, "2026-10-09");
    expect(conflict.warnings.join(" ")).toContain("B1");
    expect(conflict.warnings.join(" ")).toContain("Second HUS");
    expect(conflict.growing.overCapacity).toBe(true);
    expect(conflict.warnings.join(" ")).not.toContain("pārsniedz 91");
    expect(row.placement?.tables).toBe(25);
  });
});

describe("simple sowing preview over the existing engines", () => {
  it("preserves the cycle when recalculating Planting in both simulation entry points", () => {
    const row = hus();
    expect(simulateGreenhouseSowing([row], plannerConfig, row.id, "2026-10-17", "2026-10-16").newMoveOutDate).toBe("2026-11-08");
    expect(simulateSowingDateChange([row], plannerConfig, row.id, "2026-10-17").newMoveOutDate).toBe("2026-11-08");
  });

  it("prefers a normal direct solution and preserves all records and actual occupancy", () => {
    const rows = [hus(), previous([moving("A1–A3")])];
    const before = structuredClone(rows);
    const actual = buildGreenhouseOccupancyDay(rows, plannerConfig, "2026-10-18");
    const result = simulateGreenhouseSowing(rows, plannerConfig, "target", "2026-10-18", "2026-10-16");
    expect(result.status).toBe("can");
    expect(result.recommendation).toMatchObject({ seedingTableCount: 3, densityClass: "normal" });
    expect(result.changedOtherWork).toEqual([]);
    expect(rows).toEqual(before);
    expect(buildGreenhouseOccupancyDay(rows, plannerConfig, "2026-10-18")).toEqual(actual);
  });

  it("uses the joint engine to adjust pending thinning and explicitly names the other HUS and dates", () => {
    const target = hus({ sowingDate: "2026-10-23", harvestDate: "2026-11-14" });
    const other = hus({ id: "other", sectorName: "HUS 8B", requiredPlants: 900, sowingDate: "2026-10-13", harvestDate: "2026-11-04",
      sowingTables: "A1–A11", adjustments: { thinning: "2026-10-22" }, adjustmentSources: { thinning: "optimizer" }, placement: { primaryRow: "D", tables: 6, manual: true } });
    const rows = [target, other];
    const before = structuredClone(rows);
    const result = simulateGreenhouseSowing(rows, plannerConfig, target.id, "2026-10-21", "2026-10-16");
    expect(result.status).toBe("conditional");
    expect(result.recommendation).toBeDefined();
    expect(result.requiredChanges?.some((notice) => notice.lv.includes("HUS 8B: retināšana 2026-10-22 → 2026-10-20"))).toBe(true);
    expect(result.requiredChanges?.some((notice) => notice.lv.includes("disinfectTables") || notice.lv.includes("previcur"))).toBe(false);
    expect(result.changedOtherWork).toContainEqual(expect.objectContaining({ planRowId: "other", type: "thinning", before: ["2026-10-22"], after: ["2026-10-20"] }));
    expect(rows).toEqual(before);
    expect(result.scenarioRows.map((row) => row.harvestDate)).toEqual(["2026-11-12", other.harvestDate]);
  });

  it("labels sowing on an actual Moving release date as conditional work order", () => {
    const target = hus({ sowingDate: "2026-10-10", harvestDate: "2026-11-01", sowingTables: "A1–A3" });
    const result = simulateGreenhouseSowing([target, previous([moving("A1–A3")])], plannerConfig, target.id, "2026-10-09", "2026-10-08");
    expect(result.status).toBe("conditional");
    expect(result.recommendation?.notices.some((notice) => notice.en.includes("same-day sowing requires"))).toBe(true);
    expect(result.occupancy.find((day) => day.date === "2026-10-09")?.seeding.conflicts).toEqual([]);
  });

  it("offers planned same-day thinning/sowing only with explicit work-order approval", () => {
    const target = hus({ sowingDate: "2026-10-10", harvestDate: "2026-11-01", sowingTables: "A1–A3" });
    const other = { ...previous(), sowingDate: "2026-10-02" };
    const rows = [target, other];
    expect(simulateSowingDateChange(rows, plannerConfig, target.id, "2026-10-09").recommendation).toBeUndefined();
    const result = simulateGreenhouseSowing(rows, plannerConfig, target.id, "2026-10-09", "2026-10-09");
    expect(result.status).toBe("conditional");
    expect(result.recommendation?.notices.some((notice) => notice.en.includes("thin HUS previous") && notice.en.includes("before sowing"))).toBe(true);
    expect(result.occupancy.find((day) => day.date === "2026-10-09")?.seeding.conflicts).toEqual([]);
    expect(buildGreenhouseOccupancyDay(rows, plannerConfig, "2026-10-09").seeding.usedTables).toBe(3);
  });

  it("does not free all tables after a partial Moving or replan an already moved target", () => {
    const partial = previous([moving("A1", "B1–B8")]);
    const result = simulateGreenhouseSowing([partial], plannerConfig, partial.id, "2026-10-02", "2026-10-09");
    expect(result.recommendation).toBeUndefined();
    expect(result.notices[0].en).toContain("actual Moving");
    expect(snapshot(partial, "2026-10-13").seeding.usedTables).toBe(2);
  });

  it("also protects an actual thinning event whose location is missing", () => {
    const row = hus({ husEvents: [{ id: "done", eventType: "thinning", eventDate: "2026-10-28" }] });
    const result = simulateGreenhouseSowing([row], plannerConfig, row.id, "2026-10-18", "2026-10-16");
    expect(result.recommendation).toBeUndefined();
    expect(result.status).toBe("insufficientData");
  });
});

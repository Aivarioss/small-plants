import { describe, expect, it } from "vitest";
import { twoHusScenario } from "./__fixtures__/two-hus-scenario";
import { plannerConfig } from "./demo-data";
import { buildGreenhouseOccupancyDay } from "./greenhouse-simulation";
import { simulateJointSowingPlan, type JointSimulationRequest } from "./joint-greenhouse-simulation";
import { simulateGreenhouseSowing } from "./greenhouse-sowing-simulator";
import type { SowingPlanRow } from "./types";

const changes = [{ planRowId: "HUS 8A", sowingDate: "2026-10-18" }, { planRowId: "HUS 8B", sowingDate: "2026-10-20" }];
function run(rows = twoHusScenario(), options: Partial<JointSimulationRequest> = {}) {
  return simulateJointSowingPlan({ rows, config: plannerConfig, asOfDate: "2026-10-17", sowingChanges: changes,
    recalculateFuturePlacements: true, allowOtherSowingChanges: false, ...options });
}
function future(rows: SowingPlanRow[], id: string, sowingDate: string, harvestDate: string): SowingPlanRow {
  return { ...rows[1], id, sectorName: id, sowingDate, harvestDate, adjustments: {},
    placement: { primaryRow: "C", tables: 26, manual: false } };
}
function november() {
  const rows = twoHusScenario();
  rows.push(future(rows, "HUS 3", "2026-10-28", "2026-11-28"));
  rows.push(future(rows, "HUS 2N", "2026-11-02", "2026-11-30"));
  return rows;
}

describe("fresh planning of the entire future greenhouse", () => {
  it("discards old automatic rows and dates, with the controlled October 27/C and October 29/B result", () => {
    const rows = twoHusScenario();
    const before = structuredClone(rows);
    const result = run(rows);
    expect(result.status).toBe("can");
    expect(result.plans).toHaveLength(1);
    expect(result.plans[0].proposals.map((p) => [p.planRowId, p.thinningDate, p.cycleDay, p.wateringZone, p.plantingDate])).toEqual([
      ["HUS 8A", "2026-10-27", 10, "C", "2026-11-09"], ["HUS 8B", "2026-10-29", 10, "B", "2026-11-13"],
    ]);
    // Previously valid automatic choices are neither locks nor tie-breakers.
    rows[0].placement!.primaryRow = "D";
    rows[1].placement!.primaryRow = "B";
    rows[0].adjustments!.thinning = "2026-10-25";
    rows[1].adjustments!.thinning = "2026-10-29";
    expect(run(rows).plans[0].proposals).toEqual(result.plans[0].proposals);
    expect(before.slice(2)).toEqual(rows.slice(2));
    expect(result.search.frozenByLimit).toEqual([]);
  });

  it("uses the same fresh engine in single-HUS mode and reports every necessary other-HUS change", () => {
    const rows = november();
    const result = simulateGreenhouseSowing(rows, plannerConfig, "HUS 8A", "2026-10-18", "2026-10-17");
    expect(result.status).toBe("conditional");
    expect(result.recommendation).toMatchObject({ wateringZone: "C", cycleDay: 10 });
    expect(result.requiredChanges?.some((notice) => notice.lv.includes("HUS 8B: augšanas rinda C → B"))).toBe(true);
    expect(result.requiredChanges?.some((notice) => notice.lv.includes("HUS 3: augšanas rinda C → D"))).toBe(true);
    expect(result.scenarioRows[0].harvestDate).toBe("2026-11-09");
    expect(result.scenarioRows.slice(1).map((row) => row.harvestDate)).toEqual(rows.slice(1).map((row) => row.harvestDate));
  });

  it("removes overlapping November automatic reservations, counts each HUS once, and releases on Planting day", () => {
    const rows = november();
    const before = structuredClone(rows);
    const house = buildGreenhouseOccupancyDay(rows, plannerConfig, "2026-11-12");
    const result = run(rows);
    const plan = result.plans[0];
    expect(plan).toBeDefined();
    expect(plan.proposals.every((p) => p.cycleDay <= 10)).toBe(true);
    const day12 = plan.occupancy.find((day) => day.date === "2026-11-12")!;
    expect(day12.growing.usedTables).toBe(78);
    expect(day12.growing.physicalUsedTables).toBe(78);
    for (const date of ["2026-11-13", "2026-11-14"]) {
      const day = plan.occupancy.find((entry) => entry.date === date)!;
      expect(day.growing.usedTables).toBe(52);
      expect(day.growing.rows.map((row) => row.planRowId).sort()).toEqual(["HUS 2N", "HUS 3"]);
    }
    expect(plan.proposals.find((p) => p.planRowId === "HUS 3")?.wateringZone).toBe("D");
    expect(plan.proposals.find((p) => p.planRowId === "HUS 2N")?.wateringZone).toBe("C");
    expect(plan.occupancy.find((day) => day.date === "2026-11-09")!.growing.rows.some((row) => row.planRowId === "HUS 8A")).toBe(false);
    expect(plan.occupancy.every((day) => !day.growing.overCapacity && !day.seeding.overCapacity)).toBe(true);
    expect(rows).toEqual(before);
    expect(buildGreenhouseOccupancyDay(rows, plannerConfig, "2026-11-12")).toEqual(house);
  });

  it("proves a November 12 minimum of 99/91 and an eight-table deficit, even allowing maximum compression", () => {
    const rows = november();
    for (const row of [rows[1], rows[5], rows[6]]) {
      row.requiredPlants = 6900; // at most 35 plants/trough, six troughs/table -> at least 33 tables
      row.placement = { ...row.placement, tables: 39, manual: false };
    }
    rows[6].sowingDate = "2026-11-03";
    rows[6].adjustments = { thinning: "2026-11-12" };
    rows[6].adjustmentSources = { thinning: "manual" };
    const result = run(rows);
    expect(result.status).toBe("cannot");
    expect(result.proof).toEqual({ kind: "minimumCapacity", date: "2026-11-12", requiredTables: 99, capacity: 91 });
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].planRowIds).toEqual(["HUS 2N", "HUS 3", "HUS 8B"]);
    expect(result.conflicts[0].message.lv).toContain("minimālais trūkums 8");
  });

  it("backtracks an earlier automatic row to accommodate a later immutable Moving", () => {
    const rows = twoHusScenario().slice(0, 2);
    rows.push(future(rows, "Third", "2026-10-22", "2026-11-18"));
    rows.push({ ...future(rows, "Fixed", "2026-11-03", "2026-11-25"), sowingTables: "A10–A12",
      husEvents: [{ id: "fixed-moving", eventType: "move", eventDate: "2026-11-11", location: "A10–A12", destinationLocation: "C1–C26" }] });
    const result = run(rows);
    expect(result.plans[0], JSON.stringify(result)).toBeDefined();
    expect(result.search.backtracks).toBeGreaterThan(0);
    expect(result.plans[0].proposals.find((p) => p.planRowId === "HUS 8A")?.wateringZone).toBe("C");
    expect(result.plans[0].proposals.some((p) => p.planRowId === "Fixed")).toBe(false);
    expect(result.plans[0].occupancy.every((day) => !day.growing.overCapacity)).toBe(true);
  });

  it("honours a later manual row/date and explicitly reports preserved unknown provenance", () => {
    const rows = november();
    rows[5].placement = { primaryRow: "D", tables: 26, manual: true };
    rows[5].adjustments = { thinning: "2026-11-06" };
    rows[5].adjustmentSources = { thinning: "manual" };
    rows[6].placement = { primaryRow: "C", tables: 26 }; // provenance unknown
    const result = run(rows);
    expect(result.plans[0].proposals.find((p) => p.planRowId === "HUS 3")).toMatchObject({ thinningDate: "2026-11-06", wateringZone: "D", physicalTables: 26 });
    expect(result.plans[0].proposals.find((p) => p.planRowId === "HUS 2N")?.wateringZone).toBe("C");
    expect(result.plans[0].notices.some((notice) => notice.en.includes("provenance is unknown"))).toBe(true);
  });

  it("rebuilds all other automatic HUS even when pinning an exact selected candidate", () => {
    const result = run(november(), { candidatePlacements: [
      { planRowId: "HUS 8A", thinningDate: "2026-10-27", wateringZone: "C", physicalTables: 26 },
      { planRowId: "HUS 8B", thinningDate: "2026-10-29", wateringZone: "B", physicalTables: 26 },
    ] });
    expect(result.plans[0].proposals).toHaveLength(4);
    expect(result.plans[0].proposals.find((p) => p.planRowId === "HUS 3")?.wateringZone).toBe("D");
  });

  it("uses day 11 only after proving four regular-window HUS cannot fit three long rows", () => {
    const rows = november();
    rows[6].sowingDate = "2026-10-30";
    const result = run(rows);
    expect(result.status).toBe("conditional");
    expect(result.plans[0].score.emergencyDays).toBe(1);
    expect(result.plans[0].proposals.find((p) => p.planRowId === "HUS 2N")).toMatchObject({ cycleDay: 11, thinningDate: "2026-11-09", wateringZone: "C" });
    expect(result.search.stages).toEqual(["normal", "compromise", "emergency"]);
  });

  it("never freezes old reservations at maxMutableRows in fresh mode", () => {
    const result = run(november(), { limits: { maxMutableRows: 1 } });
    expect(result.plans[0].proposals).toHaveLength(4);
    expect(result.search.frozenByLimit).toEqual([]);
  });

  it("makes an unknown-origin saved thinning date explicit, while still rebuilding automatic rows", () => {
    const rows = twoHusScenario();
    rows[0].adjustments = { thinning: "2026-10-27" };
    rows[0].adjustmentSources = {};
    const result = run(rows);
    expect(result.status).toBe("conditional");
    expect(result.plans[0].proposals.find((p) => p.planRowId === rows[0].id)).toMatchObject({ thinningDate: "2026-10-27", wateringZone: "C" });
    expect(result.plans[0].notices.some((notice) => notice.en.includes("thinning-date provenance is unknown"))).toBe(true);
  });

  it("keeps insufficient search distinct from proven impossibility and limits failed-candidate messages", () => {
    const result = run(november(), { limits: { maxNodes: 1 } });
    expect(result.status).toBe("searchLimited");
    expect(result.proof).toBeUndefined();
    expect(result.plans).toEqual([]);
    expect(result.conflicts.length).toBeLessThanOrEqual(2);
    expect(result.conflicts[0].code).toBe("searchLimit");
  });

  it("keeps a certified plan at the exact node limit and discloses an incomplete optimization", () => {
    const result = run(twoHusScenario(), { limits: { maxNodes: 7 } });
    expect(result.plans[0]).toBeDefined();
    expect(result.status).toBe("conditional");
    expect(result.plans[0].occupancy.every((day) => !day.growing.overCapacity && !day.seeding.overCapacity)).toBe(true);
    expect(result.plans[0].notices.some((notice) => notice.en.includes("comparison with better alternatives"))).toBe(true);
  });

  it("retains same-day Moving release, count-only seeding and fixed A-table collision checks", () => {
    const rows = twoHusScenario();
    const valid = run(rows).plans[0];
    expect(valid.occupancy.find((day) => day.date === "2026-10-20")!.seeding.usedTables).toBe(6);
    rows[0].sowingTables = "A1–A3";
    rows[1].sowingTables = "A3–A5";
    const invalid = run(rows);
    expect(invalid.status).toBe("cannot");
    expect(invalid.conflicts[0].message.lv).toContain("A3");
    expect(rows[2].husEvents![0].eventDate).toBe("2026-10-07");
  });

  it("uses actual Moving tables even when the old plant count or planned row is obsolete", () => {
    const rows = twoHusScenario();
    rows[2].requiredPlants = Number.NaN;
    rows[2].placement = { primaryRow: "D", tables: 39, manual: true };
    const result = run(rows);
    expect(result.status).toBe("can");
    expect(result.plans[0].proposals[0].wateringZone).toBe("C");
    const actual = result.plans[0].occupancy.find((day) => day.date === "2026-10-18")!.growing.rows.find((row) => row.planRowId === "HUS 6")!;
    expect(actual.actualTableIds).toHaveLength(24);
    expect(actual.actualTableIds?.every((table) => table.startsWith("C"))).toBe(true);
  });

  it("reports an incomplete check when the connected future horizon exceeds the supported limit", () => {
    const rows = november();
    rows.push(future(rows, "Tail 1", "2026-11-20", "2026-12-20"));
    rows.push(future(rows, "Tail 2", "2026-12-10", "2027-01-20"));
    const result = run(rows);
    expect(result.status).toBe("searchLimited");
    expect(result.proof).toBeUndefined();
    expect(result.conflicts[0].message.en).toContain("90 days");
  });

  it("is deterministic across input order and completes the representative seven-HUS case within a conservative budget", () => {
    const rows = november();
    const start = performance.now();
    const first = run(rows);
    const elapsed = performance.now() - start;
    const second = run(rows.slice().reverse());
    expect(second.plans).toEqual(first.plans);
    expect(second.search).toEqual(first.search);
    expect(first.search.nodes).toBeLessThan(1000);
    expect(elapsed).toBeLessThan(3000);
  });
});

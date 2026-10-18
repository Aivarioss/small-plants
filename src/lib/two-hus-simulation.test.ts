import { describe, expect, it } from "vitest";
import { twoHusScenario } from "./__fixtures__/two-hus-scenario";
import { plannerConfig } from "./demo-data";
import { simulateTwoHusSowing, simulateGreenhouseSowing } from "./greenhouse-sowing-simulator";
import { simulateJointSowingPlan } from "./joint-greenhouse-simulation";
import type { SowingPlanRow } from "./types";

const changes = [{ planRowId: "HUS 8A", sowingDate: "2026-10-18" }, { planRowId: "HUS 8B", sowingDate: "2026-10-20" }];
const run = (rows = twoHusScenario(), inputs = changes) => simulateTwoHusSowing(rows, plannerConfig, inputs, "2026-10-17");

describe("two-HUS sowing preview", () => {
  it("swaps B/C, keeps both in regular windows and validates every day without changing data", () => {
    const rows = twoHusScenario();
    const before = structuredClone(rows);
    const result = run(rows);
    expect(result.plan).toBeDefined();
    expect(result.status).toBe("can");
    expect(result.proposals.map((p) => p.thinningDate)).toEqual(["2026-10-27", "2026-10-29"]);
    expect(result.proposals.map((p) => p.wateringZone)).toEqual(["C", "B"]);
    expect(result.proposals.every((p) => p.cycleDay >= 8 && p.cycleDay <= 10)).toBe(true);
    expect(result.proposals.map((p) => p.plantingDate)).toEqual(["2026-11-09", "2026-11-13"]);
    expect(result.requiredChanges).toEqual([]);
    for (const day of result.plan!.occupancy) {
      expect(day.seeding.overCapacity, day.date).toBe(false);
      expect(day.seeding.conflicts, day.date).toEqual([]);
      expect(day.growing.overCapacity, day.date).toBe(false);
    }
    expect(rows).toEqual(before);
    expect(result.originalRowsUnchanged).toBe(true);
  });

  it("also evaluates the exact October 27/C and October 28/B candidate with Planting first", () => {
    const result = simulateJointSowingPlan({ rows: twoHusScenario(), config: plannerConfig, asOfDate: "2026-10-17", sowingChanges: changes,
      allowOtherSowingChanges: false, prioritizeRequestedHus: true });
    const candidate = result.plans.find((p) => p.proposals.find((h) => h.planRowId === "HUS 8A")?.thinningDate === "2026-10-27" &&
      p.proposals.find((h) => h.planRowId === "HUS 8B")?.thinningDate === "2026-10-28");
    expect(candidate).toBeDefined();
    expect(candidate!.status).toBe("conditional");
    expect(candidate!.notices.some((n) => n.lv.includes("vispirms Planting (HUS 7)"))).toBe(true);
    expect(candidate!.proposals[1].workload.overload).toBeGreaterThan(result.plans[0].proposals[1].workload.overload);
  });

  it("counts both overlapping sowings together, rejecting a 14-table demand", () => {
    const rows = twoHusScenario().slice(0, 2).map((row, i) => ({ ...row, sowingTables: i ? "A7–A13" : "A1–A7" }));
    const result = run(rows);
    expect(result.plan).toBeUndefined();
    expect(result.notices.some((n) => n.lv.includes("sēšanas"))).toBe(true);
    const fitting = run(twoHusScenario());
    expect(fitting.plan!.occupancy.find((day) => day.date === "2026-10-20")!.seeding.usedTables).toBe(6);
  });

  it("does not accept a C swap that collides with a third HUS later in the growing period", () => {
    const rows = twoHusScenario();
    const third: SowingPlanRow = { ...rows[0], id: "Third", sectorName: "Third", sowingDate: "2026-10-25", harvestDate: "2026-11-20",
      adjustments: { thinning: "2026-11-01" }, placement: { primaryRow: "C", tables: 26, manual: true },
      husEvents: [{ id: "third-moving", eventType: "move", eventDate: "2026-11-01", destinationLocation: "C1–C26" }] };
    const result = run([...rows, third]);
    expect(result.proposals.some((p) => p.wateringZone === "C" && p.plantingDate > "2026-11-01")).toBe(false);
    expect(result.plan?.occupancy.every((day) => !day.growing.overCapacity) ?? true).toBe(true);
  });

  it("refuses to replan a selected actual Moving, including an unchanged sowing date", () => {
    const rows = twoHusScenario();
    rows[0].husEvents = [{ id: "done", eventType: "move", eventDate: "2026-10-28", destinationLocation: "B1–B26" }];
    const result = run(rows, [{ ...changes[0], sowingDate: rows[0].sowingDate }, changes[1]]);
    expect(result.status).toBe("insufficientData");
    expect(result.plan).toBeUndefined();
    expect(result.notices[0].lv).toContain("HUS 8A");
  });

  it("reports no joint solution when all growing rows remain physically occupied", () => {
    const rows = twoHusScenario();
    for (const row of rows.slice(2)) row.harvestDate = "2026-11-20";
    const result = run(rows);
    expect(result.plan).toBeUndefined();
    expect(result.status).toBe("cannot");
    expect(result.notices.some((n) => /2026-10-/.test(n.lv))).toBe(true);
  });

  it("rejects duplicate selections and preserves deterministic results regardless of input order", () => {
    expect(run(twoHusScenario(), [changes[0], changes[0]]).status).toBe("insufficientData");
    expect(run(twoHusScenario().reverse()).proposals).toEqual(run().proposals);
  });

  it("offers single-HUS regular thinning only after jointly checking another pending HUS row change", () => {
    const rows = twoHusScenario();
    const result = simulateGreenhouseSowing(rows, plannerConfig, "HUS 8A", "2026-10-18", "2026-10-17");
    expect(result.recommendation?.cycleDay).toBeLessThanOrEqual(10);
    expect(result.recommendation?.wateringZone).toBe("C");
    expect(result.status).toBe("conditional");
    expect(result.requiredChanges?.some((n) => n.lv.includes("HUS 8B: augšanas rinda C → B"))).toBe(true);
    expect(result.occupancy.every((day) => !day.growing.overCapacity)).toBe(true);
  });

  it("prefers preserving another HUS over moving it merely to avoid approved compression", () => {
    const source = twoHusScenario();
    const target = { ...source[0], sowingDate: "2026-10-20" };
    const other = { ...source[1], requiredPlants: 900, placement: { primaryRow: "C" as const, tables: 6, manual: true } };
    const b = { ...source[3], id: "B fixed", harvestDate: "2026-11-20", husEvents: [{ ...source[3].husEvents![0], destinationLocation: "B1–B26" }] };
    const d = { ...source[4], harvestDate: "2026-11-20" };
    const result = simulateJointSowingPlan({ rows: [target, other, b, d], config: plannerConfig, asOfDate: "2026-10-17",
      sowingChanges: [{ planRowId: target.id, sowingDate: target.sowingDate }], allowOtherSowingChanges: false, prioritizeRequestedHus: true });
    expect(result.plans[0]).toBeDefined();
    expect(result.plans[0].score.otherHusChanges).toBe(0);
    expect(result.plans[0].proposals[0].physicalTables).toBeLessThan(26);
    expect(result.plans[0].proposals[0].cycleDay).toBeLessThanOrEqual(10);
  });
});

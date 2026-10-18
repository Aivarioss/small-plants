import { describe, expect, it, vi } from "vitest";
import { plannerConfig } from "./demo-data";
import { buildGreenhouseOccupancyDay, simulateSowingDateChange } from "./greenhouse-simulation";
import { simulateGreenhouseSowing, simulateTwoHusSowing } from "./greenhouse-sowing-simulator";
import { calculateMoveOutDate, deriveCycleLength } from "./hus-templates";
import { simulateJointSowingPlan, type JointSimulationRequest } from "./joint-greenhouse-simulation";
import { addDays } from "./planning";
import type { SowingPlanRow } from "./types";

function hus(id = "Target", cycleLength = 23, sowingDate = "2026-10-20"): SowingPlanRow {
  return { id, sectorName: id, sowingDate, harvestDate: calculateMoveOutDate(sowingDate, cycleLength), cycleLength,
    requiredPlants: 3600, extraPlants: 0, variety: "Synthetic", sectorType: 26, plantsPerBox: 12, correction: 0, source: "user" };
}
function joint(rows: SowingPlanRow[], sowingDate: string, options: Partial<JointSimulationRequest> = {}) {
  return simulateJointSowingPlan({ rows, config: plannerConfig, asOfDate: "2026-10-17", sowingChanges: [{ planRowId: rows[0].id, sowingDate }],
    recalculateFuturePlacements: true, allowOtherSowingChanges: false, ...options });
}
function fixedIncoming(date: string) {
  return { ...hus("Next", 23, addDays(date, -7)), placement: { primaryRow: "B" as const, tables: 24, manual: true },
    adjustments: { thinning: date }, adjustmentSources: { thinning: "manual" as const } };
}

describe("simulation uses the production plan's inclusive growing cycle", () => {
  it.each([
    [21, "2026-10-17", "2026-11-06"], [22, "2026-10-17", "2026-11-07"], [23, "2026-10-17", "2026-11-08"],
    [21, "2026-10-25", "2026-11-14"], [22, "2026-10-25", "2026-11-15"], [23, "2026-10-25", "2026-11-16"],
  ])("preserves a %i-day cycle with sowing on %s and Planting on %s", (cycle, sowing, planting) => {
    const row = hus("Target", cycle as number);
    const before = structuredClone(row);
    const result = simulateGreenhouseSowing([row], plannerConfig, row.id, sowing as string, "2026-10-17");
    expect(result.recommendation).toBeDefined();
    expect(result.newMoveOutDate).toBe(planting);
    expect(result.newMoveOutDate).toBe(calculateMoveOutDate(sowing as string, cycle as number));
    expect(deriveCycleLength(sowing as string, result.newMoveOutDate)).toBe(cycle);
    expect(result.scenarioRows[0]).toMatchObject({ sowingDate: sowing, harvestDate: planting, cycleLength: cycle });
    expect(result.occupancy.at(-1)?.date).toBe(planting);
    expect(result.occupancy.find((day) => day.date === addDays(planting as string, -1))!.growing.rows.some((entry) => entry.planRowId === row.id)).toBe(true);
    expect(result.occupancy.at(-1)!.growing.rows.some((entry) => entry.planRowId === row.id)).toBe(false);
    expect(row).toEqual(before);
  });

  it("calculates the two selected cycles independently and regenerates Planting-linked work", () => {
    const rows = [hus("First", 21), hus("Second", 22)];
    const before = structuredClone(rows);
    const result = simulateTwoHusSowing(rows, plannerConfig, [
      { planRowId: "First", sowingDate: "2026-10-18" }, { planRowId: "Second", sowingDate: "2026-10-25" },
    ], "2026-10-17");
    expect(result.proposals.map((proposal) => proposal.plantingDate)).toEqual(["2026-11-07", "2026-11-15"]);
    for (const proposal of result.proposals) {
      expect(result.plan!.workItems.find((work) => work.planRowId === proposal.planRowId && work.type === "harvest")?.date).toBe(proposal.plantingDate);
      expect(result.plan!.workItems.find((work) => work.planRowId === proposal.planRowId && work.type === "rings")?.date).toBe(addDays(proposal.plantingDate, -1));
      expect(result.plan!.workItems.find((work) => work.planRowId === proposal.planRowId && work.type === "sprayTables")?.date).toBe(proposal.plantingDate);
      expect(result.plan!.changes).toContainEqual(expect.objectContaining({ planRowId: proposal.planRowId, field: "plantingDate", after: proposal.plantingDate }));
    }
    expect(rows).toEqual(before);
  });

  it("frees the earlier Planting row for another HUS that same day with the required work order", () => {
    const target = { ...hus(), placement: { primaryRow: "B" as const, tables: 24, manual: true } };
    const rows = [target, fixedIncoming("2026-11-09")];
    const actualBefore = buildGreenhouseOccupancyDay(rows, plannerConfig, "2026-11-08");
    const result = joint(rows, "2026-10-18");
    const plan = result.plans[0];
    expect(plan).toBeDefined();
    expect(plan.proposals.find((proposal) => proposal.planRowId === target.id)?.plantingDate).toBe("2026-11-09");
    expect(plan.proposals.find((proposal) => proposal.planRowId === "Next")?.plantingBeforeThinning).toEqual([target.id]);
    expect(plan.occupancy.find((day) => day.date === "2026-11-08")!.growing.rows.map((row) => row.planRowId)).toEqual([target.id]);
    expect(plan.occupancy.find((day) => day.date === "2026-11-09")!.growing.rows.map((row) => row.planRowId)).toEqual(["Next"]);
    expect(plan.notices.some((notice) => notice.lv.includes("2026-11-09: vispirms Planting (Target)"))).toBe(true);
    expect(buildGreenhouseOccupancyDay(rows, plannerConfig, "2026-11-08")).toEqual(actualBefore);
  });

  it("reassigns an unconfirmed row but rejects a pinned conflict through the later Planting", () => {
    const target = { ...hus(), placement: { primaryRow: "B" as const, tables: 24, manual: true } };
    const rows = [target, { ...fixedIncoming("2026-11-12"), husEvents: [
      { id: "moving", eventType: "move" as const, eventDate: "2026-11-12", location: "A1–A3", destinationLocation: "B1–B24" },
    ] }];
    expect(joint(rows, target.sowingDate).plans[0]).toBeDefined(); // old Planting November 11
    const replanned = joint(rows, "2026-10-22"); // new Planting November 13
    expect(replanned.plans[0].proposals.find((p) => p.planRowId === target.id)?.wateringZone).not.toBe("B");
    expect(replanned.plans[0].proposals.some((p) => p.planRowId === "Next")).toBe(false);
    const result = joint(rows, "2026-10-22", { candidatePlacements: [
      { planRowId: target.id, thinningDate: "2026-10-31", wateringZone: "B", physicalTables: 24 },
    ] });
    expect(result.status).toBe("cannot");
    expect(result.plans).toEqual([]);
    expect(result.conflicts.some((entry) => entry.message.lv.includes("2026-11-12") && entry.message.lv.includes("B rinda"))).toBe(true);
    expect(target.harvestDate).toBe("2026-11-11");
  });

  it("extends the complete future horizon using the new Planting date before selecting related HUS", () => {
    const target = hus();
    const tail = hus("Later", 23, "2026-11-12");
    const result = joint([target, tail], "2026-10-22");
    expect(result.plans[0].proposals.find((proposal) => proposal.planRowId === target.id)?.plantingDate).toBe("2026-11-13");
    expect(result.plans[0].proposals.some((proposal) => proposal.planRowId === tail.id)).toBe(true);
    expect(result.plans[0].occupancy.at(-1)?.date).toBe("2026-12-04");
    expect(result.plans[0].occupancy.find((day) => day.date === "2026-11-12")!.seeding.rows.some((row) => row.planRowId === tail.id)).toBe(true);
  });

  it("allows a future sowing beyond the old Planting date rather than validating against the old end", () => {
    const result = joint([hus()], "2026-11-15");
    expect(result.plans[0]?.proposals[0]).toMatchObject({ sowingDate: "2026-11-15", plantingDate: "2026-12-07" });
  });

  it("does not recalculate unchanged sowing when only rows and thinning are reassigned", () => {
    const rows = [hus("First"), hus("Second")].map((row) => ({ ...row, harvestDate: "2026-11-15",
      placement: { primaryRow: "B" as const, tables: 24, manual: false } }));
    const result = joint(rows, rows[0].sowingDate);
    expect(result.plans[0]).toBeDefined();
    expect(result.plans[0].proposals.map((proposal) => proposal.plantingDate)).toEqual(["2026-11-15", "2026-11-15"]);
    expect(new Set(result.plans[0].proposals.map((proposal) => proposal.wateringZone)).size).toBe(2);
    expect(result.plans[0].changes.some((change) => change.field === "plantingDate")).toBe(false);
  });

  it("does not infer a manual Planting lock from an existing date or a change-history entry", () => {
    const row = { ...hus(), harvestDate: "2026-11-15", changeHistory: [
      { id: "history", timestamp: "2026-10-01", field: "harvestDate", from: "2026-11-11", to: "2026-11-15", note: "Manual edit" },
    ] };
    expect(joint([row], "2026-10-18").plans[0]?.proposals[0].plantingDate).toBe("2026-11-09");
    const locked = joint([row], "2026-10-18", { lockedPlanRowIds: [row.id] });
    expect(locked.status).toBe("insufficientData");
    expect(locked.conflicts[0].code).toBe("immutableWork");
    expect(locked.conflicts[0].message.en).toContain("Planting");
    expect(row.harvestDate).toBe("2026-11-15");
  });

  it.each(["actual", "done", "archived", "completed"])("preserves %s HUS dates and events", (kind) => {
    const row = hus();
    if (kind === "actual") row.husEvents = [{ id: "move", eventType: "move", eventDate: "2026-10-28", destinationLocation: "B1–B24" }];
    if (kind === "done") row.status = "done";
    if (kind === "archived") row.archivedAt = "2026-10-16";
    const before = structuredClone(row);
    const result = joint([row], "2026-10-22", { asOfDate: "2026-10-20",
      ...(kind === "completed" ? { completedWork: [{ planRowId: row.id, type: "sowing" as const, date: row.sowingDate }] } : {}) });
    expect(result.plans).toEqual([]);
    expect(result.status).toBe("insufficientData");
    expect(row).toEqual(before);
  });

  it.each([Number.NaN, 0, -1, 22.5])("rejects an invalid cycle %s instead of inventing a Planting date", (cycle) => {
    const row = { ...hus(), cycleLength: cycle };
    const result = joint([row], "2026-10-18");
    expect(result.status).toBe("insufficientData");
    expect(result.search.nodes).toBe(0);
    expect(result.conflicts[0].message.en).toContain("growing cycle");
  });

  it("uses the same production function in the older simulation entry point without writes", () => {
    const row = hus();
    const write = vi.fn(() => { throw new Error("No persistence in simulation"); });
    vi.stubGlobal("fetch", write);
    vi.stubGlobal("localStorage", { setItem: write, removeItem: write, clear: write });
    try {
      const result = simulateSowingDateChange([row], plannerConfig, row.id, "2026-10-18");
      expect(result.newMoveOutDate).toBe("2026-11-09");
      expect(result.scenarioRows[0].cycleLength).toBe(23);
      expect(write).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
});

import { describe, expect, it, vi } from "vitest";
import { twoHusScenario } from "./__fixtures__/two-hus-scenario";
import { plannerConfig } from "./demo-data";
import { buildFuturePlacementScenario, buildGreenhouseOccupancyDay } from "./greenhouse-simulation";
import { simulateGreenhouseSowing, simulateTwoHusSowing } from "./greenhouse-sowing-simulator";
import { simulateJointSowingPlan } from "./joint-greenhouse-simulation";
import { addDays, generateWorkItemsForRows } from "./planning";
import type { SowingPlanRow } from "./types";

const changes = [{ planRowId: "HUS 8A", sowingDate: "2026-10-17" }, { planRowId: "HUS 8B", sowingDate: "2026-10-20" }];
// Controlled counts/provenance, not a production Supabase export.
function scenario() {
  const rows = twoHusScenario();
  rows[0] = { ...rows[0], requiredPlants: 3600, adjustments: { thinning: "2026-10-29" }, placement: { primaryRow: "B", tables: 24, manual: false } };
  rows[1] = { ...rows[1], sowingDate: "2026-10-22", adjustments: { thinning: "2026-10-31" } };
  return rows;
}
function later(rows: SowingPlanRow[], manual: boolean | undefined = false): SowingPlanRow {
  return { ...rows[1], id: "Later", sectorName: "HUS Next", sowingDate: "2026-10-27", harvestDate: "2026-11-20",
    adjustments: { thinning: "2026-11-05" }, adjustmentSources: { thinning: "manual" }, placement: { primaryRow: "C", tables: 26, manual } };
}
const run = (rows = scenario()) => simulateTwoHusSowing(rows, plannerConfig, changes, "2026-10-17");
const joint = (rows = scenario(), extra = {}) => simulateJointSowingPlan({ rows, config: plannerConfig, asOfDate: "2026-10-17", sowingChanges: changes,
  recalculateFuturePlacements: true, prioritizeRequestedHus: true, allowOtherSowingChanges: false, ...extra });

describe("house allocation before joint search", () => {
  it("reuses the house allocation and certifies 8A October 26/C24 and 8B October 29/B26", () => {
    const rows = scenario();
    const before = structuredClone(rows);
    const snapshot = buildGreenhouseOccupancyDay(rows, plannerConfig, "2026-11-05");
    const result = run(rows);
    expect(result.status).toBe("can");
    expect(result.proposals.map((p) => [p.thinningDate, p.wateringZone, p.physicalTables])).toEqual([
      ["2026-10-26", "C", 24], ["2026-10-29", "B", 26],
    ]);
    expect(result.proposals.map((p) => p.plantingDate)).toEqual(["2026-11-11", "2026-11-13"]);
    expect(result.plan!.occupancy.find((d) => d.date === "2026-10-20")!.seeding.usedTables).toBe(6);
    expect(result.plan!.occupancy.find((d) => d.date === "2026-11-05")!.growing.usedTables).toBe(52);
    expect(result.proposals[0].physicalTables).toBe(24); // C still reserves 26.
    expect(result.plan!.occupancy.every((d) => !d.growing.overCapacity && !d.seeding.overCapacity && !d.seeding.conflicts.length)).toBe(true);
    expect(rows).toEqual(before);
    expect(buildGreenhouseOccupancyDay(rows, plannerConfig, "2026-11-05")).toEqual(snapshot);
  });

  it("performs one-HUS input through the same house/joint validation and names the other changes", () => {
    const rows = scenario();
    rows[1].sowingDate = "2026-10-20";
    rows[1].adjustments = { thinning: "2026-10-29" };
    const result = simulateGreenhouseSowing(rows, plannerConfig, rows[0].id, "2026-10-17", "2026-10-17");
    expect(result.status).toBe("conditional");
    expect(result.recommendation).toMatchObject({ wateringZone: "C", thinningDate: "2026-10-26" });
    expect(result.requiredChanges?.some((n) => n.lv === "HUS 8B: augšanas rinda C → B.")).toBe(true);
    expect(result.scenarioRows[1].sowingDate).toBe(rows[1].sowingDate);
    expect(result.scenarioRows[1].placement?.primaryRow).toBe("B");
  });

  it("reassigns a later automatic reservation as well, through that HUS's Planting", () => {
    const rows = scenario();
    rows.push(later(rows));
    const result = run(rows);
    expect(result.status).toBe("conditional");
    expect(result.proposals.map((p) => p.wateringZone)).toEqual(["C", "B"]);
    expect(result.plan!.proposals.find((p) => p.planRowId === "Later")).toMatchObject({ wateringZone: "D", thinningDate: "2026-11-05", plantingDate: "2026-11-20" });
    expect(result.requiredChanges.some((n) => n.lv === "HUS Next: augšanas rinda C → D.")).toBe(true);
    expect(result.plan!.occupancy.at(-1)?.date).toBe("2026-11-20");
    expect(result.plan!.occupancy.every((d) => !d.growing.overCapacity)).toBe(true);
  });

  it("rejects the swap when a later actual C Moving and fixed D reservation leave no space", () => {
    const rows = scenario();
    rows[4].harvestDate = "2026-11-20";
    rows.push({ ...later(rows), sowingTables: "A7–A9", husEvents: [{ id: "done", eventType: "move", eventDate: "2026-11-05", location: "A7–A9", destinationLocation: "C1–C26" }] });
    const result = run(rows);
    expect(result.status).toBe("cannot");
    expect(result.plan).toBeUndefined();
    expect(result.notices.some((n) => n.lv.includes("2026-11-05") && n.lv.includes("HUS Next"))).toBe(true);
    expect(rows[5].husEvents![0].destinationLocation).toBe("C1–C26");
  });

  it.each([true, undefined])("preserves later manual or unknown-origin rows (manual=%s)", (manual) => {
    const rows = scenario();
    rows[4].harvestDate = "2026-11-20";
    rows.push(later(rows, manual));
    expect(run(rows).plan).toBeUndefined();
    expect(rows[5].placement).toMatchObject({ primaryRow: "C", tables: 26 });
  });

  it("does not silently replace a manual thinning date that conflicts with changed sowing", () => {
    const rows = scenario();
    rows[0].adjustmentSources = { thinning: "manual" };
    const result = run(rows);
    expect(result.status).toBe("insufficientData");
    expect(result.notices[0].lv).toContain("HUS 8A");
    expect(result.notices[0].en).toContain("manual or unknown-origin thinning date");
    expect(rows[0].adjustments!.thinning).toBe("2026-10-29");
  });

  it("keeps valid manual dates and row/count choices while moving automatic neighbours", () => {
    const rows = scenario();
    rows[0].placement = { primaryRow: "C", tables: 24, manual: true };
    rows[0].adjustments = { thinning: "2026-10-26" };
    rows[0].adjustmentSources = { thinning: "manual" };
    const result = run(rows);
    expect(result.proposals[0]).toMatchObject({ wateringZone: "C", physicalTables: 24, thinningDate: "2026-10-26" });
  });

  it("does not guess that an unknown-origin target row is automatic", () => {
    const rows = scenario();
    rows[0].placement = { primaryRow: "B", tables: 24 };
    const result = simulateTwoHusSowing(rows, plannerConfig, [{ ...changes[0], sowingDate: "2026-10-18" }, changes[1]], "2026-10-17");
    expect(result.proposals[0]).toMatchObject({ wateringZone: "B", cycleDay: 11 });
    expect(result.status).toBe("conditional");
  });

  it("never squeezes a locked 24-table placement into the 13-table A block", () => {
    const rows = scenario();
    rows[0].placement = { primaryRow: "A", tables: 24, manual: true };
    const result = run(rows);
    expect(result.plan).toBeUndefined();
    expect(result.notices.some((n) => n.lv.includes("A14–A26") && n.lv.includes("pieejami 13"))).toBe(true);
  });

  it("requires clarification for an actual Moving without a known growing destination", () => {
    const rows = scenario();
    rows[4].husEvents = [{ id: "unknown", eventType: "move", eventDate: "2026-10-15" }];
    rows[4].placement = undefined;
    const result = run(rows);
    expect(result.plan).toBeUndefined();
    expect(["insufficientData", "searchLimited"]).toContain(result.status);
    expect(result.notices.some((n) => n.lv.includes("HUS 9"))).toBe(true);
  });

  it("keeps already valid automatic thinning dates in the first pass", () => {
    const rows = scenario().map((row) => row.id === "HUS 8A" ? { ...row, sowingDate: "2026-10-18", adjustments: { thinning: "2026-10-26" } } : row);
    const work = generateWorkItemsForRows(rows, plannerConfig);
    const thin = new Map(work.filter((w) => w.type === "thinning").map((w) => [w.planRowId, w.date]));
    const result = buildFuturePlacementScenario(rows, plannerConfig, new Set([rows[0].id, rows[1].id]), thin, "2026-10-17");
    expect(result.placements.find((p) => p.planRowId === rows[0].id)?.startDate).toBe("2026-10-26");
    expect(result.rows[1].adjustments!.thinning).toBe("2026-10-31");
  });

  it("extends the horizon across later cycles instead of stopping at the requested Planting", () => {
    const rows = scenario();
    rows.push({ ...later(rows), harvestDate: "2026-11-30" });
    rows.push({ ...rows[1], id: "Tail", sectorName: "Tail", sowingDate: "2026-11-15", harvestDate: "2026-12-07", adjustments: { thinning: "2026-11-24" } });
    const result = run(rows);
    expect(result.plan!.proposals.some((p) => p.planRowId === "Tail")).toBe(true);
    expect(result.plan!.occupancy.at(-1)?.date).toBe("2026-12-07");
    expect(result.plan!.occupancy.every((d) => !d.growing.overCapacity)).toBe(true);
  });

  it("runs the deterministic first pass for every future HUS, including more than the search's eight-row subset", () => {
    const rows = scenario();
    for (let i = 0; i < 8; i++) {
      const sowingDate = addDays("2026-10-30", i * 7);
      rows.push({ ...rows[0], id: "Future " + i, sectorName: "Future " + i, sowingDate, harvestDate: addDays(sowingDate, 22),
        adjustments: { thinning: addDays(sowingDate, 9) }, placement: { primaryRow: "B", tables: 24, manual: false } });
    }
    const result = run(rows);
    expect(result.plan).toBeDefined();
    expect(result.plan!.proposals).toHaveLength(10);
    expect(result.plan!.occupancy.at(-1)?.date).toBe("2027-01-09");
    expect(result.plan!.occupancy.every((d) => !d.growing.overCapacity && !d.seeding.overCapacity)).toBe(true);
  });

  it("does not replan completed, archived or possibly completed past work", () => {
    for (const patch of [{ status: "done" as const }, { archivedAt: "2026-10-16" }, { sowingDate: "2026-10-01", adjustments: { thinning: "2026-10-10" } }]) {
      const rows = scenario();
      Object.assign(rows[0], patch);
      expect(run(rows).plan).toBeUndefined();
    }
    expect(joint(scenario(), { completedWork: [{ planRowId: "HUS 8A", type: "thinning", date: "2026-10-16" }] }).plans).toEqual([]);
  });

  it("does not silently repair a past planned date into a future job with unknown execution status", () => {
    const rows = scenario();
    rows.push({ ...later(rows), adjustments: { thinning: "2026-10-15" }, adjustmentSources: { thinning: "optimizer" } });
    const result = run(rows);
    expect(result.plan).toBeUndefined();
    expect(result.status).toBe("insufficientData");
    expect(result.notices[0].lv).toContain("HUS Next");
    expect(rows[5].adjustments!.thinning).toBe("2026-10-15");
    expect(rows[5].husEvents).toBeUndefined();
  });

  it("rejects fixed seeding-table collisions even when counts alone would fit", () => {
    const rows = scenario();
    rows[0].sowingTables = "A1–A3";
    rows[1].sowingTables = "A3–A5";
    const result = run(rows);
    expect(result.plan).toBeUndefined();
    expect(result.notices.some((n) => n.lv.includes("A3 sēšanas galda konflikts"))).toBe(true);
    expect(new Set(result.notices.map((n) => n.lv)).size).toBe(result.notices.length);
  });

  it("uses bounded fallback without claiming physical impossibility", () => {
    const result = joint(scenario(), { limits: { maxNodes: 1 } });
    expect(result.status).toBe("searchLimited");
    expect(result.plans).toEqual([]);
  });

  it("is pure, including with frozen inputs and forbidden network/storage writes", () => {
    const rows = scenario();
    for (const row of rows) {
      if (row.placement) Object.freeze(row.placement);
      if (row.adjustments) Object.freeze(row.adjustments);
      row.husEvents?.forEach(Object.freeze);
      if (row.husEvents) Object.freeze(row.husEvents);
      Object.freeze(row);
    }
    Object.freeze(rows);
    const write = vi.fn(() => { throw new Error("Persistence forbidden"); });
    vi.stubGlobal("fetch", write);
    vi.stubGlobal("localStorage", { setItem: write, clear: write, removeItem: write });
    try {
      expect(run(rows).originalRowsUnchanged).toBe(true);
      expect(write).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
});

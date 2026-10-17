import { describe, expect, it, vi } from "vitest";
import { plannerConfig } from "./demo-data";
import { addDays, generateWorkItemsForRows } from "./planning";
import { buildGreenhouseOccupancyDay, greenhouseSimulationModel } from "./greenhouse-simulation";
import { simulateJointSowingPlan, type JointSimulationRequest, type JointSimulationPlan } from "./joint-greenhouse-simulation";
import type { SowingPlanRow } from "./types";

function hus(id: string, sowingDate = "2026-10-20", requiredPlants = 3656): SowingPlanRow {
  return { id, sectorName: id, sowingDate, harvestDate: addDays(sowingDate, 22), cycleLength: 23,
    requiredPlants, extraPlants: 0, variety: "Synthetic", sectorType: 26, plantsPerBox: 12, correction: 0,
    adjustments: { thinning: addDays(sowingDate, 8) }, source: "user" };
}
function actual(id: string, destination: string, plants = 3900, end = "2026-11-20"): SowingPlanRow {
  // Explicit whole source tables confirm full release; a destination alone
  // cannot establish that seeding tables have been completely cleared.
  return { ...hus(id, "2026-09-25", plants), harvestDate: end, sowingTables: "A1–A6",
    husEvents: [{ id: id + "-moving", eventType: "move", eventDate: "2026-10-03", location: "A1–A6", destinationLocation: destination }] };
}
function run(rows: SowingPlanRow[], extra: Partial<JointSimulationRequest> = {}) {
  return simulateJointSowingPlan({ rows, config: plannerConfig, asOfDate: "2026-10-16",
    sowingChanges: [{ planRowId: rows[0].id, sowingDate: rows[0].sowingDate }], ...extra });
}
function expectPhysicalPlan(plan: JointSimulationPlan) {
  for (const day of plan.occupancy) {
    expect(day.seeding.usedTables, day.date).toBeLessThanOrEqual(13);
    expect(day.seeding.conflicts, day.date).toEqual([]);
    expect(day.growing.physicalUsedTables, day.date).toBeLessThanOrEqual(91);
    expect(day.growing.overCapacity, day.date).toBe(false);
  }
  expect(plan.proposals.every((entry) => entry.plantsPerTrough <= 35)).toBe(true);
}

describe("joint HUS simulation", () => {
  it("plans the synthetic October scenario together while preserving all Planting dates", () => {
    // Synthetic, not a production export. HUS 9 Planting = Nov 4, its D26
    // reservation starts Oct 21 and is locked. New HUS counts are 3656/3656/900.
    // HUS 6/7 actual placements follow the user's C24 and B26+A13 example.
    const a = hus("HUS 8A");
    const b = hus("HUS 8B", "2026-10-22");
    const c = hus("HUS 3", "2026-10-23", 900);
    const nine = { ...hus("HUS 9", "2026-10-13"), harvestDate: "2026-11-04", sowingTables: "A3, A4, A8",
      placement: { primaryRow: "D" as const, tables: 26, manual: true }, adjustments: { thinning: "2026-10-21" } };
    const rows = [a, b, c, actual("HUS 6", "C1–C24", 3600, "2026-10-21"),
      actual("HUS 7", "B1–B26\nA14–A26", 5850, "2026-10-28"), nine];
    const before = structuredClone(rows);
    const result = run(rows, { lockedPlanRowIds: [nine.id], sowingChanges: [
      { planRowId: a.id, sowingDate: "2026-10-17" }, { planRowId: b.id, sowingDate: "2026-10-19" },
      { planRowId: c.id, sowingDate: "2026-10-20" },
    ] });
    expect(result.plans.length).toBeGreaterThan(0);
    expect(result.plans.length).toBeLessThanOrEqual(3);
    for (const plan of result.plans) {
      expectPhysicalPlan(plan);
      expect(plan.proposals.map((entry) => entry.planRowId).sort()).toEqual([a.id, b.id, c.id].sort());
      for (const proposal of plan.proposals) expect(proposal.plantingDate).toBe(rows.find((row) => row.id === proposal.planRowId)!.harvestDate);
      expect(plan.workItems.find((item) => item.planRowId === nine.id && item.type === "thinning")?.date).toBe("2026-10-21");
    }
    expect(rows).toEqual(before);
    expect(result.originalRowsUnchanged).toBe(true);
  });

  it("does not combine two individually feasible proposals onto the same growing row", () => {
    const rows = [hus("First"), hus("Second")];
    const result = run(rows, { sowingChanges: rows.map((row) => ({ planRowId: row.id, sowingDate: row.sowingDate })) });
    const plan = result.plans[0];
    expect(plan).toBeDefined();
    expect(new Set(plan.proposals.map((proposal) => proposal.wateringZone)).size).toBe(2);
    expect(plan.score.changedThinningDates).toBe(0);
    expect(plan.proposals.every((proposal) => proposal.thinningDate === "2026-10-28")).toBe(true);
    expectPhysicalPlan(plan);
  });

  it("releases a row on Planting day with explicit Planting-before-thinning order", () => {
    const target = { ...hus("Target"), adjustments: { thinning: "2026-10-27" } };
    const result = run([target, actual("B previous", "B1–B26", 3900, "2026-10-27"),
      actual("C", "C1–C26"), actual("D", "D1–D26"), actual("A", "A14–A26", 1950)]);
    const best = result.plans[0];
    expect(best.proposals[0]).toMatchObject({ thinningDate: "2026-10-27", wateringZone: "B", plantingBeforeThinning: ["B previous"] });
    expect(best.status).toBe("conditional");
    expect(best.notices.some((notice) => notice.lv.includes("vispirms Planting"))).toBe(true);
    expect(best.occupancy.find((day) => day.date === "2026-10-26")!.growing.rows.some((row) => row.planRowId === "B previous")).toBe(true);
    expect(best.occupancy.find((day) => day.date === "2026-10-27")!.growing.rows.some((row) => row.planRowId === "B previous")).toBe(false);
    expectPhysicalPlan(best);
  });

  it("moves another pending HUS's thinning earlier to release seeding capacity", () => {
    // The fixed A1-A11 reservation intentionally occupies eleven tables even
    // though its small plant count would need fewer: known reservations prevail.
    const target = hus("Target", "2026-10-23");
    const other = { ...hus("Other", "2026-10-13", 900), sowingTables: "A1–A11",
      adjustments: { thinning: "2026-10-22" }, placement: { primaryRow: "D" as const, tables: 6, manual: true } };
    const result = run([target, other], { sowingChanges: [{ planRowId: target.id, sowingDate: "2026-10-21" }] });
    const best = result.plans[0];
    expect(best).toBeDefined();
    expect(best.proposals.find((proposal) => proposal.planRowId === other.id)?.thinningDate).toBe("2026-10-20");
    expect(best.changes).toContainEqual(expect.objectContaining({ planRowId: other.id, field: "thinningDate", before: "2026-10-22", after: "2026-10-20" }));
    expect(best.occupancy.find((day) => day.date === "2026-10-20")!.seeding.usedTables).toBe(11);
    expect(best.occupancy.find((day) => day.date === "2026-10-21")!.seeding.rows.map((row) => row.planRowId)).toEqual([target.id]);
    expect(other.adjustments.thinning).toBe("2026-10-22");
    expectPhysicalPlan(best);
  });

  it("offers compression and shared watering only as an approved conditional compromise", () => {
    const target = hus("Target", "2026-10-20", 1200);
    const result = run([target, actual("B", "B1–B26"), actual("C", "C1–C20", 3000),
      actual("D", "D1–D26"), actual("A", "A14–A26", 1950)]);
    const best = result.plans[0];
    expect(best).toBeDefined();
    expect(best.status).toBe("conditional");
    expect(best.proposals[0]).toMatchObject({ wateringZone: "C", placementKind: "sharedRow", physicalTables: 6 });
    expect(best.proposals[0].physicalTables).toBeLessThan(best.proposals[0].normalTables);
    expect(best.proposals[0].sharedWith).toEqual(["C"]);
    expect(best.changes.some((change) => change.field === "growingTables" && change.requiresApproval)).toBe(true);
    expectPhysicalPlan(best);
  });

  it("marks both new HUS as sharing when they jointly use 22 + 4 tables", () => {
    const a = { ...hus("First", "2026-10-20", 3300), placement: { primaryRow: "C" as const, tables: 22, manual: true } };
    const b = { ...hus("Second", "2026-10-20", 600), placement: { primaryRow: "C" as const, tables: 4, manual: true } };
    const result = run([a, b, actual("B", "B1–B26"), actual("D", "D1–D26"), actual("A", "A14–A26", 1950)], {
      sowingChanges: [{ planRowId: a.id, sowingDate: a.sowingDate }, { planRowId: b.id, sowingDate: b.sowingDate }],
    });
    const best = result.plans[0];
    expect(best).toBeDefined();
    expect(best.status).toBe("conditional");
    expect(best.proposals.every((proposal) => proposal.placementKind === "sharedRow" && proposal.sharedWith.length === 1)).toBe(true);
    expect(best.proposals.map((proposal) => proposal.physicalTables)).toEqual([22, 4]);
    expectPhysicalPlan(best);
  });

  it("prefers the least compression needed instead of jumping to exceptional density", () => {
    const result = run([hus("Target"), actual("B", "B1–B26"), actual("C", "C1–C4", 600),
      actual("D", "D1–D26"), actual("A", "A14–A26", 1950)]);
    expect(result.plans[0].proposals[0]).toMatchObject({ wateringZone: "C", physicalTables: 22, densityClass: "slightlyCompressed" });
    expectPhysicalPlan(result.plans[0]);
  });

  it("uses day 11 only after the regular windows fail", () => {
    const result = run([hus("Target"), actual("B previous", "B1–B26", 3900, "2026-10-30"),
      actual("C", "C1–C26"), actual("D", "D1–D26"), actual("A", "A14–A26", 1950)]);
    expect(result.plans[0].proposals[0].cycleDay).toBe(11);
    expect(result.search.stages).toEqual(["normal", "compromise", "emergency"]);
    expect(result.plans[0].status).toBe("conditional");
    expect(result.plans[0].notices.some((notice) => notice.en.includes("day-11"))).toBe(true);
    expectPhysicalPlan(result.plans[0]);
  });

  it("proposes another future sowing shift only as a last resort requiring approval", () => {
    const target = hus("Target");
    const other = { ...hus("Other", "2026-10-25", 900), sowingTables: "A1–A11" };
    const result = run([target, other]);
    expect(result.plans[0]).toBeDefined();
    expect(result.search.stages).toContain("sowingCompromise");
    const change = result.plans[0].changes.find((entry) => entry.field === "sowingDate" && entry.planRowId === other.id);
    expect(change).toMatchObject({ before: "2026-10-25", after: "2026-10-28", requiresApproval: true });
    expect(change?.reason.en).toContain("user approval");
    expect(result.plans[0].status).toBe("conditional");
    expect(result.plans[0].proposals.find((proposal) => proposal.planRowId === other.id)?.plantingDate).toBe(other.harvestDate);
    expect(result.plans[0].changes.some((entry) => entry.field === "workDates")).toBe(true);
    expect(other.sowingDate).toBe("2026-10-25");
    expectPhysicalPlan(result.plans[0]);
  });

  it("rejects a physically impossible horizon with a dated capacity conflict", () => {
    const result = run([hus("Target"), actual("B", "B1–B26"), actual("C", "C1–C26"),
      actual("D", "D1–D26"), actual("A", "A14–A26", 1950)]);
    expect(result.status).toBe("cannot");
    expect(result.plans).toEqual([]);
    expect(result.conflicts.some((entry) => entry.code === "growingCapacity" && /^2026-10-/.test(entry.date))).toBe(true);
    expect(result.conflicts.some((entry) => entry.message.lv.includes("91 galdu kapacitāte"))).toBe(true);
  });

  it("can disable other sowing changes while retaining the joint engine's thinning search", () => {
    const target = hus("Target");
    const other = { ...hus("Other", "2026-10-25", 900), sowingTables: "A1–A11" };
    const result = run([target, other], { allowOtherSowingChanges: false });
    expect(result.search.stages).toEqual(["normal", "compromise", "emergency"]);
    expect(result.search.sowingScenarios).toBe(0);
    expect(result.plans).toEqual([]);
    expect(other.sowingDate).toBe("2026-10-25");
  });

  it("preserves Moving, completed work, photos, notes and baseline capacity", () => {
    const target = hus("Target");
    const fixed = { ...hus("Completed", "2026-10-07", 600), placement: { primaryRow: "C" as const, tables: 4, manual: true },
      adjustments: { thinning: "2026-10-15" }, husNotes: [{ id: "note", sowingPlanRowId: "Completed", note: "Keep" }],
      husPhotos: [{ id: "photo", sowingPlanRowId: "Completed", storageBucket: "synthetic-private", storagePath: "fixture.jpg",
        originalFileName: "fixture.jpg", contentType: "image/jpeg" as const, fileSizeBytes: 100 }] };
    const moved = actual("Actual", "B1–B26");
    const rows = [target, fixed, moved];
    const before = structuredClone(rows);
    const capacity = buildGreenhouseOccupancyDay(rows, plannerConfig, "2026-10-20");
    const baselineWork = generateWorkItemsForRows(rows, plannerConfig);
    const result = run(rows, { completedWork: [{ planRowId: fixed.id, type: "thinning", date: "2026-10-15" }] });
    expect(result.plans[0]).toBeDefined();
    for (const plan of result.plans) {
      expect(plan.proposals.some((proposal) => [fixed.id, moved.id].includes(proposal.planRowId))).toBe(false);
      expect(plan.workItems.find((item) => item.planRowId === fixed.id && item.type === "thinning")?.date).toBe("2026-10-15");
      for (const item of baselineWork.filter((item) => item.planRowId === fixed.id && item.type !== "thinning")) {
        expect(plan.workItems.find((entry) => entry.id === item.id)?.date).toBe(item.date);
      }
      expectPhysicalPlan(plan);
    }
    expect(rows).toEqual(before);
    expect(buildGreenhouseOccupancyDay(rows, plannerConfig, "2026-10-20")).toEqual(capacity);
  });

  it("does not move sowing for an already started HUS", () => {
    const row = actual("Actual", "C1–C24");
    const result = run([row], { sowingChanges: [{ planRowId: row.id, sowingDate: "2026-10-17" }] });
    expect(result.status).toBe("insufficientData");
    expect(result.conflicts[0].code).toBe("immutableWork");
    expect(result.plans).toEqual([]);
  });

  it("retains fixed A reservations instead of allocating the same table twice", () => {
    const a = { ...hus("First"), sowingTables: "A1–A3" };
    const b = { ...hus("Second", "2026-10-19", 900), sowingTables: "A3" };
    const result = run([a, b]);
    expect(result.plans).toEqual([]);
    expect(result.conflicts.some((entry) => entry.code === "seedingCapacity" && entry.message.lv.includes("A3"))).toBe(true);
  });

  it("checks later reservations throughout growing, rather than only on thinning day", () => {
    const target = hus("Target");
    const future = { ...hus("Future", "2026-10-24"), placement: { primaryRow: "B" as const, tables: 26, manual: true },
      adjustments: { thinning: "2026-10-31" } };
    const result = run([target, future], { lockedPlanRowIds: [future.id] });
    expect(result.plans[0]).toBeDefined();
    for (const plan of result.plans) {
      expect(plan.proposals[0].wateringZone).not.toBe("B");
      expectPhysicalPlan(plan);
    }
  });

  it("includes future reservations beyond the requested HUS's Planting for other replanned HUS", () => {
    const target = { ...hus("Target"), placement: { primaryRow: "B" as const, tables: 24, manual: true } };
    const other = { ...hus("Related", "2026-11-02"), placement: { primaryRow: "C" as const, tables: 24, manual: true } };
    const future = { ...hus("Later", "2026-11-12"), placement: { primaryRow: "C" as const, tables: 26, manual: true },
      adjustments: { thinning: "2026-11-19" } };
    const result = run([target, other, future], { lockedPlanRowIds: [future.id] });
    expect(result.plans[0]).toBeDefined();
    for (const plan of result.plans) {
      expect(plan.proposals.find((entry) => entry.planRowId === other.id)?.wateringZone).not.toBe("C");
      expect(plan.occupancy.at(-1)?.date).toBe(other.harvestDate);
      expectPhysicalPlan(plan);
    }
  });

  it("preserves manual future work and reports incompatible sowing windows", () => {
    const row = { ...hus("Target"), adjustments: { thinning: "2026-10-28", sideShoots: "2026-11-05" } };
    const result = run([row], { sowingChanges: [{ planRowId: row.id, sowingDate: "2026-10-23" }] });
    expect(result.status).toBe("insufficientData");
    expect(result.conflicts[0].code).toBe("immutableWork");
    expect(result.plans).toEqual([]);
    expect(row.adjustments.sideShoots).toBe("2026-11-05");
  });

  it("does not turn a missing plant count into a verified capacity", () => {
    const row = { ...hus("Target"), requiredPlants: Number.NaN };
    const result = run([row]);
    expect(result.status).toBe("insufficientData");
    expect(result.conflicts[0].code).toBe("missingData");
    expect(result.plans).toEqual([]);
  });

  it("accepts frozen inputs without changing arrays, adjustments or event history", () => {
    const rows = [hus("Target"), actual("Actual", "C1–C24")];
    for (const row of rows) {
      if (row.adjustments) Object.freeze(row.adjustments);
      row.husEvents?.forEach(Object.freeze);
      if (row.husEvents) Object.freeze(row.husEvents);
      Object.freeze(row);
    }
    Object.freeze(rows);
    expect(run(rows).originalRowsUnchanged).toBe(true);
  });

  it("does not call network or localStorage persistence", () => {
    const write = vi.fn(() => { throw new Error("Persistence is forbidden in simulation"); });
    vi.stubGlobal("fetch", write);
    vi.stubGlobal("localStorage", { setItem: write, removeItem: write, clear: write });
    try {
      expect(run([hus("Target")]).plans.length).toBeGreaterThan(0);
      expect(write).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });

  it("keeps a feasible existing schedule ahead of unnecessary thinning changes", () => {
    const row = { ...hus("Target"), adjustments: { thinning: "2026-10-29" } };
    const result = run([row]);
    expect(result.plans[0].proposals[0].thinningDate).toBe("2026-10-29");
    expect(result.plans[0].score.changedThinningDates).toBe(0);
    expect(result.plans.every((plan) => !plan.changes.some((change) => change.field === "sowingDate"))).toBe(true);
  });

  it("verifies known actual locations even when the old planned location differs", () => {
    const fixed = { ...actual("Actual", "C1–C24", 3600), placement: { primaryRow: "D" as const, tables: 26, manual: true } };
    const result = run([hus("Target"), fixed]);
    expect(result.status).toBe("can");
    expect(result.plans[0].proposals[0].wateringZone).not.toBe("C");
    expect(result.plans[0].notices).toEqual([]);
  });

  it("does not let an irrelevant old plant count obscure known actual growing tables", () => {
    const fixed = { ...actual("Actual", "C1–C24", 3600), requiredPlants: Number.NaN };
    const result = run([hus("Target"), fixed]);
    expect(result.status).toBe("can");
    expect(result.plans[0].proposals[0].wateringZone).not.toBe("C");
    expectPhysicalPlan(result.plans[0]);
  });

  it("does not claim a verified actual location for a Moving record without a destination", () => {
    const fixed = { ...hus("Unlocated", "2026-10-07", 600), placement: { primaryRow: "C" as const, tables: 4, manual: true },
      husEvents: [{ id: "actual", eventType: "move" as const, eventDate: "2026-10-15" }] };
    const result = run([hus("Target"), fixed]);
    expect(result.status).toBe("conditional");
    expect(result.plans[0].notices.some((entry) => entry.en.includes("Unlocated growing placement is not fully known"))).toBe(true);
  });

  it("reports an empty biological window instead of returning an unexplained rejection", () => {
    const row = { ...hus("Target"), harvestDate: "2026-10-26", cycleLength: 7 };
    const result = run([row]);
    expect(result.plans).toEqual([]);
    expect(result.conflicts.some((entry) => entry.code === "workWindow" && entry.date === row.harvestDate)).toBe(true);
  });

  it("reports a search limit rather than falsely proving impossibility", () => {
    const rows = [hus("First"), hus("Second")];
    const extra = { sowingChanges: rows.map((row) => ({ planRowId: row.id, sowingDate: row.sowingDate })), limits: { maxNodes: 1 } };
    const result = run(rows, extra);
    expect(result.status).toBe("searchLimited");
    expect(result.search.nodes).toBeLessThanOrEqual(1);
    expect(result.search.truncated).toBe(true);
    expect(run(rows, extra)).toEqual(result);
  });

  it("bounds the internal fixed-table allocation search as well as joint candidates", () => {
    const row = { ...hus("Target"), sowingTables: "A1" };
    const budget = { step: () => false, exhausted: false };
    const result = greenhouseSimulationModel.checkSeedingCapacity(row, [], [], "2026-10-28", 3, row.sowingDate, budget);
    expect(result.searchLimited).toBe(true);
    expect(budget.exhausted).toBe(true);
    expect(result.notices[0].en).toContain("search limit");
  });

  it("does not silently drop requested HUS when the mutable-row limit is too small", () => {
    const rows = [hus("First"), hus("Second")];
    const result = run(rows, { sowingChanges: rows.map((row) => ({ planRowId: row.id, sowingDate: row.sowingDate })), limits: { maxMutableRows: 1 } });
    expect(result.status).toBe("searchLimited");
    expect(result.plans).toEqual([]);
  });

  it("returns at most three materially distinct deterministic plans without row permutations", () => {
    const rows = [hus("First"), hus("Second")];
    const result = run(rows);
    expect(result.plans.length).toBeLessThanOrEqual(3);
    expect(result.plans.length).toBeGreaterThan(0);
    const signature = (plan: JointSimulationPlan) => JSON.stringify(plan.proposals.map((entry) => [entry.planRowId, entry.thinningDate, entry.placementKind, entry.densityClass]));
    expect(new Set(result.plans.map(signature)).size).toBe(result.plans.length);
    expect(run(rows)).toEqual(result);
  });

  it("does not repeat adjacent dates that have the same operational effect", () => {
    const row = hus("Target", "2026-10-23");
    const result = run([row], { sowingChanges: [{ planRowId: row.id, sowingDate: "2026-10-20" }] });
    expect(result.plans).toHaveLength(1);
    expect(result.plans[0].proposals[0].thinningDate).toBe("2026-10-29");
  });

  it("rejects duplicate HUS and malformed dates without starting the search", () => {
    const row = hus("Target");
    expect(run([row, row]).conflicts[0].code).toBe("input");
    expect(run([row], { asOfDate: "2026-02-30" }).search.nodes).toBe(0);
    expect(run([row], { sowingChanges: [{ planRowId: row.id, sowingDate: "2026-99-99" }] }).plans).toEqual([]);
  });

  it("does not calculate biological days from a sowing date that contradicts actual completion", () => {
    const row = hus("Target", "2026-10-13");
    const result = run([row], { completedWork: [{ planRowId: row.id, type: "sowing", date: "2026-10-12" }] });
    expect(result.status).toBe("insufficientData");
    expect(result.plans).toEqual([]);
    expect(result.conflicts[0].code).toBe("input");
  });

  it("keeps a larger input bounded and exposes omitted flexibility", () => {
    const rows = Array.from({ length: 16 }, (_, i) => hus("HUS " + String(i).padStart(2, "0"), addDays("2026-10-20", i), 600));
    const result = run(rows, { limits: { maxNodes: 400, beamWidth: 8, maxMutableRows: 4, maxSowingScenarios: 2 } });
    expect(result.search.nodes).toBeLessThanOrEqual(400);
    expect(result.search.frozenByLimit.length).toBeGreaterThan(0);
    expect(result.search.truncated).toBe(true);
    for (const plan of result.plans) expectPhysicalPlan(plan);
  });
});

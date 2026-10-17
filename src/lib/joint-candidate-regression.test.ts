import { describe, expect, it } from "vitest";
import { simulateJointSowingPlan, type JointCandidatePlacement } from "./joint-greenhouse-simulation";
import { twoHusScenario } from "./__fixtures__/two-hus-scenario";
import { plannerConfig } from "./demo-data";

const sowingChanges = [{ planRowId: "HUS 8A", sowingDate: "2026-10-18" }, { planRowId: "HUS 8B", sowingDate: "2026-10-20" }];
const candidatePlacements: JointCandidatePlacement[] = [
  { planRowId: "HUS 8A", thinningDate: "2026-10-27", wateringZone: "C" },
  { planRowId: "HUS 8B", thinningDate: "2026-10-29", wateringZone: "B" },
];
const request = (rows = twoHusScenario()) => ({ rows, config: plannerConfig, asOfDate: "2026-10-17", sowingChanges,
  allowOtherSowingChanges: false, prioritizeRequestedHus: true });

describe("joint candidate validation and search budget", () => {
  it("directly certifies 8A October 27/C and 8B October 29/B, replacing both old reservations", () => {
    const input = request();
    const before = structuredClone(input.rows);
    const result = simulateJointSowingPlan({ ...input, candidatePlacements });
    expect(result.status).toBe("can");
    expect(result.plans).toHaveLength(1);
    expect(result.plans[0].proposals.map((p) => [p.planRowId, p.thinningDate, p.wateringZone])).toEqual([
      ["HUS 8A", "2026-10-27", "C"], ["HUS 8B", "2026-10-29", "B"],
    ]);
    expect(result.plans[0].proposals.map((p) => p.plantingDate)).toEqual(["2026-11-11", "2026-11-13"]);
    for (const day of result.plans[0].occupancy) {
      expect(day.seeding.overCapacity, day.date).toBe(false);
      expect(day.seeding.conflicts, day.date).toEqual([]);
      expect(day.growing.overCapacity, day.date).toBe(false);
      expect(day.growing.rows.filter((p) => p.planRowId === "HUS 8A").length).toBeLessThanOrEqual(1);
      expect(day.growing.rows.filter((p) => p.planRowId === "HUS 8B").length).toBeLessThanOrEqual(1);
    }
    expect(result.originalRowsUnchanged).toBe(true);
    expect(input.rows).toEqual(before);
  });

  it("rejects the exact swap with a dated, named C-row conflict later in the period", () => {
    const rows = twoHusScenario();
    rows.push({ ...rows[0], id: "Third", sectorName: "HUS 10", sowingDate: "2026-10-25", harvestDate: "2026-11-20",
      sowingTables: "A7–A9", adjustments: { thinning: "2026-11-01" }, placement: { primaryRow: "C", tables: 26, manual: true } });
    const result = simulateJointSowingPlan({ ...request(rows), candidatePlacements });
    expect(result.status).toBe("cannot");
    expect(result.plans).toEqual([]);
    expect(result.conflicts).toContainEqual(expect.objectContaining({ code: "growingCapacity", date: "2026-11-01",
      message: expect.objectContaining({ lv: expect.stringContaining("C rinda nepieciešama HUS 10") }) }));
    // Exact validation must not silently move the third pending HUS to make room.
    expect(rows[5].placement?.primaryRow).toBe("C");
  });

  it("reports the exact fixed A-table collision instead of accepting daily total capacity alone", () => {
    const rows = twoHusScenario();
    rows[0].sowingTables = "A1–A3";
    rows[1].sowingTables = "A3–A5";
    const result = simulateJointSowingPlan({ ...request(rows), candidatePlacements });
    expect(result.status).toBe("cannot");
    expect(result.conflicts[0].message.lv).toContain("2026-10-20: A3 sēšanas galda konflikts (HUS 8B, HUS 8A)");
  });

  it("preserves a complete proof when later enumeration exhausts a small budget", () => {
    const rows = twoHusScenario();
    rows[0].placement!.tables = 27;
    rows[1].placement!.tables = 27;
    rows[0].sowingTables = "A1–A3";
    rows[1].sowingTables = "A4–A6";
    const result = simulateJointSowingPlan({ ...request(rows), limits: { maxNodes: 100 } });
    expect(result.status).toBe("conditional");
    expect(result.search.nodes).toBeLessThanOrEqual(100);
    expect(result.search.truncated).toBe(true);
    expect(result.plans[0].proposals.map((p) => [p.thinningDate, p.wateringZone, p.physicalTables])).toEqual([
      ["2026-10-27", "C", 26], ["2026-10-29", "B", 26],
    ]);
    expect(result.plans[0].notices.some((n) => n.lv.includes("sablīvējums"))).toBe(true);
    expect(result.plans[0].occupancy.every((d) => !d.growing.overCapacity && !d.seeding.overCapacity && !d.seeding.conflicts.length)).toBe(true);
    const direct = simulateJointSowingPlan({ ...request(rows), candidatePlacements: candidatePlacements.map((p) => ({ ...p, physicalTables: 26 })) });
    expect(direct.status).toBe("conditional");
    expect(direct.plans[0].proposals.map((p) => p.wateringZone)).toEqual(["C", "B"]);
  });

  it("certifies a complete normal-table pair before allocating the budget to remaining pairs", () => {
    const rows = twoHusScenario();
    rows[0].sowingTables = "A1–A3";
    rows[1].sowingTables = "A4–A6";
    // Previously completePlan was first entered with both choices present but
    // all 35 nodes already spent, so its fixed-table proof could never run.
    const result = simulateJointSowingPlan({ ...request(rows), limits: { maxNodes: 35 } });
    expect(result.status).toBe("conditional");
    expect(result.search.nodes).toBeLessThanOrEqual(35);
    expect(result.plans[0].proposals.map((p) => p.wateringZone)).toEqual(["C", "B"]);
    expect(result.plans[0].proposals.every((p) => p.physicalTables === 26 && p.cycleDay <= 10)).toBe(true);
    expect(result.plans[0].occupancy.every((d) => !d.growing.overCapacity && !d.seeding.overCapacity && !d.seeding.conflicts.length)).toBe(true);
  });

  it("reports the physical limit of A14–A26 for an oversized exact candidate", () => {
    const result = simulateJointSowingPlan({ ...request(), candidatePlacements: [{ ...candidatePlacements[0], wateringZone: "A" }, candidatePlacements[1]] });
    expect(result.status).toBe("cannot");
    expect(result.conflicts[0]).toMatchObject({ code: "growingCapacity", date: "2026-10-27" });
    expect(result.conflicts[0].message.lv).toContain("HUS 8A vajag 26 galdus A14–A26 blokā, pieejami 13");
  });

  it("does not replan actual Moving even if the selected sowing date is unchanged", () => {
    const rows = twoHusScenario();
    rows[0].husEvents = [{ id: "actual", eventType: "move", eventDate: "2026-10-28", destinationLocation: "B1–B26" }];
    const result = simulateJointSowingPlan({ ...request(rows), sowingChanges: [{ ...sowingChanges[0], sowingDate: rows[0].sowingDate }, sowingChanges[1]], candidatePlacements });
    expect(result.status).toBe("insufficientData");
    expect(result.plans).toEqual([]);
    expect(result.conflicts[0].code).toBe("immutableWork");
    expect(result.conflicts[0].message.lv).toContain("HUS 8A");
  });

  it("retains the Planting-first condition when the candidate uses B on October 28", () => {
    const result = simulateJointSowingPlan({ ...request(), candidatePlacements: [candidatePlacements[0], { ...candidatePlacements[1], thinningDate: "2026-10-28" }] });
    expect(result.status).toBe("conditional");
    expect(result.plans[0].notices.some((n) => n.lv.includes("vispirms Planting (HUS 7)"))).toBe(true);
  });

  it("rejects incomplete candidates and thinning outside days 8–11", () => {
    expect(simulateJointSowingPlan({ ...request(), candidatePlacements: candidatePlacements.slice(0, 1) }).conflicts[0].code).toBe("input");
    const result = simulateJointSowingPlan({ ...request(), candidatePlacements: [{ ...candidatePlacements[0], thinningDate: "2026-10-29" }, candidatePlacements[1]] });
    expect(result.plans).toEqual([]);
    expect(result.conflicts[0].message.lv).toContain("HUS 8A");
    expect(result.conflicts[0].date).toBe("2026-10-29");
  });

  it("still reports a search limit if no candidate has been fully certified", () => {
    const result = simulateJointSowingPlan({ ...request(), candidatePlacements, limits: { maxNodes: 1 } });
    expect(result.status).toBe("searchLimited");
    expect(result.plans).toEqual([]);
  });
});

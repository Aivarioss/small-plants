import { describe, expect, it, vi } from "vitest";
import { plannerConfig } from "./demo-data";
import { buildGreenhouseOccupancyDay, simulateSowingDateChange } from "./greenhouse-simulation";
import type { SowingPlanRow } from "./types";
import * as scheduler from "./scheduler";
import { addDays } from "./planning";

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
function withMissingThinning<T>(id: string, run: () => T): T {
  const schedule = scheduler.scheduleProductionWork;
  const stub = vi.spyOn(scheduler, "scheduleProductionWork").mockImplementation((rows) => {
    const result = schedule(rows);
    return { ...result, items: result.items.filter((item) => item.planRowId !== id || item.type !== "thinning") };
  });
  try { return run(); } finally { stub.mockRestore(); }
}

describe("solution-seeking HUS simulation", () => {
  it("derives seeding count without inventing table assignments", () => {
    const result = simulate([target]);
    expect(result.status).toBe("can");
    expect(result.recommendation?.seedingTableCount).toBe(3);
    expect(result.recommendation?.seedingTables).toEqual([]);
    expect(target.sowingTables).toBeUndefined();
  });

  it("counts a fixed reservation starting after the simulated sowing", () => {
    const next = { ...target, id: "next", sectorName: "Next", requiredPlants: 900,
      sowingTables: "A1", sowingDate: "2026-10-21", harvestDate: "2026-11-12", adjustments: { thinning: "2026-10-28" } };
    const result = simulate([target, next]);
    expect(result.recommendation?.seedingTableCount).toBe(3);
    expect(result.occupancy.find((day) => day.date === "2026-10-21")?.seeding.usedTables).toBe(4);
    expect(result.recommendation?.seedingTables).toEqual([]);
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

  it("accepts another HUS with a known count and dates without specific A numbers", () => {
    const result = simulate([target, { ...target, id: "unknown", sectorName: "Unknown" }]);
    expect(result.status).toBe("can");
    expect(result.recommendation?.status).toBe(result.status);
    expect(result.warnings.join(" ")).not.toContain("nav norādīti sēšanas galdi");
  });

  it("does not repeat equivalent dates, densities or identical B/C/D rows", () => {
    const result = simulate([target]);
    expect(result.alternatives.filter((option) => option.tier === "preferred")).toHaveLength(1);
    expect(result.alternatives.length).toBeLessThanOrEqual(4);
    expect(result.recommendation).toBe(result.alternatives[0]);
    expect(result.alternatives.every((option) => option.physicalTables === option.normalTables)).toBe(true);
  });

  it("does not mutate house occupancy and counts reservations without assigned A numbers", () => {
    const rows = [target, blocker("C", "C")];
    const before = buildGreenhouseOccupancyDay(rows, plannerConfig, "2026-10-27");
    simulate(rows);
    expect(buildGreenhouseOccupancyDay(rows, plannerConfig, "2026-10-27")).toEqual(before);
    expect(before.seeding).toMatchObject({ incomplete: false, usedTables: 3, freeTables: 10 });
    expect(before.growing.capacity).toBe(91);
    expect(before.seeding.capacity).toBe(13);
  });

  it("preserves the actual C24 + B26/A13 capacity and recorded seeding tables", () => {
    const actual = (id: string, sowingDate: string, move: string, end: string, destinationLocation: string): SowingPlanRow => ({
      ...target, id, sectorName: id, sowingDate, harvestDate: end,
      husEvents: [{ id: id + "-moving", eventType: "move", eventDate: move, location: "A1–A3", destinationLocation }],
    });
    const hus6 = actual("HUS 6", "2026-09-29", "2026-10-07", "2026-10-21", "C1–C24");
    const hus7 = actual("HUS 7", "2026-10-06", "2026-10-14", "2026-10-28", "B1–B26\nA14–A26");
    const hus9 = { ...target, id: "HUS 9", sectorName: "HUS 9", sowingDate: "2026-10-13", harvestDate: "2026-11-04",
      sowingTables: "A3, A4, A8", adjustments: { thinning: "2026-10-21" } };
    const rows = [target, hus6, hus7, hus9];
    const snapshot = buildGreenhouseOccupancyDay(rows, plannerConfig, "2026-10-17");
    expect(snapshot.seeding).toMatchObject({ usedTables: 3, occupiedTableIds: ["A3", "A4", "A8"] });
    expect(snapshot.growing).toMatchObject({ physicalUsedTables: 63, usedTables: 65, freeTables: 26 });
    simulateSowingDateChange(rows, plannerConfig, target.id, "2026-10-17");
    expect(buildGreenhouseOccupancyDay(rows, plannerConfig, "2026-10-17")).toEqual(snapshot);
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

  it("fits three required tables when nine are free, without specific A numbers", () => {
    const other = { ...target, id: "other", sectorName: "HUS other", requiredPlants: 4500,
      placement: { primaryRow: "D" as const, tables: 26, manual: true }, adjustments: { thinning: "2026-10-28" } };
    const result = simulate([target, other]);
    expect(result.status).toBe("can");
    expect(result.recommendation?.seedingTableCount).toBe(3);
    expect(result.occupancy.find((day) => day.date === "2026-10-20")?.seeding).toMatchObject({ usedTables: 7, freeTables: 6, incomplete: false });
    expect(other.sowingTables).toBeUndefined();
  });

  it("reuses count-only capacity sequentially without leaving earlier HUS permanently occupied", () => {
    const first = { ...target, id: "first", sectorName: "First", sowingDate: "2026-10-12", harvestDate: "2026-11-03",
      adjustments: { thinning: "2026-10-19" }, placement: { primaryRow: "B" as const, tables: 24, manual: true } };
    const next = { ...target, id: "next", sectorName: "Next", sowingDate: "2026-10-28", harvestDate: "2026-11-19",
      adjustments: { thinning: "2026-11-04" }, placement: { primaryRow: "D" as const, tables: 24, manual: true } };
    const result = simulate([target, first, next]);
    expect(result.recommendation?.cycleDay).toBe(8);
    const on = (date: string) => result.occupancy.find((day) => day.date === date)!.seeding;
    expect(on("2026-10-19").rows.map((row) => row.planRowId)).toEqual(["first"]);
    expect(on("2026-10-20").rows.map((row) => row.planRowId)).toEqual(["target"]);
    expect(on("2026-10-27").usedTables).toBe(3);
    expect(on("2026-10-28").rows.map((row) => row.planRowId)).toEqual(["next"]);
    expect(on("2026-11-04").usedTables).toBe(3);
    expect(on("2026-11-05").usedTables).toBe(0);
  });

  it("rejects a fixed target table conflict even when aggregate capacity is sufficient", () => {
    const other = { ...target, id: "other", sectorName: "Other", requiredPlants: 900, sowingTables: "A3",
      adjustments: { thinning: "2026-10-28" } };
    const result = simulate([{ ...target, sowingTables: "A1–A3" }, other]);
    expect(result.status).toBe("cannot");
    expect(result.recommendation).toBeUndefined();
    expect(result.notices[0].lv).toContain("2026-10-20: A3");
    expect(result.notices[0].en).toContain("Other");
  });

  it("does not double-use fixed reservations of other HUS for a floating proposal", () => {
    const a = { ...target, requiredPlants: 900, sowingTables: "A1", adjustments: { thinning: "2026-10-28" } };
    const result = simulate([target, { ...a, id: "a", sectorName: "Other A" }, { ...a, id: "b", sectorName: "Other B" }]);
    expect(result.status).toBe("cannot");
    expect(result.notices[0].lv).toContain("A1");
    expect(result.notices[0].lv).toContain("Other A, Other B");
  });

  it("requires a continuous physical allocation around rotating fixed reservations", () => {
    const previous = { ...target, id: "previous", sectorName: "Previous", requiredPlants: 900,
      sowingDate: "2026-10-13", harvestDate: "2026-11-04", sowingTables: "A1–A10", adjustments: { thinning: "2026-10-21" } };
    const next = { ...target, id: "next", sectorName: "Next", requiredPlants: 900,
      sowingDate: "2026-10-22", harvestDate: "2026-11-13", sowingTables: "A4–A13", adjustments: { thinning: "2026-10-29" } };
    const result = simulate([target, previous, next]);
    // Each day has three free tables, but no three remain free for this HUS's entire stay.
    expect(result.status).toBe("cannot");
    expect(result.notices[0].lv).toContain("nepārtrauktu vietu");
    expect(result.notices[0].lv).toContain("Previous");
    expect(result.notices[0].lv).toContain("Next");
  });

  it("does not let a historical HUS with unknown release or table numbers block October", () => {
    const historical = { ...target, id: "history", sectorName: "HUS 3", sowingDate: "2026-09-02", harvestDate: "2026-09-24",
      adjustments: { thinning: "2026-10-31" } };
    const result = withMissingThinning(historical.id, () => simulate([target, historical]));
    expect(result.status).toBe("can");
    expect(result.recommendation?.notices.some((notice) => notice.lv.includes("HUS 3"))).toBe(false);
  });

  it("retains manual 22 + 4 growing tables as a strained shared-row proposal", () => {
    const own = { ...target, requiredPlants: 3300, placement: { primaryRow: "C" as const, tables: 22, manual: true } };
    const other = blocker("Older HUS", "C", 4);
    const before = structuredClone(other);
    const result = simulate([own, other]);
    expect(result.status).toBe("conditional");
    expect(result.recommendation).toMatchObject({ physicalTables: 22, wateringZone: "C", placementKind: "sharedRow", tier: "strained" });
    expect(result.recommendation?.sharedWith).toEqual([expect.objectContaining({ planRowId: other.id })]);
    expect(result.recommendation?.notices.some((notice) => notice.lv.includes("Dalīta laistīšanas zona"))).toBe(true);
    expect(other).toEqual(before);
  });

  it("names a future growing-row conflict without masking it as missing seeding numbers", () => {
    const own = { ...target, placement: { primaryRow: "C" as const, tables: 24, manual: true } };
    const future = { ...target, id: "future", sectorName: "HUS 9", sowingDate: "2026-10-22", harvestDate: "2026-11-13",
      adjustments: { thinning: "2026-10-29" }, placement: { primaryRow: "C" as const, tables: 26, manual: true } };
    const result = simulate([own, future]);
    expect(result.status).toBe("cannot");
    expect(result.recommendation).toBeUndefined();
    expect(result.notices[0].lv).toContain("2026-10-29: C rinda nepieciešama HUS 9");
    expect(result.notices[0].en).toContain("2026-10-29: C row is required by HUS 9");
  });

  it("reports known seeding capacity shortage as cannot, not insufficient data", () => {
    const other = { ...target, id: "large", sectorName: "Large", requiredPlants: 14721,
      adjustments: { thinning: "2026-10-28" }, placement: { primaryRow: "D" as const, tables: 26, manual: true } };
    const result = simulate([target, other]);
    expect(result.status).toBe("cannot");
    expect(result.notices[0].lv).toContain("vajag 14 sēšanas galdus, pieejami 13");
  });

  it("labels a genuine unknown count as conditional when a growing proposal can be evaluated", () => {
    const unknown = { ...target, id: "unknown", sectorName: "Unknown", requiredPlants: Number.NaN,
      placement: { primaryRow: "D" as const, tables: 4, manual: true } };
    const result = simulate([target, unknown]);
    expect(result.status).toBe("conditional");
    expect(result.recommendation?.notices[0].lv).toContain("Unknown nav zināms nepieciešamais sēšanas galdu skaits");
  });

  it("does not mask a proven growing conflict with another HUS's unknown plant count", () => {
    const unknown = { ...target, id: "unknown", sectorName: "Unknown", requiredPlants: Number.NaN,
      placement: { primaryRow: "D" as const, tables: 4, manual: true } };
    const own = { ...target, placement: { primaryRow: "C" as const, tables: 24, manual: true } };
    const result = simulate([own, unknown, blocker("Known C", "C", 26)]);
    expect(result.status).toBe("cannot");
    expect(result.notices[0].lv).toContain("C rinda nepieciešama Known C");
  });

  it("uses insufficientData when an unknown release date is essential for capacity", () => {
    const unknown = { ...target, id: "unknown", sectorName: "Unknown release", sowingTables: "A1–A11",
      sowingDate: "2026-10-10", harvestDate: "2026-11-01", adjustments: { thinning: "2026-10-31" } };
    const result = withMissingThinning(unknown.id, () => simulate([target, unknown]));
    expect(result.status).toBe("insufficientData");
    expect(result.recommendation).toBeUndefined();
    expect(result.notices[0].lv).toContain("2026-10-20: Unknown release nav droši zināms");
  });

  it("prefers day 8 over waiting until day 10 when day 9 has a workload overload", () => {
    const other = { ...target, id: "other", sectorName: "Other", requiredPlants: 900,
      sowingDate: "2026-10-21", harvestDate: "2026-11-12", adjustments: { thinning: "2026-10-28" },
      placement: { primaryRow: "D" as const, tables: 6, manual: true } };
    const result = simulate([target, other]);
    expect(result.recommendation?.cycleDay).toBe(8);
    expect(result.recommendation?.avoidsDay9Overload).toBe(true);
    expect(result.recommendation?.explanation).toContain("darba pārslodzes 9. dienā");
    expect(result.alternatives.find((option) => option.cycleDay === 9)?.workload.overload).toBeGreaterThan(0);
  });

  it("still checks a proven growing conflict when an unknown release prevents seeding confirmation", () => {
    const own = { ...target, placement: { primaryRow: "C" as const, tables: 24, manual: true } };
    const unknown = { ...target, id: "unknown", sectorName: "Unknown release", sowingTables: "A1–A11",
      sowingDate: "2026-10-10", harvestDate: "2026-11-01" };
    const result = withMissingThinning(unknown.id, () => simulate([own, unknown, blocker("Known C", "C", 26)]));
    expect(result.status).toBe("cannot");
    expect(result.notices[0].lv).toContain("C rinda nepieciešama Known C");
  });

  it("names a proven density obstacle when a manual table count is too small", () => {
    const result = simulate([{ ...target, placement: { primaryRow: "C", tables: 1, manual: true } }]);
    expect(result.status).toBe("cannot");
    expect(result.notices[0].lv).toContain("pārsniedz atļauto blīvumu");
  });

  it.each([8, 9, 10, 11])("checks growing availability and next sowing for day %i", (day) => {
    const available = addDays(target.sowingDate, day - 1);
    const own = { ...target, placement: { primaryRow: "C" as const, tables: 24, manual: true } };
    const nextSowing = addDays(available, 1);
    const next = { ...target, id: "next", sectorName: "Next", requiredPlants: 900, sowingTables: "A1–A12",
      sowingDate: nextSowing, harvestDate: addDays(nextSowing, 22), adjustments: { thinning: addDays(nextSowing, 7) },
      placement: { primaryRow: "D" as const, tables: 6, manual: true } };
    const result = simulate([own, blocker("Previous C", "C", 26, available), next]);
    expect(result.recommendation?.cycleDay).toBe(day);
    expect(result.recommendation?.status).toBe("conditional");
    if (day === 11) expect(result.recommendation?.tier).toBe("strained");
  });
});

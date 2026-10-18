import { describe, expect, it } from "vitest";
import { unconfirmedPlacementScenario } from "./__fixtures__/unconfirmed-placement-scenario";
import { plannerConfig } from "./demo-data";
import { buildGreenhouseOccupancyDay } from "./greenhouse-simulation";
import type { SowingPlanRow } from "./types";

function hus(id: string, patch: Partial<SowingPlanRow> = {}): SowingPlanRow {
  return { ...unconfirmedPlacementScenario()[3], id, sectorName: id, sowingTables: undefined,
    adjustments: { thinning: "2026-10-29" }, adjustmentSources: { thinning: "manual" }, ...patch };
}
const snapshot = (rows: SowingPlanRow[], date: string) => buildGreenhouseOccupancyDay(rows, plannerConfig, date);

describe("house seeding capacity includes unnumbered reservations", () => {
  it("counts 8B and HUS 3 on October 31 without requiring A numbers or inventing free table addresses", () => {
    const rows = unconfirmedPlacementScenario();
    const before = structuredClone(rows);
    const day = snapshot(rows, "2026-10-31");
    expect(day.seeding).toMatchObject({ usedTables: 6, freeTables: 7, incomplete: false, unknownRows: [], occupiedTableIds: [], freeTableIds: [] });
    expect(day.seeding.rows.map((r) => [r.sectorName, r.tableCount])).toEqual([["HUS 8B", 3], ["HUS 3", 3]]);
    expect(day.warnings.some((warning) => warning.includes("nav norādīti sēšanas galdi"))).toBe(false);
    expect(rows).toEqual(before);
  });

  it("reserves by count from sowing through planned thinning, releasing the following day", () => {
    const rows = [hus("First")];
    expect(snapshot(rows, "2026-10-19").seeding.usedTables).toBe(0);
    expect(snapshot(rows, "2026-10-20").seeding).toMatchObject({ usedTables: 3, freeTables: 10, incomplete: false });
    expect(snapshot(rows, "2026-10-29").seeding.usedTables).toBe(3);
    expect(snapshot(rows, "2026-10-30").seeding).toMatchObject({ usedTables: 0, freeTables: 13 });
  });

  it("combines numbered and unnumbered reservations without treating all other A tables as free", () => {
    const rows = [hus("Numbered", { sowingTables: "A1–A3" }), hus("By count")];
    const day = snapshot(rows, "2026-10-25");
    expect(day.seeding).toMatchObject({ usedTables: 6, freeTables: 7, incomplete: false, freeTableIds: [] });
    expect(day.seeding.occupiedTableIds).toEqual(["A1", "A2", "A3"]);
    expect(day.seeding.rows.map((r) => r.tableCount)).toEqual([3, 3]);
  });

  it("retains exact physical collisions and total-count capacity conflicts", () => {
    const rows = [hus("First", { sowingTables: "A1–A3" }), hus("Second", { sowingTables: "A3–A5" })];
    const collision = snapshot(rows, "2026-10-25");
    expect(collision.seeding.conflicts[0]).toMatchObject({ table: "A3", sectorNames: ["First", "Second"] });
    expect(collision.seeding.overCapacity).toBe(true);
    const overbooked = snapshot(Array.from({ length: 5 }, (_, i) => hus(`HUS ${i}`)), "2026-10-25");
    expect(overbooked.seeding).toMatchObject({ usedTables: 15, freeTables: 0, overCapacity: true });
    expect(overbooked.warnings.some((warning) => warning.includes("Sēšanas galdu noslodze pārsniedz 13"))).toBe(true);
  });

  it("still reports genuinely unknown counts rather than pretending all tables are free", () => {
    const day = snapshot([hus("Unknown", { requiredPlants: Number.NaN })], "2026-10-25");
    expect(day.seeding.incomplete).toBe(true);
    expect(day.seeding.unknownRows).toContainEqual({ planRowId: "Unknown", sectorName: "Unknown", reason: "unknownCount" });
    expect(day.warnings).toContain("Unknown: nav zināms nepieciešamais sēšanas galdu skaits.");
    expect(day.seeding.freeTableIds).toEqual([]);
  });
});

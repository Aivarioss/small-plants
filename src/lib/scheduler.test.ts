import { describe, expect, it } from "vitest";
import { effectiveOperationalLoad, scheduleProductionWork } from "./scheduler";
import type { SowingPlanRow } from "./types";

function row(patch: Partial<SowingPlanRow> = {}): SowingPlanRow {
  return {
    id: patch.id ?? "row",
    sectorName: patch.sectorName ?? "Hus 1",
    requiredPlants: patch.requiredPlants ?? 3400,
    extraPlants: patch.extraPlants ?? 140,
    variety: patch.variety ?? "Proloog",
    sowingDate: patch.sowingDate ?? "2026-10-01",
    harvestDate: patch.harvestDate ?? "2026-10-21",
    cycleLength: patch.cycleLength ?? 21,
    sectorType: patch.sectorType ?? 26,
    plantsPerBox: patch.plantsPerBox ?? 12,
    correction: patch.correction ?? 0,
    ...patch,
  };
}

function productionRow(
  id: string,
  sectorName: string,
  requiredPlants: number,
  sowingDate: string,
  harvestDate: string,
  sectorType: SowingPlanRow["sectorType"] = 26,
): SowingPlanRow {
  return row({
    id,
    sectorName,
    requiredPlants,
    extraPlants: 100,
    variety: "Baltazsara",
    sowingDate,
    harvestDate,
    cycleLength: 22,
    sectorType,
    source: "user",
  });
}

function realOctoberProductionRows(): SowingPlanRow[] {
  return [
    productionRow("hus-4", "Hus 4", 3819, "2026-09-22", "2026-10-14"),
    productionRow("hus-5", "Hus 5", 3556, "2026-09-24", "2026-10-16"),
    productionRow("hus-6", "Hus 6", 3556, "2026-09-29", "2026-10-21"),
    productionRow("hus-7", "Hus 7", 6057, "2026-10-06", "2026-10-28", 39),
    productionRow("hus-9", "Hus 9", 3707, "2026-10-13", "2026-11-04"),
  ];
}

function greenhouseRow(
  id: string,
  plantCount: number,
  sowingDate: string,
  harvestDate: string,
  patch: Partial<SowingPlanRow> = {},
): SowingPlanRow {
  return row({
    id,
    sectorName: patch.sectorName ?? id,
    requiredPlants: plantCount,
    extraPlants: 0,
    sowingDate,
    harvestDate,
    cycleLength: patch.cycleLength ?? 22,
    sectorType: patch.sectorType ?? 26,
    ...patch,
  });
}

describe("production scheduler", () => {
  it("keeps move-out fixed and rings exactly one day before move-out for 21/22/23 day cycles", () => {
    const result = scheduleProductionWork([
      row({ id: "cycle-21", harvestDate: "2026-10-21", cycleLength: 21 }),
      row({ id: "cycle-22", harvestDate: "2026-10-22", cycleLength: 22 }),
      row({ id: "cycle-23", harvestDate: "2026-10-23", cycleLength: 23 }),
    ]);

    expect(result.items.find((item) => item.planRowId === "cycle-21" && item.type === "rings")?.date).toBe(
      "2026-10-20",
    );
    expect(result.items.find((item) => item.planRowId === "cycle-22" && item.type === "rings")?.date).toBe(
      "2026-10-21",
    );
    expect(result.items.find((item) => item.planRowId === "cycle-23" && item.type === "rings")?.date).toBe(
      "2026-10-22",
    );
    expect(result.items.find((item) => item.planRowId === "cycle-23" && item.type === "harvest")?.date).toBe(
      "2026-10-23",
    );
    expect(result.items.find((item) => item.planRowId === "cycle-23" && item.type === "sowing")?.cycleDay).toBe(1);
    expect(result.items.find((item) => item.planRowId === "cycle-23" && item.type === "harvest")?.cycleDay).toBe(23);
  });

  it("schedules thinning only on cycle day 8, 9 or 10", () => {
    const result = scheduleProductionWork([row()]);
    const thinning = result.items.find((item) => item.type === "thinning");

    expect(thinning?.cycleDay).toBeGreaterThanOrEqual(8);
    expect(thinning?.cycleDay).toBeLessThanOrEqual(10);
    expect((thinning?.date ?? "") >= "2026-10-08").toBe(true);
    expect((thinning?.date ?? "") <= "2026-10-10").toBe(true);
  });

  it("keeps side shoots before sticks and sticks before rings", () => {
    const result = scheduleProductionWork([row({ id: "ordered", harvestDate: "2026-10-23", cycleLength: 23 })]);
    const sideShootsCompletion = result.items
      .filter((item) => item.planRowId === "ordered" && item.type === "sideShoots")
      .map((item) => item.date)
      .sort()
      .at(-1);
    const sticks = result.items.find((item) => item.planRowId === "ordered" && item.type === "sticks");
    const rings = result.items.find((item) => item.planRowId === "ordered" && item.type === "rings");

    expect(sideShootsCompletion).toBeDefined();
    expect((sticks?.date ?? "") > (sideShootsCompletion ?? "")).toBe(true);
    expect(rings?.date).toBe("2026-10-22");
    expect((sticks?.date ?? "") < (rings?.date ?? "")).toBe(true);
  });

  it("moves thinning away from a full day 9 to day 8 when day 8 is free", () => {
    const target = row({ id: "target", sowingDate: "2026-10-01", harvestDate: "2026-10-21" });
    const fullDay9 = row({
      id: "full-day-9",
      sowingDate: "2026-09-20",
      harvestDate: "2026-10-30",
      previcureDate: "2026-10-09",
      cycleLength: 41,
      adjustments: { thinning: "2026-09-27", sideShoots: "2026-10-06", sticks: "2026-10-25" },
    });
    const halfDay10 = row({
      id: "half-day-10",
      sowingDate: "2026-09-21",
      harvestDate: "2026-10-23",
      cycleLength: 33,
      adjustments: { thinning: "2026-09-28", sideShoots: "2026-10-07", sticks: "2026-10-10" },
    });
    const result = scheduleProductionWork([target, fullDay9, halfDay10]);

    expect(result.items.find((item) => item.planRowId === target.id && item.type === "thinning")?.date).toBe(
      "2026-10-08",
    );
  });

  it("never schedules side shoots before cycle day 17", () => {
    const result = scheduleProductionWork([row({ id: "side-shoots", harvestDate: "2026-10-23", cycleLength: 23 })]);
    const sideShoots = result.items.filter((item) => item.planRowId === "side-shoots" && item.type === "sideShoots");

    expect(sideShoots.length).toBeGreaterThan(0);
    expect(sideShoots.every((item) => item.cycleDay >= 17)).toBe(true);
  });

  it("moves side shoots from day 17 when a later allowed day is quieter", () => {
    const target = row({ id: "target-side", sowingDate: "2026-10-01", harvestDate: "2026-10-23", cycleLength: 23 });
    const day17MoveOut = row({
      id: "busy-day-17",
      sowingDate: "2026-09-27",
      harvestDate: "2026-10-17",
      cycleLength: 21,
    });
    const result = scheduleProductionWork([target, day17MoveOut]);
    const sideShoots = result.items.find((item) => item.planRowId === target.id && item.type === "sideShoots");

    expect(sideShoots?.date).not.toBe("2026-10-17");
    expect(sideShoots?.date && sideShoots.date > "2026-10-17").toBe(true);
    expect(sideShoots?.date && sideShoots.date < "2026-10-22").toBe(true);
  });

  it("splits side shoots into two half days when no full day is free before the deadline", () => {
    const target = row({ id: "target-split", sowingDate: "2026-10-01", harvestDate: "2026-10-21", cycleLength: 21 });
    const half17 = row({
      id: "half-17",
      sowingDate: "2026-09-20",
      harvestDate: "2026-10-22",
      cycleLength: 33,
      adjustments: { thinning: "2026-09-27", sideShoots: "2026-10-08", sticks: "2026-10-17" },
    });
    const half18 = row({
      id: "half-18",
      sowingDate: "2026-09-21",
      harvestDate: "2026-10-23",
      cycleLength: 33,
      adjustments: { thinning: "2026-09-28", sideShoots: "2026-10-09", sticks: "2026-10-18" },
    });
    const full19 = row({
      id: "full-19",
      sowingDate: "2026-09-29",
      harvestDate: "2026-10-20",
      previcureDate: "2026-10-19",
      cycleLength: 22,
      adjustments: { sideShoots: "2026-10-15", sticks: "2026-10-16" },
    });
    const result = scheduleProductionWork([target, half17, half18, full19]);
    const dates = result.items
      .filter((item) => item.planRowId === target.id && item.type === "sideShoots")
      .map((item) => item.date);

    expect(dates).toEqual(["2026-10-17", "2026-10-18"]);
  });

  it("accepts rings and thinning on the same date as a compatible production day", () => {
    const rings = row({ id: "rings", sowingDate: "2026-10-03", harvestDate: "2026-10-23", cycleLength: 21 });
    const thinning = row({
      id: "thinning",
      sowingDate: "2026-10-15",
      harvestDate: "2026-11-04",
      cycleLength: 21,
      adjustments: { thinning: "2026-10-22" },
    });
    const items = scheduleProductionWork([rings, thinning]).items.filter((item) => item.date === "2026-10-22");

    expect(items.map((item) => item.type).sort()).toEqual(["rings", "thinning"]);
    expect(
      effectiveOperationalLoad(
        items.map((item) => ({
          date: item.date,
          planRowId: item.planRowId,
          type: item.type,
          workloadWeight: item.workloadWeight,
        })),
      ),
    ).toBe(1);
  });

  it("does not overload a day just because sowing is shown with one other main job", () => {
    const sowing = row({ id: "sowing", sowingDate: "2026-10-21", harvestDate: "2026-11-10" });
    const moveOut = row({ id: "move-out", sowingDate: "2026-10-01", harvestDate: "2026-10-21" });
    const items = scheduleProductionWork([sowing, moveOut]).items.filter((item) => item.date === "2026-10-21");

    expect(items.map((item) => item.type)).toContain("sowing");
    expect(items.map((item) => item.type)).toContain("harvest");
    expect(
      effectiveOperationalLoad(
        items.map((item) => ({
          date: item.date,
          planRowId: item.planRowId,
          type: item.type,
          workloadWeight: item.workloadWeight,
        })),
      ),
    ).toBe(1);
  });

  it("adds normal greenhouse placement around 25 plants per trough for thinning", () => {
    const result = scheduleProductionWork([greenhouseRow("normal", 3844, "2026-10-01", "2026-10-23")]);
    const thinning = result.items.find((item) => item.type === "thinning");

    expect(thinning?.greenhousePlacement?.totalTables).toBe(26);
    expect(thinning?.greenhousePlacement?.plantsPerTrough).toBeCloseTo(24.6, 1);
    expect(thinning?.greenhousePlacement?.densityClass).toBe("normal");
  });

  it("keeps 4200 plants in one 26-table row through modest compression", () => {
    const result = scheduleProductionWork([greenhouseRow("compressed", 4200, "2026-10-01", "2026-10-23")]);
    const thinning = result.items.find((item) => item.type === "thinning");

    expect(thinning?.greenhousePlacement?.totalTables).toBe(26);
    expect(thinning?.greenhousePlacement?.extraTables).toBe(0);
    expect(thinning?.greenhousePlacement?.densityClass).toBe("slightlyCompressed");
  });

  it("compresses a new incoming sector instead of rearranging already-thinned sectors", () => {
    const existingLarge = greenhouseRow("existing-large", 6157, "2026-09-01", "2026-10-30");
    const existingNormal = greenhouseRow("existing-normal", 3844, "2026-09-02", "2026-10-30");
    const incoming = greenhouseRow("incoming", 5000, "2026-09-10", "2026-10-30");
    const result = scheduleProductionWork([existingLarge, existingNormal, incoming]);
    const largeThinning = result.items.find((item) => item.planRowId === existingLarge.id && item.type === "thinning");
    const normalThinning = result.items.find((item) => item.planRowId === existingNormal.id && item.type === "thinning");
    const incomingThinning = result.items.find((item) => item.planRowId === incoming.id && item.type === "thinning");

    expect(largeThinning?.greenhousePlacement?.totalTables).toBe(39);
    expect(normalThinning?.greenhousePlacement?.totalTables).toBe(26);
    expect(incomingThinning?.freeTablesBeforePlacement).toBe(26);
    expect(incomingThinning?.greenhousePlacement?.totalTables).toBe(26);
    expect(incomingThinning?.greenhousePlacement?.densityClass).toBe("exceptional");
  });

  it("chooses day 9 instead of day 8 when move-out frees tables for a better placement", () => {
    const occupiedLarge = greenhouseRow("occupied-large", 6157, "2026-09-01", "2026-10-09");
    const occupiedNormal = greenhouseRow("occupied-normal", 3844, "2026-09-02", "2026-10-09");
    const incoming = greenhouseRow("incoming-day-9", 5000, "2026-10-01", "2026-10-23");
    const result = scheduleProductionWork([occupiedLarge, occupiedNormal, incoming]);
    const thinning = result.items.find((item) => item.planRowId === incoming.id && item.type === "thinning");

    expect(thinning?.date).toBe("2026-10-09");
    expect(thinning?.cycleDay).toBe(9);
    expect(thinning?.occupiedTables).toBe(0);
    expect(thinning?.greenhousePlacement?.densityClass).toBe("normal");
  });

  it("chooses day 10 when that is the first day with substantially better greenhouse capacity", () => {
    const occupiedLarge = greenhouseRow("occupied-large-day-10", 6157, "2026-09-01", "2026-10-10");
    const occupiedNormal = greenhouseRow("occupied-normal-day-10", 3844, "2026-09-02", "2026-10-10");
    const incoming = greenhouseRow("incoming-day-10", 5000, "2026-10-01", "2026-10-23");
    const result = scheduleProductionWork([occupiedLarge, occupiedNormal, incoming]);
    const thinning = result.items.find((item) => item.planRowId === incoming.id && item.type === "thinning");

    expect(thinning?.date).toBe("2026-10-10");
    expect(thinning?.cycleDay).toBe(10);
    expect(thinning?.occupiedTables).toBe(0);
    expect(thinning?.greenhousePlacement?.densityClass).toBe("normal");
  });

  it("allows move-out and thinning on the same day and reuses freed tables for capacity", () => {
    const movingOut = greenhouseRow("moving-out", 6157, "2026-09-01", "2026-10-09");
    const alsoMovingOut = greenhouseRow("also-moving-out", 3844, "2026-09-02", "2026-10-09");
    const incoming = greenhouseRow("same-day-thinning", 5000, "2026-10-01", "2026-10-23");
    const result = scheduleProductionWork([movingOut, alsoMovingOut, incoming]);
    const sameDay = result.items.filter((item) => item.date === "2026-10-09");
    const thinning = sameDay.find((item) => item.planRowId === incoming.id && item.type === "thinning");

    expect(sameDay.map((item) => item.type)).toContain("harvest");
    expect(thinning?.occupiedTables).toBe(0);
    expect(thinning?.greenhousePlacement?.densityClass).toBe("normal");
  });

  it("uses emergency day 11 with a warning when days 8-10 have no feasible capacity", () => {
    const blockers = [
      greenhouseRow("blocker-39", 6157, "2026-09-01", "2026-10-11"),
      greenhouseRow("blocker-26", 3844, "2026-09-02", "2026-10-11"),
      greenhouseRow("blocker-16", 2400, "2026-09-03", "2026-10-11"),
    ];
    const incoming = greenhouseRow("emergency", 2400, "2026-10-01", "2026-10-23");
    const result = scheduleProductionWork([...blockers, incoming]);
    const thinning = result.items.find((item) => item.planRowId === incoming.id && item.type === "thinning");

    expect(thinning?.cycleDay).toBe(11);
    expect(result.warnings.some((warning) => warning.code === "emergency_day_11")).toBe(true);
    expect(thinning?.warnings?.join(" ")).toContain("11. dienā");
  });

  it("returns a capacity conflict when thinning is impossible even on emergency day 11", () => {
    const blockers = [
      greenhouseRow("hard-blocker-39", 6157, "2026-09-01", "2026-10-30"),
      greenhouseRow("hard-blocker-26", 3844, "2026-09-02", "2026-10-30"),
      greenhouseRow("hard-blocker-16", 2400, "2026-09-03", "2026-10-30"),
    ];
    const incoming = greenhouseRow("impossible-capacity", 2400, "2026-10-01", "2026-10-23");
    const result = scheduleProductionWork([...blockers, incoming]);
    const thinning = result.items.find((item) => item.planRowId === incoming.id && item.type === "thinning");

    expect(thinning?.cycleDay).toBe(11);
    expect(thinning?.greenhousePlacement?.feasible).toBe(false);
    expect(result.warnings.some((warning) => warning.code === "greenhouse_capacity_conflict")).toBe(true);
  });

  it("keeps two-sector weekly fixed move-outs and plans thinning inside each legal window", () => {
    const result = scheduleProductionWork([
      row({ id: "wednesday", sowingDate: "2026-10-01", harvestDate: "2026-10-21", cycleLength: 21 }),
      row({ id: "friday", sowingDate: "2026-10-03", harvestDate: "2026-10-23", cycleLength: 21 }),
    ]);

    expect(result.items.find((item) => item.planRowId === "wednesday" && item.type === "harvest")?.date).toBe(
      "2026-10-21",
    );
    expect(result.items.find((item) => item.planRowId === "friday" && item.type === "harvest")?.date).toBe(
      "2026-10-23",
    );
    expect(result.items.find((item) => item.planRowId === "wednesday" && item.type === "thinning")?.cycleDay).toBe(8);
    expect(result.items.find((item) => item.planRowId === "friday" && item.type === "thinning")?.cycleDay).toBe(8);
  });

  it("generates the real October production rhythm without treating compatible work as a conflict", () => {
    const result = scheduleProductionWork(realOctoberProductionRows());

    expect(result.warnings.every((warning) => warning.code !== "greenhouse_capacity_conflict")).toBe(true);
    expect(result.items.find((item) => item.planRowId === "hus-4" && item.type === "harvest")?.date).toBe(
      "2026-10-14",
    );
    expect(result.items.find((item) => item.planRowId === "hus-5" && item.type === "harvest")?.date).toBe(
      "2026-10-16",
    );
    expect(result.items.find((item) => item.planRowId === "hus-6" && item.type === "harvest")?.date).toBe(
      "2026-10-21",
    );

    const october15 = result.items.filter((item) => item.date === "2026-10-15");
    expect(october15.map((item) => `${item.type}:${item.sectorName}`).sort()).toEqual([
      "rings:Hus 5",
      "thinning:Hus 7",
    ]);
    expect(
      effectiveOperationalLoad(
        october15.map((item) => ({
          date: item.date,
          planRowId: item.planRowId,
          type: item.type,
          workloadWeight: item.workloadWeight,
        })),
      ),
    ).toBe(1);

    const hus7Thinning = result.items.find((item) => item.planRowId === "hus-7" && item.type === "thinning");
    expect(hus7Thinning?.date).toBe("2026-10-15");
    expect(hus7Thinning?.cycleDay).toBeGreaterThanOrEqual(8);
    expect(hus7Thinning?.cycleDay).toBeLessThanOrEqual(10);

    const ringDates = new Map(
      result.items.filter((item) => item.type === "rings").map((item) => [item.planRowId, item.date]),
    );
    const flexibleItems = result.items.filter((item) => item.type === "sideShoots" || item.type === "sticks");
    expect(flexibleItems.every((item) => item.date < (ringDates.get(item.planRowId) ?? ""))).toBe(true);
    rowsById(realOctoberProductionRows()).forEach((row) => {
      const sideShootsCompletion = result.items
        .filter((item) => item.planRowId === row.id && item.type === "sideShoots")
        .map((item) => item.date)
        .sort()
        .at(-1);
      const sticks = result.items.find((item) => item.planRowId === row.id && item.type === "sticks");
      if (sideShootsCompletion && sticks) {
        expect(sticks.date > sideShootsCompletion).toBe(true);
      }
    });
    const hus9Thinning = result.items.find((item) => item.planRowId === "hus-9" && item.type === "thinning");
    expect(hus9Thinning?.cycleDay).toBeGreaterThanOrEqual(8);
    expect(hus9Thinning?.cycleDay).toBeLessThanOrEqual(10);
  });

  it("honors valid manual locked adjustments", () => {
    const result = scheduleProductionWork([
      row({ id: "manual", adjustments: { thinning: "2026-10-10", sideShoots: ["2026-10-17", "2026-10-18"] } }),
    ]);
    const thinning = result.items.find((item) => item.planRowId === "manual" && item.type === "thinning");
    const sideShoots = result.items.filter((item) => item.planRowId === "manual" && item.type === "sideShoots");

    expect(thinning?.date).toBe("2026-10-10");
    expect(thinning?.source).toBe("manual");
    expect(thinning?.locked).toBe(true);
    expect(sideShoots.every((item) => item.source === "manual" && item.locked)).toBe(true);
  });

  it("warns on invalid manual adjustments and falls back to a valid automatic date", () => {
    const result = scheduleProductionWork([row({ id: "invalid", adjustments: { thinning: "2026-10-12" } })]);
    const thinning = result.items.find((item) => item.planRowId === "invalid" && item.type === "thinning");

    expect(result.warnings.some((warning) => warning.code === "invalid_manual_adjustment")).toBe(true);
    expect(thinning?.cycleDay).toBeGreaterThanOrEqual(8);
    expect(thinning?.cycleDay).toBeLessThanOrEqual(10);
    expect(thinning?.source).toBe("automatic");
  });

  it("returns a warning instead of violating hard rules when a work window is impossible", () => {
    const result = scheduleProductionWork([row({ id: "impossible", harvestDate: "2026-10-18", cycleLength: 18 })]);

    expect(result.items.some((item) => item.planRowId === "impossible" && item.type === "sideShoots")).toBe(false);
    expect(result.warnings.some((warning) => warning.planRowId === "impossible" && warning.code === "no_valid_window")).toBe(
      true,
    );
  });

  it("warns instead of scheduling sticks before side shoots when ordering is impossible", () => {
    const result = scheduleProductionWork([row({ id: "impossible-order", harvestDate: "2026-10-19", cycleLength: 19 })]);

    expect(result.items.some((item) => item.planRowId === "impossible-order" && item.type === "sideShoots")).toBe(true);
    expect(result.items.some((item) => item.planRowId === "impossible-order" && item.type === "sticks")).toBe(false);
    expect(
      result.warnings.some(
        (warning) =>
          warning.planRowId === "impossible-order" &&
          warning.type === "sticks" &&
          warning.message.includes("pēc pazarēm"),
      ),
    ).toBe(true);
  });
});

function rowsById(rows: SowingPlanRow[]): Map<string, SowingPlanRow> {
  return new Map(rows.map((row) => [row.id, row]));
}

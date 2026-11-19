import { describe, expect, it } from "vitest";
import { plannerConfig } from "./demo-data";
import { buildGreenhouseOccupancyCalendar, buildGreenhouseOccupancyDay } from "./greenhouse-simulation";
import { withHouseThinningPlacement } from "./greenhouse-work-placement";
import { generateWorkItemsForRows } from "./planning";
import type { SowingPlanRow } from "./types";

function hus1(): SowingPlanRow {
  return {
    id: "hus-1", sectorName: "Hus 1", requiredPlants: 4947, extraPlants: 100,
    variety: "Synthetic", sowingDate: "2026-11-10", harvestDate: "2026-12-02",
    cycleLength: 23, sectorType: 39, plantsPerBox: 12, correction: 0, source: "user",
    sowingTables: "A4-A7", placement: { primaryRow: "C", manual: true },
    adjustments: { thinning: "2026-11-19" },
    husEvents: [{
      id: "moving", eventType: "move", eventDate: "2026-11-19",
      location: "A4\nA5\nA6\nA7", destinationLocation: "D1-D4\nD5-D14\nD15-D24\nA14-A23",
      plantChange: -72,
    }],
  };
}

describe("actual placement warnings ignore legacy row estimates", () => {
  it("does not warn about an old C estimate when the HUS 1 card and Moving both show A/D", () => {
    const rows = [hus1()];
    const before = structuredClone(rows);
    const items = withHouseThinningPlacement(generateWorkItemsForRows(rows, plannerConfig), rows, plannerConfig);
    const card = items.find((item) => item.type === "thinning")!;
    const day = buildGreenhouseOccupancyDay(rows, plannerConfig, "2026-11-19");
    expect(card.placement?.label).toBe("Rinda A, D — 34 galdi");
    expect(card.capacityWarning).toBeUndefined();
    expect(day.warnings).toEqual([]);
    expect(day.growing.rows[0]).toMatchObject({
      placementSource: "actual", primaryRow: "D", tables: 34, reservedTables: 36,
      rowLabel: "A14-A23, D1-D24", warnings: [],
    });
    expect(rows).toEqual(before);
  });

  it("keeps seeding and growing reservations identical throughout the cycle regardless of the legacy C field", () => {
    const rows = [hus1()];
    const withoutEstimate = [{ ...rows[0], placement: undefined }];
    const cycle = (input: SowingPlanRow[]) => buildGreenhouseOccupancyCalendar(input, plannerConfig, "2026-11-10", "2026-12-02")
      .map(({ date, seeding, growing }) => ({ date, seeding, growing: {
        ...growing, rows: growing.rows.map((placement) => ({ ...placement, warnings: undefined })),
      } }));
    expect(cycle(rows)).toEqual(cycle(withoutEstimate));
    const planting = buildGreenhouseOccupancyDay(rows, plannerConfig, "2026-12-02");
    expect(planting.growing.rows).toEqual([]);
  });

  it("still reports real table collisions rather than hiding all Moving warnings", () => {
    const first = hus1();
    const other: SowingPlanRow = {
      ...hus1(), id: "other-hus", sectorName: "Other HUS", placement: undefined, sowingTables: "A8",
      husEvents: [{ id: "other-moving", eventType: "move", eventDate: "2026-11-19", location: "A8", destinationLocation: "D4" }],
    };
    const day = buildGreenhouseOccupancyDay([first, other], plannerConfig, "2026-11-19");
    expect(day.growing.overCapacity).toBe(true);
    expect(day.warnings.some((warning) => warning.includes("D4") && warning.includes("augšanas galdu konflikts"))).toBe(true);
    expect(day.warnings.some((warning) => warning.includes("plānotā rinda bija C"))).toBe(false);
  });

  it("retains warnings for incomplete actual destinations without using the old C estimate as a fallback", () => {
    const row = hus1();
    row.husEvents![0].destinationLocation = "D1-D24 unknown";
    const day = buildGreenhouseOccupancyDay([row], plannerConfig, "2026-11-19");
    expect(day.warnings.length).toBeGreaterThan(0);
    expect(day.warnings.some((warning) => warning.includes("plānotā rinda bija C"))).toBe(false);
    expect(day.growing.rows.some((placement) => placement.primaryRow === "C")).toBe(false);
  });
});

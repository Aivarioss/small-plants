import { describe, expect, it, vi } from "vitest";
import { plannerConfig } from "./demo-data";
import {
  buildGreenhouseOccupancyDay,
  GROWING_TABLE_CAPACITY,
  SEEDING_TABLE_CAPACITY,
  simulateSowingDateChange,
} from "./greenhouse-simulation";
import type { SowingPlanRow } from "./types";

const baseRow: SowingPlanRow = {
  id: "hus-9",
  sectorName: "Hus 9",
  greenhouseRequiredPlants: 3564,
  requiredPlants: 3707,
  extraPlants: 100,
  variety: "Baltazsara",
  sowingTables: "A1-A4",
  sowingDate: "2026-10-13",
  harvestDate: "2026-11-04",
  cycleLength: 23,
  sectorType: 26,
  plantsPerBox: 12,
  correction: 0,
  source: "user",
};

describe("greenhouse occupancy and sowing-date simulation", () => {
  it("uses 13 seeding tables and 91 growing tables", () => {
    const snapshot = buildGreenhouseOccupancyDay([baseRow], plannerConfig, "2026-10-13");

    expect(snapshot.seeding.capacity).toBe(SEEDING_TABLE_CAPACITY);
    expect(snapshot.growing.capacity).toBe(GROWING_TABLE_CAPACITY);
  });

  it("simulates moving one Hus 7 days earlier without mutating the original rows", () => {
    const rows = [baseRow, row({ id: "hus-7", sectorName: "Hus 7", sowingDate: "2026-10-06", harvestDate: "2026-10-28" })];
    const before = JSON.stringify(rows);
    const result = simulateSowingDateChange(rows, plannerConfig, "hus-9", "2026-10-06");

    expect(result.currentSowingDate).toBe("2026-10-13");
    expect(result.newSowingDate).toBe("2026-10-06");
    expect(result.newMoveOutDate).toBe("2026-10-28");
    expect(JSON.stringify(rows)).toBe(before);
    expect(result.originalRowsUnchanged).toBe(true);
  });

  it("keeps specific seeding tables occupied through the thinning date and frees them the next day", () => {
    const hus = row({
      adjustments: { thinning: "2026-10-09" },
      id: "hus-a7-a9",
      sectorName: "Hus A7-A9",
      sowingDate: "2026-10-01",
      sowingTables: "A7-A9",
    });

    const thinningDay = buildGreenhouseOccupancyDay([hus], plannerConfig, "2026-10-09");
    const nextDay = buildGreenhouseOccupancyDay([hus], plannerConfig, "2026-10-10");

    expect(thinningDay.seeding.occupiedTableIds).toEqual(["A7", "A8", "A9"]);
    expect(thinningDay.seeding.freeTableIds).not.toContain("A7");
    expect(nextDay.seeding.occupiedTableIds).not.toContain("A7");
    expect(nextDay.seeding.freeTableIds).toEqual(expect.arrayContaining(["A7", "A8", "A9"]));
  });

  it("reports the exact seeding table conflict when two Hus use the same A table on the same date", () => {
    const rows = [
      row({
        adjustments: { thinning: "2026-10-09" },
        id: "hus-left",
        sectorName: "Hus left",
        sowingDate: "2026-10-01",
        sowingTables: "A7-A9",
      }),
      row({
        adjustments: { thinning: "2026-10-10" },
        id: "hus-right",
        sectorName: "Hus right",
        sowingDate: "2026-10-02",
        sowingTables: "A9-A11",
      }),
    ];
    const snapshot = buildGreenhouseOccupancyDay(rows, plannerConfig, "2026-10-05");

    expect(snapshot.seeding.conflicts).toEqual([
      {
        planRowIds: ["hus-left", "hus-right"],
        sectorNames: ["Hus left", "Hus right"],
        table: "A9",
      },
    ]);
    expect(snapshot.warnings.some((warning) => warning.includes("A9") && warning.includes("Hus left") && warning.includes("Hus right"))).toBe(true);
  });

  it("allows two Hus to reuse the same seeding tables when the second starts the day after thinning", () => {
    const rows = [
      row({
        adjustments: { thinning: "2026-10-09" },
        id: "first",
        sectorName: "Hus first",
        sowingDate: "2026-10-01",
        sowingTables: "A7-A9",
      }),
      row({
        adjustments: { thinning: "2026-10-18" },
        id: "second",
        sectorName: "Hus second",
        sowingDate: "2026-10-10",
        sowingTables: "A7-A9",
      }),
    ];
    const handoffDay = buildGreenhouseOccupancyDay(rows, plannerConfig, "2026-10-10");

    expect(handoffDay.seeding.conflicts).toHaveLength(0);
    expect(handoffDay.seeding.rows).toHaveLength(1);
    expect(handoffDay.seeding.rows[0]?.sectorName).toBe("Hus second");
    expect(handoffDay.seeding.occupiedTableIds).toEqual(["A7", "A8", "A9"]);
  });

  it("checks exact seeding tables when a Hus is moved 7 days earlier", () => {
    const rows = [
      row({
        adjustments: { thinning: "2026-10-09" },
        id: "occupying",
        sectorName: "Hus occupying",
        sowingDate: "2026-10-01",
        sowingTables: "A1-A4",
      }),
      baseRow,
    ];
    const result = simulateSowingDateChange(rows, plannerConfig, "hus-9", "2026-10-06");

    expect(result.status).toBe("cannot");
    expect(result.warnings.some((warning) => warning.includes("A1") && warning.includes("Hus occupying") && warning.includes("Hus 9"))).toBe(true);
    expect(result.originalRowsUnchanged).toBe(true);
  });

  it("summarizes several overlapping Hus cycles in growing-table capacity", () => {
    const rows = [0, 1, 2, 3].map((index) =>
      row({
        id: `overlap-${index}`,
        sectorName: `Hus ${index}`,
        placement: { tables: 26, manual: true },
        sowingDate: "2026-10-01",
        harvestDate: "2026-10-23",
        adjustments: { thinning: "2026-10-09" },
      }),
    );
    const snapshot = buildGreenhouseOccupancyDay(rows, plannerConfig, "2026-10-09");

    expect(snapshot.growing.rows).toHaveLength(3);
    expect(snapshot.growing.usedTables).toBe(78);
    expect(snapshot.growing.freeTables).toBe(13);
  });

  it("reserves a full long row when a Hus physically needs 24 of 26 tables", () => {
    const result = simulateSowingDateChange(
      [row({ id: "twenty-four", placement: { tables: 24, manual: true } })],
      plannerConfig,
      "twenty-four",
      "2026-10-13",
    );
    const preferred = result.alternatives[0];

    expect(preferred?.tier).toBe("preferred");
    expect(preferred?.physicalTables).toBe(24);
    expect(preferred?.reservedTables).toBe(26);
    expect(preferred?.wateringZone).toMatch(/[BCD]/);
  });

  it("reserves a long row and the A extra block for a 39-table Hus", () => {
    const result = simulateSowingDateChange(
      [
        row({
          extraPlants: 100,
          id: "large",
          requiredPlants: 6057,
          sectorName: "Hus 7",
          sectorType: 39,
        }),
      ],
      plannerConfig,
      "large",
      "2026-10-13",
    );
    const large = result.alternatives[0];

    expect(large?.usesExtraBlock).toBe(true);
    expect(large?.reservedTables).toBe(39);
    expect(large?.wateringZone).toMatch(/[BCD]/);
  });

  it("offers the A extra block as a compromise for a small Hus when long rows are full", () => {
    const blockers = ["B", "C", "D"].map((primaryRow) =>
      row({
        adjustments: { thinning: "2026-10-01" },
        harvestDate: "2026-11-20",
        id: `busy-${primaryRow}`,
        placement: { primaryRow: primaryRow as "B" | "C" | "D", tables: 26, manual: true },
        requiredPlants: 3707,
        sectorName: `Hus busy ${primaryRow}`,
        sowingDate: "2026-09-20",
      }),
    );
    const small = row({
      extraPlants: 0,
      id: "small-a",
      requiredPlants: 900,
      sectorName: "Hus small",
      sowingDate: "2026-10-13",
      harvestDate: "2026-11-04",
    });
    const result = simulateSowingDateChange([...blockers, small], plannerConfig, "small-a", "2026-10-13");

    expect(result.alternatives[0]?.tier).toBe("compromise");
    expect(result.alternatives[0]?.wateringZone).toBe("A");
    expect(result.alternatives[0]?.usesExtraBlock).toBe(true);
  });

  it("only offers a shared long row as a strained watering-zone option when it physically fits", () => {
    const blockers = ["B", "C", "D"].map((primaryRow) =>
      row({
        adjustments: { thinning: "2026-10-01" },
        harvestDate: "2026-11-20",
        id: `partial-${primaryRow}`,
        placement: { primaryRow: primaryRow as "B" | "C" | "D", tables: 20, manual: true },
        requiredPlants: 3000,
        sectorName: `Hus partial ${primaryRow}`,
        sowingDate: "2026-09-20",
      }),
    );
    const aBlocker = row({
      adjustments: { thinning: "2026-10-01" },
      harvestDate: "2026-11-20",
      id: "a-blocker",
      placement: { primaryRow: "A", tables: 13, manual: true },
      requiredPlants: 900,
      sectorName: "Hus A busy",
      sowingDate: "2026-09-20",
    });
    const tiny = row({
      extraPlants: 0,
      id: "tiny-share",
      requiredPlants: 900,
      sectorName: "Hus tiny",
      sowingDate: "2026-10-13",
      harvestDate: "2026-11-04",
    });
    const result = simulateSowingDateChange([...blockers, aBlocker, tiny], plannerConfig, "tiny-share", "2026-10-13");
    const shared = result.alternatives.find((alternative) => alternative.tier === "strained" && alternative.sharedWith.length > 0);

    expect(shared).toBeDefined();
    expect(shared?.risks.join(" ")).toContain("laistīšanas zona");
    expect(shared?.physicalTables).toBeLessThanOrEqual(6);
  });

  it("classifies day-11 thinning alternatives as strained emergency options", () => {
    const blockers = [
      row({
        adjustments: { thinning: "2026-10-01" },
        harvestDate: "2026-10-11",
        id: "blocker-b",
        placement: { primaryRow: "B", tables: 26, manual: true },
        sectorName: "Hus blocker B",
        sowingDate: "2026-09-20",
      }),
      row({
        adjustments: { thinning: "2026-10-01" },
        harvestDate: "2026-10-11",
        id: "blocker-c",
        placement: { primaryRow: "C", tables: 26, manual: true },
        sectorName: "Hus blocker C",
        sowingDate: "2026-09-20",
      }),
      row({
        adjustments: { thinning: "2026-10-01" },
        harvestDate: "2026-10-11",
        id: "blocker-d",
        placement: { primaryRow: "D", tables: 26, manual: true },
        sectorName: "Hus blocker D",
        sowingDate: "2026-09-20",
      }),
    ];
    const target = row({
      id: "day-eleven",
      requiredPlants: 3707,
      sectorName: "Hus emergency",
      sowingDate: "2026-10-01",
      harvestDate: "2026-10-23",
    });
    const result = simulateSowingDateChange([...blockers, target], plannerConfig, "day-eleven", "2026-10-01");
    const emergency = result.alternatives.find((alternative) => alternative.cycleDay === 11);

    expect(emergency?.tier).toBe("strained");
    expect(emergency?.risks.join(" ")).toContain("11. dienā");
  });

  it("returns deterministic alternatives sorted by production priority", () => {
    const rows = [row({ id: "deterministic", placement: { tables: 24, manual: true } })];
    const first = simulateSowingDateChange(rows, plannerConfig, "deterministic", "2026-10-13").alternatives;
    const second = simulateSowingDateChange(rows, plannerConfig, "deterministic", "2026-10-13").alternatives;

    expect(second).toEqual(first);
    expect(first[0]?.tier).toBe("preferred");
  });

  it("reports insufficient data when seeding-table availability cannot be checked", () => {
    const result = simulateSowingDateChange(
      [{ ...baseRow, sowingTables: undefined }],
      plannerConfig,
      "hus-9",
      "2026-10-06",
    );

    expect(result.status).toBe("insufficientData");
    expect(result.warnings.some((warning) => warning.includes("nav norādīti sēšanas galdi"))).toBe(true);
  });

  it("classifies thinning deadline conflicts as cannot", () => {
    const badManualThinning = row({
      adjustments: { thinning: "2026-11-01" },
      id: "bad-thinning",
      sectorName: "Hus bad",
    });
    const result = simulateSowingDateChange([badManualThinning], plannerConfig, "bad-thinning", "2026-10-13");

    expect(result.status).toBe("cannot");
    expect(result.warnings.some((warning) => warning.includes("ārpus atļautā perioda"))).toBe(true);
  });

  it("keeps the result from being 'can' when the scheduler cannot provide a thinning date", async () => {
    vi.resetModules();
    vi.doMock("./scheduler", () => ({
      scheduleProductionWork: () => ({ items: [], warnings: [] }),
    }));
    const { buildGreenhouseOccupancyDay: buildWithMissingSchedule } = await import("./greenhouse-simulation");
    const snapshot = buildWithMissingSchedule(
      [
        row({
          id: "early",
          sectorName: "Hus early",
          sowingDate: "2026-10-01",
          sowingTables: "A1-A3",
        }),
      ],
      plannerConfig,
      "2026-10-03",
    );
    vi.doUnmock("./scheduler");
    vi.resetModules();

    expect(snapshot.seeding.incomplete).toBe(true);
    expect(snapshot.seeding.unknownRows).toEqual([
      { planRowId: "early", reason: "unknownRelease", sectorName: "Hus early" },
    ]);
  });
});

function row(patch: Partial<SowingPlanRow>): SowingPlanRow {
  return {
    ...baseRow,
    id: patch.id ?? baseRow.id,
    sectorName: patch.sectorName ?? baseRow.sectorName,
    ...patch,
  };
}

import { describe, expect, it, vi } from "vitest";
import { plannerConfig } from "./demo-data";
import {
  buildGreenhouseOccupancyDay,
  GROWING_TABLE_CAPACITY,
  interpretHusMovingEventPlacement,
  SEEDING_TABLE_CAPACITY,
  simulateSowingDateChange,
} from "./greenhouse-simulation";
import { localTodayIso } from "./planning";
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

  it("uses the local timezone date for today's greenhouse defaults", () => {
    const localMidnight = new Date(2026, 0, 1, 0, 30);

    expect(localTodayIso(localMidnight)).toBe("2026-01-01");
  });

  it("simulates moving one Hus 7 days earlier without mutating the original rows", () => {
    const rows = [baseRow, row({ id: "hus-7", sectorName: "Hus 7", sowingDate: "2026-10-06", harvestDate: "2026-10-28" })];
    const before = JSON.stringify(rows);
    const result = simulateSowingDateChange(rows, plannerConfig, "hus-9", "2026-10-06");

    expect(result.currentSowingDate).toBe("2026-10-13");
    expect(result.newSowingDate).toBe("2026-10-06");
    expect(result.newMoveOutDate).toBe("2026-11-04");
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

  it("interprets Moving rows as concrete growing table ranges", () => {
    const interpreted = interpretHusMovingEventPlacement({
      id: "move-h4",
      eventDate: "2026-10-01",
      eventType: "move",
      location: "A11\nA12\nA13",
      destinationLocation: "B1-B10\nB11-B20\nB21-B26",
    });

    expect(interpreted?.tableIds).toEqual(Array.from({ length: 26 }, (_, index) => `B${index + 1}`));
    expect(interpreted?.warnings).toEqual([]);
  });

  it("uses actual Moving placement before the planned greenhouse placement", () => {
    const hus4 = row({
      adjustments: { thinning: "2026-10-01" },
      id: "actual-h4",
      placement: { primaryRow: "C", tables: 26, manual: true },
      sectorName: "Hus 4",
      sowingDate: "2026-09-22",
      harvestDate: "2026-10-14",
      husEvents: [
        {
          id: "move-h4",
          eventDate: "2026-10-01",
          eventType: "move",
          location: "A11\nA12\nA13",
          destinationLocation: "B1-B10\nB11-B20\nB21-B26",
        },
      ],
    });

    const snapshot = buildGreenhouseOccupancyDay([hus4], plannerConfig, "2026-10-02");
    const actual = snapshot.growing.rows[0];

    expect(actual?.placementSource).toBe("actual");
    expect(actual?.rowLabel).toBe("B1-B26");
    expect(actual?.tables).toBe(26);
    expect(actual?.reservedTables).toBe(26);
    expect(snapshot.warnings.some((warning) => warning.includes("plānotā rinda bija C"))).toBe(true);
  });

  it("reserves a whole long row when actual Moving uses only 24 of 26 tables", () => {
    const hus5 = row({
      adjustments: { thinning: "2026-10-03" },
      id: "actual-h5",
      sectorName: "Hus 5",
      sowingDate: "2026-09-24",
      harvestDate: "2026-10-16",
      husEvents: [
        {
          id: "move-h5",
          eventDate: "2026-10-03",
          eventType: "move",
          location: "A8\nA9\nA10",
          destinationLocation: "D1-D9\nD10-D19\nD20-D24",
        },
      ],
    });

    const snapshot = buildGreenhouseOccupancyDay([hus5], plannerConfig, "2026-10-04");
    const actual = snapshot.growing.rows[0];

    expect(actual?.placementSource).toBe("actual");
    expect(actual?.rowLabel).toBe("D1-D24");
    expect(actual?.tables).toBe(24);
    expect(actual?.reservedTables).toBe(26);
    expect(snapshot.growing.physicalUsedTables).toBe(24);
    expect(snapshot.growing.usedTables).toBe(26);
    expect(snapshot.growing.freeTables).toBe(65);
  });

  it("applies multiple Moving records as partial repeated movement without treating each one as a full Hus move", () => {
    const moved = row({
      adjustments: { thinning: "2026-10-01" },
      id: "multi-moving",
      sectorName: "Hus moving",
      sowingDate: "2026-09-22",
      harvestDate: "2026-10-14",
      husEvents: [
        {
          id: "first-move",
          eventDate: "2026-10-01",
          eventType: "move",
          location: "A1",
          destinationLocation: "B1-B5",
        },
        {
          id: "second-move",
          eventDate: "2026-10-05",
          eventType: "move",
          location: "B1-B5",
          destinationLocation: "C1-C5",
        },
      ],
    });

    const beforeSecondMove = buildGreenhouseOccupancyDay([moved], plannerConfig, "2026-10-03");
    const afterSecondMove = buildGreenhouseOccupancyDay([moved], plannerConfig, "2026-10-06");

    expect(beforeSecondMove.growing.rows[0]?.rowLabel).toBe("B1-B5");
    expect(afterSecondMove.growing.rows[0]?.rowLabel).toBe("C1-C5");
  });

  it("uses only Moving records up to the selected date and frees growing tables on Planting day", () => {
    const moved = row({
      adjustments: { thinning: "2026-10-01" },
      id: "dated-moving",
      sectorName: "Hus dated",
      sowingDate: "2026-09-22",
      harvestDate: "2026-10-14",
      husEvents: [
        {
          id: "first-move",
          eventDate: "2026-10-01",
          eventType: "move",
          location: "A1",
          destinationLocation: "B1-B5",
        },
        {
          id: "future-move",
          eventDate: "2026-10-10",
          eventType: "move",
          location: "B1-B5",
          destinationLocation: "C1-C5",
        },
      ],
    });

    const beforeFutureMove = buildGreenhouseOccupancyDay([moved], plannerConfig, "2026-10-09");
    const afterFutureMove = buildGreenhouseOccupancyDay([moved], plannerConfig, "2026-10-10");
    const plantingDay = buildGreenhouseOccupancyDay([moved], plannerConfig, "2026-10-14");

    expect(beforeFutureMove.growing.rows[0]?.rowLabel).toBe("B1-B5");
    expect(afterFutureMove.growing.rows[0]?.rowLabel).toBe("C1-C5");
    expect(plantingDay.growing.rows).toHaveLength(0);
    expect(plantingDay.growing.usedTables).toBe(0);
    expect(plantingDay.growing.freeTables).toBe(GROWING_TABLE_CAPACITY);
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
          sowingTables: "A1-A5",
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

  it("checks seeding capacity instead of reporting missing numbers for an unassigned target", () => {
    const result = simulateSowingDateChange(
      [{ ...baseRow, sowingTables: undefined }],
      plannerConfig,
      "hus-9",
      "2026-10-06",
    );

    expect(result.status).toBe("can");
    expect(result.recommendation?.seedingTableCount).toBe(3);
    expect(result.recommendation?.seedingTables).toEqual([]);
    expect(result.warnings.some((warning) => warning.includes("nav norādīti sēšanas galdi"))).toBe(false);
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

import { buildArchiveSnapshot } from "./hus-archive";
import { describe, expect, it } from "vitest";
import { generateWorkItemsForRows } from "./planning";
import { plannerConfig } from "./demo-data";
import { withHouseThinningPlacement } from "./greenhouse-work-placement";
import { buildGreenhouseOccupancyCalendar } from "./greenhouse-simulation";
import { buildCalendarHistory } from "./calendar-history";
import type { SowingPlanRow } from "./types";

function fixture(): SowingPlanRow {
  return {
    id: "hus-1", sectorName: "Hus 1", requiredPlants: 4947, extraPlants: 100, variety: "Synthetic",
    sowingDate: "2026-11-10", harvestDate: "2026-12-02", cycleLength: 23, sectorType: 39,
    plantsPerBox: 12, correction: 0, source: "user", placement: { primaryRow: "C", manual: true },
    adjustments: { thinning: "2026-11-19" },
    husEvents: [{ id: "moving", eventType: "move", eventDate: "2026-11-19",
      location: "A4\nA5\nA6\nA7", destinationLocation: "D1-D4\nD5-D14\nD15-D24\nA14-A23",
      plantChange: -72, plantCorrectionId: "loss" }],
    plantCorrections: [{ id: "loss", date: "2026-11-19", reason: "thinning", amount: -72 }],
  };
}
const archivedAt = "2026-12-03T12:00:00.000Z";

describe("new archive worksheet placement", () => {
  it("freezes the same actual A/D placement as the active card, without changing Moving or reservations", () => {
    const row = fixture(), rows = [row], before = structuredClone(rows);
    const occupancy = buildGreenhouseOccupancyCalendar(rows, plannerConfig);
    const active = withHouseThinningPlacement(generateWorkItemsForRows(rows, plannerConfig), rows, plannerConfig);
    const snapshot = buildArchiveSnapshot(row, rows, plannerConfig, archivedAt);
    const thinning = snapshot.workItems.find(item => item.type === "thinning")!;
    expect(thinning).toEqual(active.find(item => item.type === "thinning"));
    expect(thinning.placement).toMatchObject({ label: "Rinda A, D — 34 galdi", rowIds: ["A", "D"], tables: 34 });
    expect(snapshot.materials.thinning).toContain("Rinda A, D — 34 galdi");
    expect(snapshot.events).toEqual(row.husEvents);
    expect(snapshot.plantCorrections).toEqual(row.plantCorrections);
    expect(snapshot.tablePlacement).toEqual(row.placement); // Original saved planning metadata remains history.
    expect(rows).toEqual(before);
    expect(buildGreenhouseOccupancyCalendar(rows, plannerConfig)).toEqual(occupancy);
  });

  it("uses the same automatic placement for a future HUS while preserving work dates and other HUS", () => {
    const row = fixture(); row.husEvents = []; row.plantCorrections = [];
    const other = { ...fixture(), id: "other", sectorName: "Other HUS", sowingDate: "2027-01-10", harvestDate: "2027-02-01",
      adjustments: { thinning: "2027-01-19" }, husEvents: [], plantCorrections: [] };
    const rows = [row, other], before = structuredClone(rows);
    const items = withHouseThinningPlacement(generateWorkItemsForRows(rows, plannerConfig), rows, plannerConfig);
    const snapshot = buildArchiveSnapshot(row, rows, plannerConfig, archivedAt);
    expect(snapshot.workItems).toEqual(items.filter(item => item.planRowId === row.id));
    expect(snapshot.workItems.every(item => item.planRowId === row.id)).toBe(true);
    expect(rows).toEqual(before);
  });

  it("does not substitute the old C estimate when an actual destination is unknown", () => {
    const row = fixture(); row.husEvents![0].destinationLocation = "unknown";
    const snapshot = buildArchiveSnapshot(row, [row], plannerConfig, archivedAt);
    expect(snapshot.workItems.find(item => item.type === "thinning")?.placement).toMatchObject({
      rowIds: [], tables: 0, label: "Vieta nav zināma — — galdi",
    });
    expect(snapshot.workItems.find(item => item.type === "thinning")?.placement?.primaryRow).toBeUndefined();
    expect(snapshot.materials.thinning).toContain("Vieta nav zināma");
  });

  it("leaves an existing frozen archive and its calendar history unchanged", () => {
    const row = fixture();
    const old = buildArchiveSnapshot(row, [row], plannerConfig, archivedAt, "Original archive");
    old.workItems.find(item => item.type === "thinning")!.placement!.label = "Rinda C — 31 galdi";
    old.materials.thinning = "Original historical summary";
    const archived = { ...row, archivedAt, archiveSnapshot: old };
    const before = structuredClone(archived);
    const history = buildCalendarHistory([], [], [archived], "2027-01-01");
    const result = buildArchiveSnapshot(archived, [archived], plannerConfig, "2027-02-01T12:00:00Z", "Do not replace history");
    expect(result).toEqual(old);
    expect(result).not.toBe(old);
    expect(archived).toEqual(before);
    expect(buildCalendarHistory([], [], [archived], "2027-01-01")).toEqual(history);
  });

  it("makes an independent snapshot copy, including actual placement and event/correction history", () => {
    const row = fixture();
    const snapshot = buildArchiveSnapshot(row, [row], plannerConfig, archivedAt);
    const before = structuredClone(snapshot);
    row.husEvents![0].destinationLocation = "B1-B24";
    row.plantCorrections![0].amount = -1;
    row.placement!.primaryRow = "B";
    expect(snapshot).toEqual(before);
  });
});

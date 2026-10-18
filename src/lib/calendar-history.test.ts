import { describe, expect, it } from "vitest";
import { buildCalendarHistory } from "./calendar-history";
import { plannerConfig } from "./demo-data";
import { buildGreenhouseOccupancyDay } from "./greenhouse-simulation";
import { buildArchiveSnapshot, generateWorkItemsForRows } from "./planning";
import type { SowingPlanRow } from "./types";

const today = "2026-10-18";
const row: SowingPlanRow = {
  id: "old-cycle", sectorName: "Hus 4", requiredPlants: 3400, extraPlants: 144,
  variety: "Baltazsara", sowingDate: "2026-09-22", harvestDate: "2026-10-14",
  cycleLength: 23, sectorType: 26, plantsPerBox: 30, correction: 0,
};

function archivedCycle(): SowingPlanRow {
  const archivedAt = "2026-10-15T12:00:00Z";
  return { ...row, archivedAt, archiveSnapshot: buildArchiveSnapshot(row, [row], plannerConfig, archivedAt) };
}

function freezeDeep<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.values(value).forEach(freezeDeep);
    Object.freeze(value);
  }
  return value;
}

describe("calendar archive history", () => {
  it("merges frozen archive work and active work without rescheduling historical dates", () => {
    const archived = archivedCycle();
    const snapshot = archived.archiveSnapshot!;
    snapshot.workItems[0] = { ...snapshot.workItems[0], date: "2026-09-24", details: ["Saglabāts apraksts"] };
    const active = { ...row, id: "new-cycle", sowingDate: "2026-10-20", harvestDate: "2026-11-11" };
    const activeItems = generateWorkItemsForRows([active], plannerConfig);
    const result = buildCalendarHistory(activeItems, [active], [archived], today);
    expect(result.items).toHaveLength(activeItems.length + snapshot.workItems.length);
    expect(result.items.filter((item) => item.calendarArchived).map(({ calendarKey, calendarReadOnly, calendarArchived, ...item }) => {
      expect(calendarKey).toContain("archive:old-cycle:");
      expect(calendarReadOnly).toBe(true);
      expect(calendarArchived).toBe(true);
      return item;
    })).toEqual(snapshot.workItems.slice().sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)));
    expect(result.missingHistoryRows).toEqual([]);
  });

  it("separates cycles with the same HUS name and even matching work IDs", () => {
    const archived = archivedCycle();
    const active = { ...row, id: "new-cycle", requiredPlants: 2000 };
    const activeItem = { ...archived.archiveSnapshot!.workItems[0], planRowId: active.id, plantCount: 2000 };
    const result = buildCalendarHistory([activeItem], [active], [archived], today);
    expect(new Set(result.items.map((item) => item.calendarKey)).size).toBe(result.items.length);
    expect(result.rows.find((entry) => entry.id === "old-cycle")?.requiredPlants).toBe(3400);
    expect(result.rows.find((entry) => entry.id === "new-cycle")?.requiredPlants).toBe(2000);
    expect(result.items.filter((item) => item.planRowId === "old-cycle").every((item) => item.calendarArchived)).toBe(true);
  });

  it("makes all archive work and past active work read-only, leaving today's and future active work editable", () => {
    const archived = archivedCycle();
    const active = { ...row, id: "new-cycle" };
    const source = archived.archiveSnapshot!.workItems[0];
    archived.archiveSnapshot!.workItems = [{ ...source, date: "2026-12-01" }];
    const activeItems = ["2026-10-17", today, "2026-10-19"].map((date) => ({ ...source, id: date, planRowId: active.id, date }));
    const result = buildCalendarHistory(activeItems, [active], [archived], today);
    expect(result.items.filter((item) => !item.calendarArchived).map((item) => item.calendarReadOnly)).toEqual([true, false, false]);
    expect(result.items.find((item) => item.calendarArchived)?.calendarReadOnly).toBe(true);
  });

  it("uses snapshot cycle data for archived details and printing even when the outer row differs", () => {
    const archived = { ...archivedCycle(), sowingDate: "2030-01-01", requiredPlants: 9999 };
    const result = buildCalendarHistory([], [], [archived], today);
    expect(result.rows[0].sowingDate).toBe("2026-09-22");
    expect(result.rows[0].requiredPlants).toBe(3400);
  });

  it("does not invent history for missing snapshots or attach another cycle's work", () => {
    const missing = { ...row, id: "legacy", archivedAt: today };
    const wrongOwner = archivedCycle();
    wrongOwner.archiveSnapshot!.workItems = [{ ...wrongOwner.archiveSnapshot!.workItems[0], planRowId: "other-cycle" }];
    const result = buildCalendarHistory([], [], [missing, wrongOwner], today);
    expect(result.items).toEqual([]);
    expect(result.missingHistoryRows.map((entry) => entry.id)).toEqual(["legacy", "old-cycle"]);
  });

  it("avoids duplicate work during restore and duplicate archive responses", () => {
    const archived = archivedCycle();
    const result = buildCalendarHistory(generateWorkItemsForRows([row], plannerConfig), [row], [archived, archived], today);
    expect(result.items.every((item) => !item.calendarArchived)).toBe(true);
    expect(result.rows).toHaveLength(1);
    const archiveOnly = buildCalendarHistory([], [], [archived, archived], today);
    expect(archiveOnly.items).toHaveLength(archived.archiveSnapshot!.workItems.length);
  });

  it("does not mutate frozen archive data, active scheduling or physical occupancy", () => {
    const active = { ...row, id: "active", sowingDate: "2026-10-20", harvestDate: "2026-11-11" };
    const archived = freezeDeep(archivedCycle());
    const activeRows = freezeDeep([active]);
    const items = freezeDeep(generateWorkItemsForRows(activeRows, plannerConfig));
    const before = JSON.stringify({ activeRows, archived, items });
    const occupancy = buildGreenhouseOccupancyDay(activeRows, plannerConfig, "2026-11-01");
    buildCalendarHistory(items, activeRows, [archived], today);
    expect(JSON.stringify({ activeRows, archived, items })).toBe(before);
    expect(generateWorkItemsForRows(activeRows, plannerConfig)).toEqual(items);
    expect(buildGreenhouseOccupancyDay(activeRows, plannerConfig, "2026-11-01")).toEqual(occupancy);
  });
});

import { describe, expect, it, vi } from "vitest";
import { buildGreenhouseRootStatistics, rankedRootTables, statisticsTableIds } from "./greenhouse-statistics";
import { buildArchiveSnapshot } from "./planning";
import { plannerConfig } from "./demo-data";
import type { HusEventEntry, HusPhotoEntry, SowingPlanRow } from "./types";

const period = { end: "2026-10-31" };
function moving(id: string, from = "A7", to = "C1–C10", date = "2026-10-08"): HusEventEntry {
  return { id, eventType: "move", eventDate: date, location: from, destinationLocation: to };
}
function root(id: string, location = "C7", date = "2026-10-14", loss?: number): HusEventEntry {
  return { id, eventType: "brownRoots", eventDate: date, location, plantChange: loss === undefined ? undefined : -loss };
}
function row(id = "cycle-1", events: HusEventEntry[] = [moving("move"), root("root", "C7", "2026-10-14", 4)]): SowingPlanRow {
  return { id, sectorName: "Hus 4", sowingDate: "2026-10-01", harvestDate: "2026-10-23", cycleLength: 23,
    requiredPlants: 3400, extraPlants: 100, variety: "Synthetic", sectorType: 26, plantsPerBox: 30, correction: 0,
    source: "user", husEvents: events };
}
function photo(id: string, rowId: string, eventId: string): HusPhotoEntry {
  return { id, sowingPlanRowId: rowId, husEventId: eventId, storageBucket: "private", storagePath: `hus/${rowId}/${id}.jpg`,
    originalFileName: `${id}.jpg`, contentType: "image/jpeg", fileSizeBytes: 1 };
}

describe("whole-house root statistics", () => {
  it("traces a growing table through actual Moving, without using planned placement", () => {
    const data = row(); data.sowingTables = "A1"; data.placement = { primaryRow: "D", tables: 24, manual: true };
    const result = buildGreenhouseRootStatistics([data], [], period);
    expect(result.observations[0]).toMatchObject({ sources: ["A7"], origin: "known", tables: ["C7"], loss: 4 });
    expect(result.tables.find((table) => table.table === "A7")).toMatchObject({ affectedCycles: 1, usageCycles: 1, loss: 4 });
    expect(result.tables.find((table) => table.table === "A1")?.observations).toHaveLength(0);
  });

  it("combines active and frozen archived cycles, distinguishing identical HUS names and avoiding restored duplicates", () => {
    const archived = row("old");
    archived.archiveSnapshot = buildArchiveSnapshot(archived, [archived], plannerConfig, "2026-10-24T00:00:00Z");
    archived.archivedAt = archived.archiveSnapshot.archivedAt;
    archived.husEvents = [root("changed", "D1", "2026-10-14", 99)];
    const active = row("new");
    const before = structuredClone([active, archived]);
    const result = buildGreenhouseRootStatistics([active], [archived, archived], period);
    expect(result.observationCount).toBe(2);
    expect(result.loss).toBe(8);
    expect(result.tables.find((table) => table.table === "C7")).toMatchObject({ affectedCycles: 2, usageCycles: 2 });
    expect(result.recurringGrowingTables).toBe(1);
    expect([active, archived]).toEqual(before);
    expect(buildGreenhouseRootStatistics([active], [{ ...active, archivedAt: "2026-10-24" }], period).observationCount).toBe(1);
  });

  it("counts linked corrections once and retains older unlinked root losses with unknown location", () => {
    const data = row(); data.husEvents![1].plantCorrectionId = "linked";
    data.plantCorrections = [
      { id: "linked", date: "2026-10-14", amount: -4, reason: "brownRoots" },
      { id: "legacy", date: "2026-10-15", amount: -6, reason: "brownRoots", note: "C8 mentioned in prose" },
      { id: "other", date: "2026-10-15", amount: -100, reason: "thinning" },
    ];
    const result = buildGreenhouseRootStatistics([data], [], period);
    expect(result.observationCount).toBe(2); expect(result.loss).toBe(10);
    expect(result.legacyRecords).toBe(1); expect(result.unknownLocationRecords).toBe(1);
    expect(result.observations.find((entry) => entry.kind === "correction")?.tables).toEqual([]);
  });

  it("does not infer disease or healthy checks from free notes or unrelated events", () => {
    const data = row("notes", [moving("m"), { id: "other", eventType: "other", eventDate: "2026-10-14", note: "0 Brown roots" }]);
    data.husNotes = [{ id: "n", sowingPlanRowId: data.id, note: "brūnās saknes C7", observationDate: "2026-10-14" }];
    const result = buildGreenhouseRootStatistics([data], [], period);
    expect(result.observationCount).toBe(0);
    expect(result.tables.find((table) => table.table === "C7")).toMatchObject({ usageCycles: 1, affectedCycles: 0 });
    expect(result.tables.find((table) => table.table === "D1")?.usageCycles).toBe(0);
  });

  it("keeps several possible A sources ambiguous instead of distributing plants or counts to each A table", () => {
    const result = buildGreenhouseRootStatistics([row("mixed", [moving("m", "A5–A7"), root("r", "C7", "2026-10-14", 9)])], [], period);
    expect(result.observations[0]).toMatchObject({ sources: ["A5", "A6", "A7"], origin: "ambiguous" });
    for (const id of ["A5", "A6", "A7"]) {
      const table = result.tables.find((table) => table.table === id)!;
      expect(table.observations).toHaveLength(0); expect(table.possibleObservations).toHaveLength(1); expect(table.loss).toBe(0);
    }
    expect(rankedRootTables(result.tables, "seeding")).toEqual([]);
  });

  it("does not multiply a range's loss across growing tables", () => {
    const result = buildGreenhouseRootStatistics([row("range", [moving("m"), root("r", "C7–C8", "2026-10-14", 10)])], [], period);
    expect(result.loss).toBe(10); expect(result.observationCount).toBe(1); expect(result.affectedGrowingTables).toBe(0);
    expect(result.rangeLocationRecords).toBe(1);
    expect(result.tables.find((table) => table.table === "C7")).toMatchObject({ loss: 0, unallocatedLossRecords: 1 });
    expect(result.tables.find((table) => table.table === "C7")?.possibleObservations).toHaveLength(1);
    expect(result.tables.find((table) => table.table === "C8")).toMatchObject({ loss: 0, unallocatedLossRecords: 1 });
    expect(result.tables.find((table) => table.table === "A7")?.loss).toBe(10);
  });

  it("traces further actual moves and ignores later movement when evaluating an earlier observation", () => {
    const data = row("chain", [moving("m"), moving("again", "C7", "D1", "2026-10-12"),
      root("r", "D1", "2026-10-14", 2), moving("future", "A8", "D1", "2026-10-16"), root("vacated", "C7", "2026-10-15")]);
    const result = buildGreenhouseRootStatistics([data], [], period);
    expect(result.observations.find((entry) => entry.id.endsWith(":r"))).toMatchObject({ origin: "known", sources: ["A7"] });
    expect(result.observations.find((entry) => entry.id.endsWith(":vacated"))?.origin).toBe("unknown");
  });

  it("does not guess the ordering of different movements and observations on the same day", () => {
    const entries = [moving("m"), moving("out", "C7", "D1", "2026-10-14"), moving("in", "A8", "C7", "2026-10-14"), root("r")];
    const first = buildGreenhouseRootStatistics([row("same-day", entries)], [], period);
    const reordered = buildGreenhouseRootStatistics([row("same-day", [...entries].reverse())], [], period);
    expect(first.observations[0]).toMatchObject({ origin: "ambiguous", sources: ["A7", "A8"] });
    expect(reordered).toEqual(first);
  });

  it("does not treat repeated observations of one production cycle as recurrence in several cycles", () => {
    const result = buildGreenhouseRootStatistics([row("repeated", [moving("m"), root("a"), root("b", "C7", "2026-10-15")])], [], period);
    expect(result.tables.find((table) => table.table === "C7")).toMatchObject({ affectedCycles: 1, usageCycles: 1 });
    expect(result.tables.find((table) => table.table === "C7")?.observations).toHaveLength(2);
    expect(result.recurringGrowingTables).toBe(0);
  });

  it("keeps unspecified loss distinct from an explicit zero", () => {
    const data = row("loss", [root("missing"), root("zero", "D1", "2026-10-15", 0)]);
    const result = buildGreenhouseRootStatistics([data], [], period);
    expect(result.unknownLossRecords).toBe(1); expect(result.loss).toBe(0);
  });

  it("uses earlier Moving for observations and ongoing table use inside an inclusive date range", () => {
    const data = row();
    const result = buildGreenhouseRootStatistics([data], [], { start: "2026-10-14", end: "2026-10-14" });
    expect(result.observationCount).toBe(1);
    expect(result.observations[0].sources).toEqual(["A7"]);
    expect(result.tables.find((table) => table.table === "C7")?.usageCycles).toBe(1);
    expect(result.tables.find((table) => table.table === "A7")?.usageCycles).toBe(1);
    const released = buildGreenhouseRootStatistics([data], [], { start: "2026-10-23", end: "2026-10-25" });
    expect(released.tables.find((table) => table.table === "C7")?.usageCycles).toBe(0);
    expect(released.observationCount).toBe(0);
  });

  it("does not use future Moving or claim missing numbers are planned physical assignments", () => {
    const data = row("future", [moving("m", "A7", "C7", "2026-10-16"), root("r")]);
    data.sowingTables = "A7";
    const result = buildGreenhouseRootStatistics([data], [], { end: "2026-10-14" });
    expect(result.observations[0].origin).toBe("unknown");
    expect(result.tables.find((table) => table.table === "A7")?.usageCycles).toBe(0);
  });

  it("counts a direct observation on a seeding table without inventing a Moving", () => {
    const result = buildGreenhouseRootStatistics([row("seed", [root("r", "A3", "2026-10-03", 1)])], [], period);
    expect(result.observations[0]).toMatchObject({ origin: "known", sources: ["A3"] });
    expect(result.tables.find((table) => table.table === "A3")).toMatchObject({ affectedCycles: 1, usageCycles: 1, loss: 1 });
  });

  it("uses only live photos belonging to the exact cycle and event", () => {
    const data = row();
    data.husPhotos = [photo("own", data.id, "root"), photo("foreign", "other", "root"), photo("wrong-event", data.id, "move")];
    data.archiveSnapshot = buildArchiveSnapshot(data, [data], plannerConfig, "2026-10-24");
    data.archiveSnapshot.photos = [photo("deleted", data.id, "root")]; data.archivedAt = "2026-10-24";
    expect(buildGreenhouseRootStatistics([], [data], period).observations[0].photos.map((photo) => photo.id)).toEqual(["own"]);
  });

  it.each(["C27", "B0", "C7 prose", "C7, A99", "A13-B1"])("retains unparseable locations without assigning them: %s", (location) => {
    const result = buildGreenhouseRootStatistics([row("bad", [root("r", location)])], [], period);
    expect(result.observationCount).toBe(1); expect(result.unknownLocationRecords).toBe(1);
    expect(result.affectedGrowingTables).toBe(0);
  });

  it.each([
    { start: "2026-11-01", end: "2026-10-01" }, { end: "2026-02-30" }, { start: "bad", end: "2026-10-01" },
  ])("rejects invalid periods", (range) => expect(() => buildGreenhouseRootStatistics([], [], range)).toThrow());

  it("does not write to the database, network, or localStorage", () => {
    const fetch = vi.fn(); const write = vi.fn();
    vi.stubGlobal("fetch", fetch); vi.stubGlobal("localStorage", { setItem: write });
    try { buildGreenhouseRootStatistics([row()], [], period); expect(fetch).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled(); }
    finally { vi.unstubAllGlobals(); }
  });

  it("parses physical table lists and ranges without accepting out-of-house addresses", () => {
    expect(statisticsTableIds("a1–A3; C7, A14-A15")).toEqual(["A1", "A2", "A3", "A14", "A15", "C7"]);
    expect(statisticsTableIds("C7—C5")).toEqual(["C5", "C6", "C7"]);
    expect(statisticsTableIds("A27")).toEqual([]);
  });
});

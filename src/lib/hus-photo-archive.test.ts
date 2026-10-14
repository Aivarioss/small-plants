import { describe, expect, it } from "vitest";
import { demoPlanRows, plannerConfig } from "./demo-data";
import { buildArchiveSnapshot } from "./planning";
import {
  buildPhotoArchive, filterPhotoArchive, husPhotoFileUrl, noteToPhotoDetails,
  photoArchiveHusTarget, photoDetailsToNote, validatePhotoDetails,
} from "./hus-photo-archive";
import type { HusPhotoEntry, SowingPlanRow } from "./types";

function photo(id: string, rowId: string, target: Partial<HusPhotoEntry> = {}): HusPhotoEntry {
  return { id, sowingPlanRowId: rowId, storageBucket: "small-plants-hus-photos",
    storagePath: `hus/${rowId}/${id}.jpg`, originalFileName: `${id}.jpg`, contentType: "image/jpeg",
    fileSizeBytes: 4, createdAt: "2026-10-14T08:00:00Z", ...target };
}
function fixtures(): [SowingPlanRow, SowingPlanRow] {
  const active: SowingPlanRow = { ...demoPlanRows[0], id: "active", sectorName: "HUS 4",
    husEvents: [{ id: "event", eventDate: "2026-10-14", eventType: "brownRoots", note: "Brūnās saknes", location: "C7" }],
    husNotes: [{ id: "blank", sowingPlanRowId: "active" }],
    husPhotos: [photo("new", "active", { husEventId: "event" }), photo("blank", "active", { husNoteId: "blank", createdAt: undefined })] };
  const archived: SowingPlanRow = { ...demoPlanRows[1], id: "archived", sectorName: "HUS 4",
    archivedAt: "2026-10-12T08:00:00Z",
    husNotes: [{ id: "note", sowingPlanRowId: "archived", observationDate: "2026-10-10", note: "Veselas saknes\n\nGalds: C7–C10" }],
    husPhotos: [photo("old", "archived", { husNoteId: "note" })] };
  return [active, archived];
}

describe("shared HUS photo archive", () => {
  it("combines active and archived photos, keeping blank photos and newest first", () => {
    const [active, archived] = fixtures();
    const entries = buildPhotoArchive([active], [archived]);
    expect(entries.map((entry) => entry.photo.id)).toEqual(["new", "old", "blank"]);
    expect(entries[0]).toMatchObject({ date: "2026-10-14", description: "Brūnās saknes", location: "C7", archived: false });
    expect(entries[1]).toMatchObject({ date: "2026-10-10", description: "Veselas saknes", location: "C7–C10", archived: true });
    expect(entries[2]).toMatchObject({ description: undefined, location: undefined, date: undefined });
  });

  it.each(["HUS 4", "brūn", "brun", "sak", "c7", "14.10.2026", "2026-10-14", "14.10", "HUS 4 brūn C7"])("searches partial text and date: %s", (query) => {
    const [active, archived] = fixtures();
    expect(filterPhotoArchive(buildPhotoArchive([active], [archived]), query, "all").some((entry) => entry.photo.id === "new")).toBe(true);
  });

  it("combines text search with all three status filters", () => {
    const [active, archived] = fixtures();
    const entries = buildPhotoArchive([active], [archived]);
    expect(filterPhotoArchive(entries, "", "all")).toHaveLength(3);
    expect(filterPhotoArchive(entries, "", "active")).toHaveLength(2);
    expect(filterPhotoArchive(entries, "sak", "archived").map((entry) => entry.photo.id)).toEqual(["old"]);
    expect(filterPhotoArchive(entries, "unknown", "all")).toEqual([]);
  });

  it("links identical HUS numbers in different cycles to their precise records", () => {
    const [active, archived] = fixtures();
    const entries = buildPhotoArchive([active], [archived]);
    expect(photoArchiveHusTarget(entries[0])).toEqual({ rowId: "active", mode: "active" });
    expect(photoArchiveHusTarget(entries[1])).toEqual({ rowId: "archived", mode: "archive" });
    expect(entries[1].photo.storagePath).toBe(archived.husPhotos![0].storagePath);
    expect(husPhotoFileUrl(entries[1].photo)).toMatch(/^\/api\/hus-media\/photo\/old\?/);
  });

  it("uses frozen event metadata and live new notes without mutating an archived snapshot", () => {
    const [active] = fixtures();
    const snapshot = buildArchiveSnapshot(active, [], plannerConfig, "2026-10-14T09:00:00Z");
    const before = JSON.stringify(snapshot);
    const archived: SowingPlanRow = { ...active, archiveSnapshot: snapshot, archivedAt: snapshot.archivedAt,
      husEvents: [{ ...active.husEvents![0], note: "Changed live event", location: "D1" }],
      husNotes: [{ id: "later", sowingPlanRowId: active.id, observationDate: "2026-10-15", note: "Jauna piezīme" }],
      husPhotos: [active.husPhotos![0], photo("later", active.id, { husNoteId: "later" })] };
    const entries = buildPhotoArchive([], [archived]);
    expect(entries[0]).toMatchObject({ description: "Jauna piezīme", date: "2026-10-15" });
    expect(entries[1]).toMatchObject({ description: "Brūnās saknes", location: "C7" });
    expect(JSON.stringify(snapshot)).toBe(before);
  });

  it("does not resurrect deleted snapshot or embedded-note photos", () => {
    const [active] = fixtures();
    const snapshot = buildArchiveSnapshot(active, [], plannerConfig, "2026-10-14T09:00:00Z");
    const archived = { ...active, archivedAt: snapshot.archivedAt, archiveSnapshot: snapshot,
      husPhotos: [], husNotes: [{ id: "blank", sowingPlanRowId: active.id, photos: active.husPhotos }] };
    expect(buildPhotoArchive([], [archived])).toEqual([]);
  });

  it("rejects cross-HUS photos and ignores unrelated notes", () => {
    const [active] = fixtures();
    active.husPhotos = [photo("foreign", "other"), photo("own", active.id, { husNoteId: "foreign-note" })];
    active.husNotes = [{ id: "foreign-note", sowingPlanRowId: "other", note: "Wrong description" }];
    const entries = buildPhotoArchive([active], []);
    expect(entries).toHaveLength(1);
    expect(entries[0].description).toBeUndefined();
  });

  it("deduplicates embedded photos when row-level photos are unavailable", () => {
    const [active] = fixtures();
    const first = active.husPhotos![0];
    active.husPhotos = undefined;
    active.husNotes = [{ id: "note", sowingPlanRowId: active.id, photos: [first, first] }];
    expect(buildPhotoArchive([active], [])).toHaveLength(1);
  });

  it("does not guess a table or photo date from production or upload data", () => {
    const [active] = fixtures();
    active.sowingTables = "C7";
    active.husPhotos = [photo("unknown", active.id)];
    expect(buildPhotoArchive([active], [])[0]).toMatchObject({ date: undefined, description: undefined, location: undefined,
      uploadedAt: "2026-10-14T08:00:00Z" });
    expect(filterPhotoArchive(buildPhotoArchive([active], []), "14.10.2026", "all")).toHaveLength(1);
  });
});

describe("migration-free individual photo details", () => {
  it("round-trips explicit description and table, and keeps plain legacy notes", () => {
    expect(noteToPhotoDetails(photoDetailsToNote({ description: "Brūnās saknes", table: "C7–C10" })))
      .toEqual({ description: "Brūnās saknes", table: "C7–C10" });
    expect(noteToPhotoDetails("Pārbaudīt C7")).toEqual({ description: "Pārbaudīt C7" });
    expect(noteToPhotoDetails(undefined)).toEqual({});
    expect(photoDetailsToNote({})).toBeUndefined();
  });
  it("validates per-file details without inventing missing fields", () => {
    expect(validatePhotoDetails([{ date: "2026-10-14", description: " saknes ", table: " C7 " }, {}], 2))
      .toEqual([{ date: "2026-10-14", description: "saknes", table: "C7" }, {}]);
  });
  it.each([
    [[{ date: "2026-02-30" }], 1, undefined],
    [[{ description: 7 }], 1, undefined],
    [[{ table: "C7\nC8" }], 1, undefined],
    [[{}], 2, undefined],
    [[{}], 1, "event"],
  ])("rejects invalid or incompatible details", (details, count, eventId) => {
    expect(() => validatePhotoDetails(details, count as number, eventId as string | undefined)).toThrow();
  });
});

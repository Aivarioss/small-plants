import { buildArchiveSnapshot } from "./hus-archive";
import { describe, expect, it } from "vitest";

import { plannerConfig } from "./demo-data";
import { buildPhotoArchive, filterPhotoArchive, husPhotoFileUrl, photoArchiveHusTarget } from "./hus-photo-archive";
import type { SowingPlanRow } from "./types";

function fixture(type: "move" | "thinning" = "move"): SowingPlanRow {
  return {
    id: "cycle", sectorName: "Hus 1", requiredPlants: 4947, extraPlants: 100, variety: "Synthetic",
    sowingDate: "2026-11-10", harvestDate: "2026-12-02", cycleLength: 23, sectorType: 39,
    plantsPerBox: 12, correction: 0, source: "user",
    husEvents: [{ id: "moving", eventType: type, eventDate: "2026-11-19", location: "A4\nA5\nA6\nA7",
      destinationLocation: "D1-D4\nD5-D14\nD15-D24\nA14-A23" }],
    husPhotos: [{ id: "photo", sowingPlanRowId: "cycle", husEventId: "moving", storageBucket: "private",
      storagePath: "private/original.jpg", originalFileName: "moving.jpg", fileSizeBytes: 10, contentType: "image/jpeg" }],
  };
}

describe("Moving photo destination search", () => {
  it.each(["move", "thinning"] as const)("finds source, destination and interior destination tables for %s without inventing a photo location", type => {
    const row = fixture(type), before = structuredClone(row);
    const entries = buildPhotoArchive([row], []);
    expect(entries[0].location).toBeUndefined();
    expect(entries[0].movements).toEqual([
      { from: "A4", to: "D1-D4" }, { from: "A5", to: "D5-D14" },
      { from: "A6", to: "D15-D24" }, { from: "A7", to: "A14-A23" },
    ]);
    for (const query of ["A4", "D24", "d17", "A18", "Hus 1 D17 19.11.2026"]) {
      expect(filterPhotoArchive(entries, query, "all").map(entry => entry.photo.id), query).toEqual(["photo"]);
    }
    expect(filterPhotoArchive(entries, "B7", "all")).toEqual([]);
    expect(husPhotoFileUrl(entries[0].photo)).toContain("/api/hus-media/photo/photo");
    expect(entries[0].photo.storagePath).toBe("private/original.jpg");
    expect(row).toEqual(before);
  });

  it("uses frozen archived destinations and current private photo relations, without rewriting history", () => {
    const row = fixture();
    const snapshot = buildArchiveSnapshot(row, [row], plannerConfig, "2026-12-03T12:00:00Z");
    const archived = { ...row, archivedAt: snapshot.archivedAt, archiveSnapshot: snapshot,
      husEvents: [{ ...row.husEvents![0], destinationLocation: "B1-B24" }] };
    const before = structuredClone(archived);
    const entries = buildPhotoArchive([], [archived]);
    expect(filterPhotoArchive(entries, "D17", "archived")).toHaveLength(1);
    expect(filterPhotoArchive(entries, "B17", "all")).toHaveLength(0);
    expect(filterPhotoArchive(entries, "D17", "active")).toHaveLength(0);
    expect(photoArchiveHusTarget(entries[0])).toEqual({ rowId: "cycle", mode: "archive" });
    expect(archived).toEqual(before);
  });

  it("keeps an explicit individual photo location separate from its Moving association", () => {
    const row = fixture();
    row.husNotes = [{ id: "note", sowingPlanRowId: row.id, note: "Photo detail\n\nGalds: D17" }];
    row.husPhotos![0].husNoteId = "note";
    const entry = buildPhotoArchive([row], [])[0];
    expect(entry.location).toBe("D17");
    expect(entry.movements).toHaveLength(4);
  });

  it("does not use planned placement or a later unrelated Moving for an unlinked photo", () => {
    const row = fixture(); row.placement = { primaryRow: "C", tables: 34 };
    row.husPhotos![0].husEventId = undefined;
    const entries = buildPhotoArchive([row], []);
    expect(entries[0].movements).toBeUndefined();
    expect(entries[0].location).toBeUndefined();
    expect(filterPhotoArchive(entries, "D17", "all")).toEqual([]);
    expect(filterPhotoArchive(entries, "C7", "all")).toEqual([]);
  });

  it("retains incomplete movement text without expanding an invalid destination into invented tables", () => {
    const row = fixture();
    row.husEvents![0].location = undefined;
    row.husEvents![0].destinationLocation = "D1-D24 unknown";
    const entries = buildPhotoArchive([row], []);
    expect(entries[0].movements).toEqual([{ from: "", to: "D1-D24 unknown" }]);
    expect(entries[0].location).toBeUndefined();
    expect(filterPhotoArchive(entries, "D17", "all")).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { createHusMediaPublication } from "./hus-media-publication";
import { demoPlanRows } from "./demo-data";
import type { HusPhotoEntry, SowingPlanRow } from "./types";

const photo: HusPhotoEntry = { id: "photo", sowingPlanRowId: demoPlanRows[0].id,
  storageBucket: "hus-photos", storagePath: "synthetic/photo.png", originalFileName: "photo.png",
  contentType: "image/png", fileSizeBytes: 10, husNoteId: "note" };
const row: SowingPlanRow = { ...demoPlanRows[0], husPhotos: [], husNotes: [], updatedAt: "v0" };

describe("HUS media publication with field/event acknowledgements", () => {
  it("retains a new photo and its note while accepting server fields, history and version", () => {
    const media = createHusMediaPublication();
    const start = media.checkpoint(row.id);
    media.changed(row.id);
    const current = { ...row, husPhotos: [photo], husNotes: [{ id: "note", sowingPlanRowId: row.id, note: "New observation", photos: [photo] }] };
    const saved = { ...row, variety: "Saved variety", updatedAt: "v1", correction: -10 };
    const result = media.acknowledge(current, saved, start);
    expect(result).toMatchObject({ variety: "Saved variety", updatedAt: "v1", correction: -10,
      husPhotos: [photo], husNotes: current.husNotes });
    expect(current.updatedAt).toBe("v0");
  });

  it("keeps photo and photo-only note deletion through multiple queued acknowledgements", () => {
    const media = createHusMediaPublication();
    const first = media.checkpoint(row.id), second = media.checkpoint(row.id);
    media.changed(row.id);
    const stale = { ...row, husPhotos: [photo], husNotes: [{ id: "note", sowingPlanRowId: row.id, photos: [photo] }] };
    const a = media.acknowledge(row, { ...stale, updatedAt: "v1" }, first);
    const b = media.acknowledge(a, { ...stale, updatedAt: "v2" }, second);
    expect(b.husPhotos).toEqual([]);
    expect(b.husNotes).toEqual([]);
    expect(b.updatedAt).toBe("v2");
  });

  it("accepts freshly read server media when no local media operation intervened", () => {
    const media = createHusMediaPublication();
    const saved = { ...row, updatedAt: "v1", husPhotos: [photo] };
    expect(media.acknowledge(row, saved, media.checkpoint(row.id))).toBe(saved);
  });

  it("does not treat another HUS photo update as a change to this HUS", () => {
    const media = createHusMediaPublication();
    const start = media.checkpoint(row.id);
    media.changed("other-row");
    const saved = { ...row, husPhotos: [photo] };
    expect(media.acknowledge(row, saved, start)).toBe(saved);
  });

  it("removes photos linked to an intentionally deleted event without dropping unrelated media", () => {
    const media = createHusMediaPublication();
    const start = media.checkpoint(row.id);
    const linked = { ...photo, id: "event-photo", husEventId: "deleted-event" };
    media.changed(row.id);
    const current = { ...row, husPhotos: [photo, linked], husNotes: [{ id: "note", sowingPlanRowId: row.id, photos: [photo, linked] }] };
    const saved = { ...row, husEvents: [], updatedAt: "v1" };
    const result = media.acknowledge(current, saved, start);
    expect(result.husPhotos).toEqual([photo]);
    expect(result.husNotes?.[0].photos).toEqual([photo]);
    expect(result.husEvents).toEqual([]);
  });

  it("preserves newer media on fallback to an older confirmed row after failed recovery", () => {
    const media = createHusMediaPublication();
    const start = media.checkpoint(row.id);
    media.changed(row.id);
    const current = { ...row, variety: "Unsaved", husPhotos: [photo] };
    const fallback = media.acknowledge(current, row, start);
    expect(fallback.variety).toBe(row.variety);
    expect(fallback.updatedAt).toBe("v0");
    expect(fallback.husPhotos).toEqual([photo]);
  });
});

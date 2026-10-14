import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { HusPhotoArchive, PhotoArchiveMetadata } from "./HusPhotoArchive";
import { buildPhotoArchive } from "@/lib/hus-photo-archive";
import { demoPlanRows } from "@/lib/demo-data";

const entries = buildPhotoArchive([{ ...demoPlanRows[0], id: "row", sectorName: "HUS 4",
  husNotes: [{ id: "note", sowingPlanRowId: "row", observationDate: "2026-10-14", note: "Brūnās saknes\n\nGalds: C7" }],
  husPhotos: [{ id: "photo", sowingPlanRowId: "row", husNoteId: "note", storageBucket: "private",
    storagePath: "private/file.jpg", originalFileName: "file.jpg", contentType: "image/jpeg", fileSizeBytes: 4 }],
}], []);

describe("photo archive rendering", () => {
  it.each(["lv", "en"] as const)("renders searchable gallery with known metadata and protected image URLs (%s)", (language) => {
    const html = renderToStaticMarkup(<HusPhotoArchive entries={entries} language={language} onView={() => {}} />);
    expect(html).toContain("HUS 4");
    expect(html).toContain("Brūnās saknes");
    expect(html).toContain("C7");
    expect(html).toContain('type="search"');
    expect(html).toContain('value="archived"');
    expect(html).toContain("/api/hus-media/photo/photo?");
    expect(html).not.toContain("private/file.jpg");
  });
  it("renders upload time explicitly without presenting it as the photo date", () => {
    const html = renderToStaticMarkup(<PhotoArchiveMetadata entry={{
      ...entries[0], description: undefined, location: undefined, date: undefined, uploadedAt: "2026-10-14T08:00:00Z",
    }} language="lv" />);
    expect(html).toContain("Augšupielādēts");
    expect(html).not.toContain("Galds / atrašanās vieta");
    expect(html).not.toContain("Brūnās saknes");
  });
});

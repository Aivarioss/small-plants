import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PhotoArchiveMetadata } from "./HusPhotoArchive";
import type { PhotoArchiveEntry } from "@/lib/hus-photo-archive";

const entry: PhotoArchiveEntry = {
  photo: { id: "photo", sowingPlanRowId: "cycle", husEventId: "moving", storageBucket: "private",
    storagePath: "private/original.jpg", originalFileName: "moving.jpg", fileSizeBytes: 10, contentType: "image/jpeg" },
  rowId: "cycle", hus: "Hus 1", archived: true, date: "2026-11-19",
  movements: [{ from: "A7", to: "D1-D24" }, { from: "", to: "A14-A23" }],
};
describe("Moving photo metadata", () => {
  it.each(["lv", "en"] as const)("shows the actual transfer, not an assumed camera location (%s)", language => {
    const html = renderToStaticMarkup(<PhotoArchiveMetadata entry={entry} language={language} />);
    expect(html).toContain(language === "lv" ? "Pārvietošana" : "Moving");
    expect(html).toContain("A7 → D1-D24");
    expect(html).toContain("— → A14-A23");
    expect(html).not.toContain(language === "lv" ? "Galds / atrašanās vieta" : "Table / location");
    expect(html).not.toContain("private/original.jpg");
  });
});

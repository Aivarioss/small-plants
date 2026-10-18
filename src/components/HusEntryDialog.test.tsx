import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HusEntryDialog } from "./HusEntryDialog";
import { HusEntryPhotos } from "./HusEntryPhotos";
import { WorksheetView } from "./PlannerApp";
import type { HusEventEntry, SowingPlanRow } from "@/lib/types";
import { buildArchiveSnapshot } from "@/lib/planning";
import { plannerConfig } from "@/lib/demo-data";

const row: SowingPlanRow = {
  id: "hus-6", sectorName: "HUS 6", requiredPlants: 3556, extraPlants: 100, variety: "Baltazsara",
  sowingDate: "2026-09-29", harvestDate: "2026-10-21", cycleLength: 23, sectorType: 26,
  plantsPerBox: 30, correction: 0,
  husNotes: [{ id: "legacy-note", sowingPlanRowId: "hus-6", observationDate: "2026-10-09", note: "Agrākā piezīme", photos: [] }],
  husEvents: [{ id: "old-event", eventType: "move", eventDate: "2026-10-08", location: "A7", destinationLocation: "C1-C24", plantChange: -52, note: "Agrākais Moving" }],
};
const noop = () => {};
const saved = async () => {};

describe("unified HUS entry UI", () => {
  it.each(["move", "brownRoots", "other"] as const)("offers photos before saving a %s entry in LV/EN", (eventType) => {
    const entry: HusEventEntry = { id: "event", eventType, eventDate: "2026-10-08", location: "C7", note: "Novērojums" };
    for (const language of ["lv", "en"] as const) {
      const html = renderToStaticMarkup(<HusEntryDialog entry={entry} row={row} onCancel={noop} onSaveEvents={saved} onUploadMedia={saved} language={language} />);
      expect(html).toContain(language === "lv" ? "Pievienot fotogrāfijas" : "Add photos");
      expect(html).toContain('accept="image/jpeg,image/png"');
      expect(html).toContain('type="file"');
      expect(html).toContain('role="dialog"');
    }
  });

  it("offers only observations and photos on an archived HUS", () => {
    const html = renderToStaticMarkup(<HusEntryDialog entry={null} row={{ ...row, archivedAt: "2026-10-22" }} readOnly
      onCancel={noop} onSaveEvents={saved} onUploadMedia={saved} language="lv" />);
    expect(html).toContain("Novērojums");
    expect(html).toContain('type="file"');
    expect(html).not.toContain("Moving");
    expect(html).not.toContain("Brūnās saknes");
    expect(html).not.toContain("Zudums");
  });

  it("shows removable selected photo previews", () => {
    const html = renderToStaticMarkup(<HusEntryPhotos language="lv" onAdd={noop} onRemove={noop}
      photos={[{ id: "photo", target: "C7", file: new File(["photo"], "saknes.jpg"), url: "blob:photo-preview" }]} />);
    expect(html).toContain('alt="saknes.jpg"');
    expect(html).toContain("blob:photo-preview");
    expect(html).toContain("Noņemt");
  });

  it.each([false, true])("keeps existing events/notes together without a second observation form (archived=%s)", (archived) => {
    const archivedAt = "2026-10-22T10:00:00Z";
    const source = archived ? { ...row, archivedAt, archiveSnapshot: buildArchiveSnapshot(row, [row], plannerConfig, archivedAt) } : row;
    const before = JSON.stringify(source);
    const html = renderToStaticMarkup(<WorksheetView row={source} workItems={[]} printLanguage="lv" readOnly={archived}
      onArchive={noop} onEdit={noop} onRestore={noop} onUpdateRow={noop} onViewPhoto={noop} onUploadHusMedia={saved} onSaveHusEntries={saved} />);
    expect(html).toContain("Notikumi un novērojumi");
    expect(html).toContain("Agrākā piezīme");
    expect(html).toContain("Agrākais Moving");
    expect(html).not.toContain('class="hus-note-form"');
    expect(html).not.toContain("Brīva piezīme par šo Hus");
    expect(html).toContain(archived ? "+ Pievienot novērojumu" : "+ Pievienot ierakstu");
    expect(JSON.stringify(source)).toBe(before);
  });
});

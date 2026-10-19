import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GreenhouseStatisticsPanel } from "./GreenhouseStatisticsPanel";
import type { SowingPlanRow } from "@/lib/types";

const row: SowingPlanRow = {
  id: "stats-fixture", sectorName: "Hus 4", source: "user", variety: "Synthetic",
  sowingDate: "2026-10-01", harvestDate: "2026-10-23", cycleLength: 23,
  requiredPlants: 3400, extraPlants: 100, sectorType: 26, plantsPerBox: 30, correction: 0,
  husEvents: [
    { id: "m", eventType: "move", eventDate: "2026-10-08", location: "A7", destinationLocation: "C1-C10" },
    { id: "r", eventType: "brownRoots", eventDate: "2026-10-14", location: "C7", plantChange: -4 },
  ],
  husPhotos: [{ id: "private-photo", sowingPlanRowId: "stats-fixture", husEventId: "r", storageBucket: "private",
    storagePath: "hus/stats-fixture/private-photo.jpg", originalFileName: "roots.jpg", contentType: "image/jpeg", fileSizeBytes: 1 }],
};
function render(language: "lv" | "en", rows = [row]) {
  return renderToStaticMarkup(<GreenhouseStatisticsPanel rows={rows} archivedRows={[]} today="2026-10-19"
    language={language} onOpenHus={() => {}} onViewPhoto={() => {}} />);
}
describe("whole-house statistics presentation", () => {
  it.each(["lv", "en"] as const)("renders all 104 physical tables, provenance, history, and private photos (%s)", (language) => {
    const html = render(language);
    expect(html.match(/class="root-map-cell /g)).toHaveLength(104);
    expect(html).toContain('aria-label="C7: 1');
    expect(html).toContain('aria-label="A7: 1');
    expect(html).toContain('aria-label="A1: 0');
    expect(html).toContain('/api/hus-media/photo/private-photo');
    expect(html).not.toContain('src="https://');
    expect(html).not.toContain('storage/v1');
    expect(html).toContain(language === "lv" ? "Nav ierakstu ≠ pārbaudīts un vesels" : "No records ≠ checked and healthy");
    expect(html).toContain(language === "lv" ? "Atvērt avota ierakstu" : "Open source record");
    expect(html).toContain(language === "lv" ? "Sēšanas izcelsme: A7" : "Seeding origin: A7");
  });

  it("shows a neutral empty state rather than declaring tables healthy", () => {
    const html = render("lv", []);
    expect(html).toContain("nav strukturētu brūno sakņu ierakstu");
    expect(html.match(/root-map-cell--unknown/g)).toHaveLength(104);
    expect(html).not.toContain('root-map-cell--recurring');
    expect(html).toContain("Brīvās piezīmes un foto apraksti netiek automātiski klasificēti");
  });

  it("does not present unspecified table losses as confirmed zero", () => {
    const data = structuredClone(row);
    data.husEvents![1].plantChange = undefined;
    const html = render("lv", [data]);
    expect(html).toContain("Piesaistītie zudumi: ≥ 0");
    expect(html).toContain("Reģistrētais zudums: nav norādīts");
  });
});

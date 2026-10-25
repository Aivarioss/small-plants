import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { dateLabel } from "@/lib/planning";
import { HusList } from "./HusList";
import type { SowingPlanRow } from "@/lib/types";
const row = (id: string, sowingDate: string, harvestDate: string): SowingPlanRow => ({
  id, sectorName: "HUS 4", sowingDate, harvestDate, variety: id, requiredPlants: 3500,
  extraPlants: 100, plantsPerBox: 150, cycleLength: 23, sectorType: 26, correction: 0, source: "user",
});
const render = (rows: SowingPlanRow[], language: "lv" | "en" = "lv", mode: "active" | "archive" = "active") =>
  renderToStaticMarkup(<HusList rows={rows} today="2026-10-24" mode={mode} language={language} onOpen={vi.fn()} onModeChange={vi.fn()} />);
describe("HUS list", () => {
  it("puts current cycle in the main card and clearly labels overlapping and planned cycles", () => {
    const html = render([row("FarFuture", "2027-01-01", "2027-01-23"), row("EarlierCurrent", "2026-10-01", "2026-10-25"), row("Current", "2026-10-10", "2026-11-01")]);
    const mainCard = html.split('class="previous-cycles"')[0];
    expect(mainCard).toContain("Pašlaik aug · Current");
    expect(mainCard).not.toContain("FarFuture");
    expect(html).toContain(`Pašlaik aug · ${dateLabel("2026-10-01")}`);
    expect(html).toContain(`Plānots · ${dateLabel("2027-01-01")}`);
  });
  it("shows nearest future as primary when no cycle is growing", () => {
    const html = render([row("FarFuture", "2027-01-01", "2027-01-23"), row("Next", "2026-11-01", "2026-11-23")], "en");
    expect(html.split('class="previous-cycles"')[0]).toContain("Planned · Next");
  });
  it("retains archive priority independent of sowing date", () => {
    const a = { ...row("LatestArchive", "2026-01-01", "2026-01-23"), archivedAt: "2026-10-24T12:00:00Z" };
    const b = { ...row("OlderArchive", "2026-09-01", "2026-09-23"), archivedAt: "2026-10-23T12:00:00Z" };
    const mainCard = render([b, a], "lv", "archive").split('class="previous-cycles"')[0];
    expect(mainCard).toContain("LatestArchive");
    expect(mainCard).not.toContain("OlderArchive");
    expect(mainCard).toContain("Arhivēts");
  });
});

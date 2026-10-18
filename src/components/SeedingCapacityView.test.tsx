import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { unconfirmedPlacementScenario } from "@/lib/__fixtures__/unconfirmed-placement-scenario";
import { plannerConfig } from "@/lib/demo-data";
import { buildGreenhouseOccupancyDay } from "@/lib/greenhouse-simulation";
import { SeedingCapacityView } from "./SeedingCapacityView";

describe("count-first seeding capacity display", () => {
  it.each(["lv", "en"] as const)("shows occupied/free counts and each HUS without missing-table warnings (%s)", (language) => {
    const occupancy = buildGreenhouseOccupancyDay(unconfirmedPlacementScenario(), plannerConfig, "2026-10-31").seeding;
    const html = renderToStaticMarkup(<SeedingCapacityView occupancy={occupancy} language={language} />);
    expect(html).toContain(language === "lv" ? "Aizņemti / rezervēti: 6" : "Occupied / reserved: 6");
    expect(html).toContain(language === "lv" ? "Brīvi: 7" : "Free: 7");
    expect(html).toContain(language === "lv" ? "HUS 8B — 3 galdi" : "HUS 8B — 3 tables");
    expect(html).toContain(language === "lv" ? "HUS 3 — 3 galdi" : "HUS 3 — 3 tables");
    expect(html).not.toContain("capacity-note");
    expect(html).not.toContain("A1, A2");
  });

  it("does not claim thirteen tables are certainly free when a HUS count is unknown", () => {
    const row = { ...unconfirmedPlacementScenario()[3], requiredPlants: Number.NaN };
    const occupancy = buildGreenhouseOccupancyDay([row], plannerConfig, "2026-10-22").seeding;
    const html = renderToStaticMarkup(<SeedingCapacityView occupancy={occupancy} language="lv" />);
    expect(html).toContain("Ne vairāk kā 13/13 brīvi");
    expect(html).toContain("nav zināms nepieciešamais galdu skaits");
    expect(html).toContain("HUS 8A — ? galdi");
  });
});

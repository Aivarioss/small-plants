import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { unconfirmedPlacementScenario } from "@/lib/__fixtures__/unconfirmed-placement-scenario";
import { plannerConfig } from "@/lib/demo-data";
import { buildGreenhouseOccupancyDay } from "@/lib/greenhouse-simulation";
import { SeedingCapacityView } from "./SeedingCapacityView";

describe("seeding capacity display", () => {
  it.each(["lv", "en"] as const)("shows occupied/free counts and each HUS without missing-table warnings (%s)", (language) => {
    const occupancy = buildGreenhouseOccupancyDay(unconfirmedPlacementScenario(), plannerConfig, "2026-10-31").seeding;
    const html = renderToStaticMarkup(<SeedingCapacityView occupancy={occupancy} language={language} date="2026-10-31" today="2026-10-31" />);
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
    const html = renderToStaticMarkup(<SeedingCapacityView occupancy={occupancy} language="lv" date="2026-10-22" today="2026-10-22" />);
    expect(html).toContain("Ne vairāk kā 13/13 brīvi");
    expect(html).toContain("nav zināms nepieciešamais galdu skaits");
    expect(html).toContain("HUS 8A — ? galdi");
  });

  it.each(["lv", "en"] as const)("shows saved table numbers alongside the unchanged count (%s)", (language) => {
    const row = { ...unconfirmedPlacementScenario()[7], sowingTables: "A10-A12" };
    const occupancy = buildGreenhouseOccupancyDay([row], plannerConfig, "2026-11-06").seeding;
    const before = structuredClone(occupancy);
    const html = renderToStaticMarkup(<SeedingCapacityView occupancy={occupancy} language={language} date="2026-11-06" today="2026-11-06" />);
    expect(html).toContain(language === "lv" ? "HUS 2S — A10–A12 · 3 galdi" : "HUS 2S — A10–A12 · 3 tables");
    expect(html).toContain(language === "lv" ? "Aizņemti / rezervēti: 3" : "Occupied / reserved: 3");
    expect(html).toContain(language === "lv" ? "Brīvi: 10" : "Free: 10");
    expect(html).not.toContain(language === "lv" ? "plānots" : "planned");
    expect(occupancy).toEqual(before);
  });

  it.each(["lv", "en"] as const)("marks future numbered and count-only reservations as planned without inventing table numbers (%s)", (language) => {
    const numbered = { ...unconfirmedPlacementScenario()[7], sowingTables: "A10-A12" };
    const unnumbered = { ...numbered, id: "unnumbered", sectorName: "HUS count only", sowingTables: undefined };
    const occupancy = buildGreenhouseOccupancyDay([numbered, unnumbered], plannerConfig, "2026-11-07").seeding;
    const before = structuredClone(occupancy);
    const html = renderToStaticMarkup(<SeedingCapacityView occupancy={occupancy} language={language} date="2026-11-07" today="2026-11-06" />);
    expect(html).toContain(language === "lv" ? "HUS 2S — A10–A12 · 3 galdi · plānots" : "HUS 2S — A10–A12 · 3 tables · planned");
    expect(html).toContain(language === "lv" ? "HUS count only — 3 galdi · plānots" : "HUS count only — 3 tables · planned");
    expect(html).toContain(language === "lv" ? "Aizņemti / rezervēti: 6" : "Occupied / reserved: 6");
    expect(html).toContain(language === "lv" ? "Brīvi: 7" : "Free: 7");
    expect(occupancy.freeTableIds).toEqual([]);
    expect(occupancy).toEqual(before);
  });

  it.each([
    ["2026-11-05", false], ["2026-11-06", false], ["2026-11-07", true],
  ] as const)("uses the selected date %s to determine whether the placement is planned", (date, planned) => {
    const row = { ...unconfirmedPlacementScenario()[7], sowingTables: "A10-A12" };
    const occupancy = buildGreenhouseOccupancyDay([row], plannerConfig, date).seeding;
    const html = renderToStaticMarkup(<SeedingCapacityView occupancy={occupancy} language="lv" date={date} today="2026-11-06" />);
    expect(html).toContain("HUS 2S — A10–A12 · 3 galdi");
    expect(html.includes(" · plānots")).toBe(planned);
  });

  it("shows only the tables remaining after Moving on the selected date", () => {
    const row = { ...unconfirmedPlacementScenario()[7], sowingTables: "A10-A12", husEvents: [
      { id: "first-move", eventType: "move" as const, eventDate: "2026-11-06", location: "A10", destinationLocation: "B1-B8" },
      { id: "last-move", eventType: "move" as const, eventDate: "2026-11-07", location: "A11-A12", destinationLocation: "B9-B24" },
    ] };
    const occupancy = buildGreenhouseOccupancyDay([row], plannerConfig, "2026-11-06").seeding;
    const html = renderToStaticMarkup(<SeedingCapacityView occupancy={occupancy} language="lv" date="2026-11-06" today="2026-11-06" />);
    expect(html).toContain("HUS 2S — A11–A12 · 2 galdi");
    expect(html).not.toContain("A10");
    expect(occupancy).toMatchObject({ usedTables: 2, freeTables: 11 });
    const released = buildGreenhouseOccupancyDay([row], plannerConfig, "2026-11-07").seeding;
    const nextDayHtml = renderToStaticMarkup(<SeedingCapacityView occupancy={released} language="lv" date="2026-11-07" today="2026-11-06" />);
    expect(nextDayHtml).not.toContain("HUS 2S");
    expect(released).toMatchObject({ usedTables: 0, freeTables: 13 });
  });
});

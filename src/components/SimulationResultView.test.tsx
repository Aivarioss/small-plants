import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SimulationResultView } from "./SimulationResultView";
import { simulateSowingDateChange } from "@/lib/greenhouse-simulation";
import { demoPlanRows, plannerConfig } from "@/lib/demo-data";
import { t } from "@/lib/localization";

const target = { ...demoPlanRows[0], id: "target", sectorName: "HUS 8A", sowingTables: undefined,
  sowingDate: "2026-10-21", harvestDate: "2026-11-12", cycleLength: 23 };

describe("simulation result summary", () => {
  it.each(["lv", "en"] as const)("shows the recommended solution before details without a conflicting missing-data status (%s)", (language) => {
    const result = simulateSowingDateChange([target], plannerConfig, target.id, "2026-10-20");
    const html = renderToStaticMarkup(<SimulationResultView result={result} language={language} />);
    const summary = language === "lv" ? "Ieteicamais risinājums" : "Recommended solution";
    const details = language === "lv" ? "Detalizēta pārbaude" : "Detailed check";
    expect(html.indexOf(summary)).toBeGreaterThan(-1);
    expect(html.indexOf(summary)).toBeLessThan(html.indexOf("<details"));
    expect(html).toContain(details);
    expect(html).toContain((language === "lv" ? "Sēšanas galdi" : "Seeding tables") + "</dt><dd>3</dd>");
    expect(html).not.toContain(language === "lv" ? "Nepietiek datu" : "Insufficient data");
    expect(html).toContain(language === "lv" ? "iespējams iesēt agrāk" : "earlier seeding is possible");
    expect(html).toContain(language === "lv" ? "stādi/renē" : "plants/trough");
  });

  it("clearly labels a proposal with unresolved data instead of claiming feasibility", () => {
    const other = { ...target, id: "unknown", sectorName: "Unknown HUS", requiredPlants: Number.NaN,
      placement: { primaryRow: "D" as const, tables: 4, manual: true } };
    const result = simulateSowingDateChange([target, other], plannerConfig, target.id, target.sowingDate);
    const html = renderToStaticMarkup(<SimulationResultView result={result} language="en" />);
    expect(result.status).toBe("conditional");
    expect(html).toContain("conditional proposal");
    expect(html).not.toContain("Verified solution");
    expect(html).toContain("unknown required seeding-table count");
  });

  it("renames only the small plants navigation, preserving actual greenhouse terminology", () => {
    expect(t("greenhouse", "en")).toBe("Small Plants House");
    expect(t("greenhouse", "lv")).toBe("Stādu māja");
    expect(t("greenhouseRequired", "en")).toBe("Greenhouse required");
  });
});

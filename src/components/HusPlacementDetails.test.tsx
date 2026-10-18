import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { unconfirmedPlacementScenario } from "@/lib/__fixtures__/unconfirmed-placement-scenario";
import { HusPlacementDetails } from "./HusPlacementDetails";

describe("HUS placement details", () => {
  it.each(["lv", "en"] as const)("labels a future row as automatic and offers no manual reservation fields (%s)", (language) => {
    const rows = unconfirmedPlacementScenario();
    const html = renderToStaticMarkup(<HusPlacementDetails row={rows[8]} rows={rows} language={language} />);
    expect(html).toContain(language === "lv" ? "Plānotais izvietojums (automātiski)" : "Planned placement (automatic)");
    expect(html).toContain("D1-D26");
    expect(html).toContain(language === "lv" ? "Moving ierakstā" : "Moving entry");
    expect(html).not.toContain("<select");
    expect(html).not.toContain("<input");
  });

  it.each(["lv", "en"] as const)("shows the actual B and A rows rather than an old C estimate (%s)", (language) => {
    const rows = unconfirmedPlacementScenario();
    rows[1].placement = { primaryRow: "C", tables: 26, manual: true };
    const html = renderToStaticMarkup(<HusPlacementDetails row={rows[1]} rows={rows} language={language} />);
    expect(html).toContain(language === "lv" ? "Faktiskais izvietojums pēc retināšanas" : "Actual placement after moving");
    expect(html).toContain(`${language === "lv" ? "Rinda" : "Row"}: A, B`);
    expect(html).toContain(`${language === "lv" ? "Galdi" : "Tables"}: 39`);
    expect(html).not.toContain(language === "lv" ? "Rinda: C" : "Row: C");
  });

  it("does not use a planned row as a substitute for an unknown actual destination", () => {
    const rows = unconfirmedPlacementScenario();
    rows[1].husEvents![0].destinationLocation = "unknown";
    rows[1].placement = { primaryRow: "C", manual: true };
    const html = renderToStaticMarkup(<HusPlacementDetails row={rows[1]} rows={rows} language="lv" />);
    expect(html).toContain("Vieta nav zināma");
    expect(html).toContain("Rinda: —");
  });
});

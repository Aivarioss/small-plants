import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { unconfirmedPlacementScenario } from "@/lib/__fixtures__/unconfirmed-placement-scenario";
import { selectableSowingSimulationRows, simulateGreenhouseSowing } from "@/lib/greenhouse-sowing-simulator";
import { plannerConfig } from "@/lib/demo-data";
import { SowingSimulationPanel } from "./SowingSimulationPanel";

describe("pending HUS simulation choices", () => {
  it.each(["lv", "en"] as const)("starts with 8A instead of already thinned active HUS (%s)", (language) => {
    const rows = unconfirmedPlacementScenario();
    const html = renderToStaticMarkup(<SowingSimulationPanel rows={rows} language={language} asOfDate="2026-10-18" />);
    expect(html).toContain('<option value="HUS 8A" selected="">');
    expect(html).toContain('value="2026-10-20"');
    for (const id of ["HUS 6", "HUS 7", "HUS 9"]) expect(html).not.toContain(`<option value="${id}"`);
  });

  it("excludes actual thinning, completed and archived rows while retaining other observations", () => {
    const rows = unconfirmedPlacementScenario().slice(3, 8);
    rows[0].husEvents = [{ id: "thin", eventType: "thinning", eventDate: "2026-10-29" }];
    rows[1].status = "done";
    rows[2].archivedAt = "2026-11-19";
    rows[3].husEvents = [{ id: "observation", eventType: "brownRoots", eventDate: "2026-11-10" }];
    const before = structuredClone(rows);
    expect(selectableSowingSimulationRows(rows).map((row) => row.id)).toEqual(["HUS 2N", "HUS 2S"]);
    expect(rows).toEqual(before);
  });

  it("counts only pending choices when disabling joint mode and handles an empty list", () => {
    const rows = unconfirmedPlacementScenario();
    const onePending = [...rows.slice(0, 3), rows[3]];
    const html = renderToStaticMarkup(<SowingSimulationPanel rows={onePending} language="lv" asOfDate="2026-10-18" />);
    expect(html).toContain('<option value="joint" disabled="">');
    const empty = renderToStaticMarkup(<SowingSimulationPanel rows={rows.slice(0, 3)} language="lv" asOfDate="2026-10-18" />);
    expect(empty).toContain("Nav HUS ar vēl neizpildītu retināšanu.");
    expect(empty).toContain('type="button" disabled="">Aprēķināt');
  });

  it("keeps actual Moving reservations in the simulation context even though those HUS are absent from the picker", () => {
    const rows = unconfirmedPlacementScenario();
    const first = selectableSowingSimulationRows(rows)[0];
    const result = simulateGreenhouseSowing(rows, plannerConfig, first.id, "2026-10-18", "2026-10-18");
    expect(result.recommendation).toMatchObject({ wateringZone: "C", thinningDate: "2026-10-27" });
    const day = result.occupancy.find((entry) => entry.date === "2026-10-18")!;
    expect(day.growing.rows.map((row) => row.sectorName)).toEqual(["HUS 6", "HUS 7", "HUS 9"]);
  });
});

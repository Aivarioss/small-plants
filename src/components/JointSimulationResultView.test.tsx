import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { JointSimulationResultView } from "./JointSimulationResultView";
import { SowingSimulationPanel } from "./SowingSimulationPanel";
import { twoHusScenario } from "@/lib/__fixtures__/two-hus-scenario";
import { simulateTwoHusSowing } from "@/lib/greenhouse-sowing-simulator";
import { plannerConfig } from "@/lib/demo-data";

const rows = twoHusScenario();
const changes = [{ planRowId: rows[0].id, sowingDate: "2026-10-18" }, { planRowId: rows[1].id, sowingDate: "2026-10-20" }];

describe("joint simulation presentation", () => {
  it.each(["lv", "en"] as const)("shows one joint solution, both HUS and collapsed details (%s)", (language) => {
    const result = simulateTwoHusSowing(rows, plannerConfig, changes, "2026-10-17");
    const html = renderToStaticMarkup(<JointSimulationResultView result={result} language={language} />);
    expect(html).toContain(language === "lv" ? "Abus HUS var sēt" : "Both HUS can be sown");
    expect(html.match(/<article/g)).toHaveLength(2);
    const summary = html.split("<details")[0];
    expect(summary).toContain("HUS 8A");
    expect(summary).toContain("HUS 8B");
    expect(summary).toContain("27.10.2026");
    expect(summary).toContain("29.10.2026");
    expect(summary).toContain("11.11.2026");
    expect(summary).toContain("13.11.2026");
    expect(html).not.toContain("<details open");
    expect(summary).not.toContain(language === "lv" ? "darbu slodze" : "workload");
  });

  it("does not claim both HUS can be sown when the selection is invalid", () => {
    const result = simulateTwoHusSowing(rows, plannerConfig, [changes[0], changes[0]], "2026-10-17");
    const html = renderToStaticMarkup(<JointSimulationResultView result={result} language="lv" />);
    expect(html).toContain("Izvēlies divus dažādus HUS");
    expect(html).not.toContain("Abus HUS var sēt");
    expect(html).not.toContain("Abi HUS pārbaudīti kopā");
    expect(html).not.toContain("<article");
  });

  it("retains the single-HUS entry point and disables joint mode with fewer than two HUS", () => {
    const html = renderToStaticMarkup(<SowingSimulationPanel rows={rows.slice(0, 1)} language="lv" asOfDate="2026-10-17" />);
    expect(html).toContain("Simulēt vienu HUS");
    expect(html).toContain('<option value="joint" disabled="">Simulēt divus HUS');
    expect(html).toContain('value="2026-10-20"');
  });
});

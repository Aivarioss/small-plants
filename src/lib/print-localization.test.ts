import { describe, expect, it } from "vitest";
import { plannerConfig } from "./demo-data";
import {
  formatPrintHarvestBoxes,
  formatPrintSowingPlan,
  formatPrintThinningPlan,
  localizedMonthlyPrintRows,
  normalizeLanguage,
  printLabel,
  printMaterialSummary,
  printWorkTitle,
  t,
} from "./print-localization";
import { generateWorkItems, getTotalSow } from "./planning";
import type { SowingPlanRow, WorkType } from "./types";

const row: SowingPlanRow = {
  id: "hus-3",
  sectorName: "Hus 3",
  greenhouseRequiredPlants: 3600,
  requiredPlants: 3744,
  extraPlants: 100,
  variety: "Baltazsara",
  sowingTables: "A3-A7",
  sowingDate: "2026-10-01",
  harvestDate: "2026-10-23",
  cycleLength: 23,
  sectorType: 26,
  plantsPerBox: 12,
  correction: 0,
};

describe("print localization", () => {
  it("uses the fixed workplace EN terms for work types", () => {
    const expected: Record<WorkType, string> = {
      addAgrofilm: "Agroplastic on",
      animals: "Animals",
      disinfectTables: "Chlorine",
      harvest: "Planting",
      previcur: "Previcur",
      previcure: "Previcur",
      removeAgrofilm: "Agroplastic off",
      removeFilm: "Plastic off",
      rings: "Clips",
      sideShoots: "Pazar",
      sowing: "Seeding",
      sprayTables: "Spray HP",
      sticks: "Stick",
      thinning: "Moving",
    };

    Object.entries(expected).forEach(([type, title]) => {
      expect(printWorkTitle(type as WorkType, "en")).toBe(title);
    });
  });

  it("localizes print labels without changing the app data model", () => {
    expect(printLabel("lv", "worksheet")).toBe("Darba lapa");
    expect(printLabel("en", "worksheet")).toBe("Work sheet");
    expect(printLabel("en", "boxes")).toBe("Boxes");
    expect(t("recalculatePlan", "en")).toBe("Recalculate plan");
    expect(normalizeLanguage("fr")).toBe("lv");
    expect(normalizeLanguage("en")).toBe("en");
  });

  it("formats material summaries in English without Latvian unit words", () => {
    const totalSow = getTotalSow(row);

    expect(totalSow).toBe(3844);
    expect(formatPrintSowingPlan(totalSow, "en")).toContain("full tables");
    expect(formatPrintSowingPlan(totalSow, "en")).not.toContain("galdi");
    expect(formatPrintThinningPlan(row, "en")).toContain("tables");
    expect(formatPrintThinningPlan(row, "en")).toContain("plants/trough");
    expect(formatPrintThinningPlan(row, "en")).not.toContain("stādi");
    expect(formatPrintHarvestBoxes(row, "en")).toContain("boxes");
    expect(formatPrintHarvestBoxes(row, "en")).not.toContain("kast");
  });

  it("creates localized HUS worksheet material summaries", () => {
    expect(printMaterialSummary(row, "en")).toMatchObject({
      sowingTables: "A3-A7",
    });
    expect(printMaterialSummary(row, "lv").thinning).toContain("stādi renē");
    expect(printMaterialSummary(row, "en").thinning).toContain("plants/trough");
  });

  it("keeps language switching presentation-only for the same row data", () => {
    const changedRow = { ...row, requiredPlants: 3800, extraPlants: 100 };
    const workItems = generateWorkItems(changedRow, plannerConfig);
    const lvRows = localizedMonthlyPrintRows(workItems, [changedRow], "lv");
    const enRows = localizedMonthlyPrintRows(workItems, [changedRow], "en");

    expect(getTotalSow(changedRow)).toBe(3900);
    expect(lvRows.find((item) => item.workTitle === "Sēšana")?.plantCount).toBe(3900);
    expect(enRows.find((item) => item.workTitle === "Seeding")?.plantCount).toBe(3900);
  });

  it("localizes common monthly print rows, including minor work notes", () => {
    const workItems = generateWorkItems(row, plannerConfig);
    const rows = localizedMonthlyPrintRows(workItems, [row], "en");

    expect(rows.some((item) => item.workTitle === "Seeding")).toBe(true);
    expect(rows.some((item) => item.workTitle === "Planting" && item.notes.includes("Spray HP"))).toBe(true);
    expect(rows.some((item) => item.notes.includes("Animals"))).toBe(true);
    expect(rows.map((item) => `${item.workTitle} ${item.notes}`).join(" ")).not.toMatch(/Sēšana|Retināšana|Izvākšana|galdi|stādi renē|kastītes/);
  });
});

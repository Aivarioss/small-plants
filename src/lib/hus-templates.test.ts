import { describe, expect, it } from "vitest";
import {
  applyHusTemplateToDraft,
  calculateMoveOutDate,
  DEFAULT_WORKER_EXTRA,
  deriveCycleLength,
  findHusTemplate,
  operationalTotal,
  standardHusTemplates,
  updateDraftCycleLength,
  updateDraftMoveOutDate,
  updateDraftSowingDate,
  updateRowSowingDate,
} from "./hus-templates";
import { generateWorkItemsForRows } from "./planning";
import { buildGreenhouseOccupancyDay } from "./greenhouse-simulation";
import { plannerConfig } from "./demo-data";
import type { SowingPlanDraft, SowingPlanRow } from "./types";

const draft: SowingPlanDraft = {
  sectorName: "",
  greenhouseRequiredPlants: "",
  requiredPlants: "",
  extraPlants: "",
  variety: "",
  sowingTables: "",
  sowingDate: "2026-09-29",
  harvestDate: "2026-10-20",
  cycleLength: "22",
  cycleMode: "length",
  sectorType: 26,
  plantsPerBox: "12",
};

describe("Hus templates", () => {
  it("autofills a standard Hus template", () => {
    const next = applyHusTemplateToDraft(draft, "6");

    expect(next.sectorName).toBe("Hus 6");
    expect(next.variety).toBe("Baltazsara");
    expect(next.greenhouseRequiredPlants).toBe("3419");
    expect(next.requiredPlants).toBe("3556");
  });

  it("defaults worker extra to +100", () => {
    const next = applyHusTemplateToDraft(draft, "Hus 3");

    expect(next.greenhouseRequiredPlants).toBe("3600");
    expect(next.requiredPlants).toBe("3744");
    expect(next.extraPlants).toBe(String(DEFAULT_WORKER_EXTRA));
    expect(operationalTotal(Number(next.requiredPlants), Number(next.extraPlants))).toBe(3844);
  });

  it.each([
    ["Hus 1", 4757, 4947],
    ["Hus 7", 5824, 6057],
    ["Hus 8B", 3995, 4155],
  ])("keeps greenhouse required and agronomist sow counts separate for %s", (hus, greenhouseRequiredPlants, requiredPlants) => {
    const template = findHusTemplate(hus);
    const next = applyHusTemplateToDraft(draft, hus);

    expect(template).toMatchObject({ greenhouseRequiredPlants, agronomistSowCount: requiredPlants });
    expect(next.greenhouseRequiredPlants).toBe(String(greenhouseRequiredPlants));
    expect(next.requiredPlants).toBe(String(requiredPlants));
  });

  it("allows changing +100 for one cycle without changing the template", () => {
    const next = { ...applyHusTemplateToDraft(draft, "Hus 6"), extraPlants: "50" };

    expect(operationalTotal(Number(next.requiredPlants), Number(next.extraPlants))).toBe(3606);
    expect(findHusTemplate("Hus 6")?.agronomistSowCount).toBe(3556);
    expect(findHusTemplate("Hus 6")?.greenhouseRequiredPlants).toBe(3419);
  });

  it("calculates move-out dates from biological day cycle convention", () => {
    expect(calculateMoveOutDate("2026-10-01", 21)).toBe("2026-10-21");
    expect(calculateMoveOutDate("2026-10-01", 22)).toBe("2026-10-22");
    expect(calculateMoveOutDate("2026-10-01", 23)).toBe("2026-10-23");
    expect(calculateMoveOutDate("2026-09-29", 22)).toBe("2026-10-20");
  });

  it("derives cycle length from a move-out date", () => {
    const next = updateDraftMoveOutDate({ ...draft, sowingDate: "2026-10-01" }, "2026-10-23");

    expect(next.cycleMode).toBe("moveOut");
    expect(next.cycleLength).toBe("23");
    expect(deriveCycleLength("2026-10-01", "2026-10-23")).toBe(23);
  });

  it.each(["length", "moveOut"] as const)("keeps the entered draft cycle when changing sowing in %s mode", (cycleMode) => {
    const original = { ...draft, cycleMode };
    const next = updateDraftSowingDate(original, "2026-10-18");

    expect(next.cycleLength).toBe("22");
    expect(next.harvestDate).toBe("2026-11-08");
    expect(original.sowingDate).toBe("2026-09-29");
    expect(original.harvestDate).toBe("2026-10-20");
  });

  it("preserves a custom cycle derived from a manually entered Planting date", () => {
    const custom = updateDraftMoveOutDate({ ...draft, sowingDate: "2026-10-01" }, "2026-10-25");
    const next = updateDraftSowingDate(custom, "2026-10-18");

    expect(next.cycleLength).toBe("25");
    expect(next.harvestDate).toBe("2026-11-11");
  });

  it("supports non-standard Hus values", () => {
    const next = applyHusTemplateToDraft(draft, "Hus X");

    expect(next.sectorName).toBe("Hus X");
    expect(next.requiredPlants).toBe("");
    expect(next.greenhouseRequiredPlants).toBe("");
    expect(next.variety).toBe("");
  });

  it("does not mutate standard templates when editing a draft", () => {
    const before = standardHusTemplates.find((template) => template.hus === "Hus 3");
    const next = updateDraftCycleLength({ ...applyHusTemplateToDraft(draft, "Hus 3"), variety: "Cita" }, 23);

    expect(next.variety).toBe("Cita");
    expect(before).toEqual({ hus: "Hus 3", greenhouseRequiredPlants: 3600, agronomistSowCount: 3744, variety: "Baltazsara" });
  });

  it("does not use greenhouse required plants for scheduler quantities", () => {
    const row: SowingPlanRow = {
      id: "hus-3",
      sectorName: "Hus 3",
      greenhouseRequiredPlants: 3600,
      requiredPlants: 3744,
      extraPlants: 100,
      variety: "Baltazsara",
      sowingDate: "2026-10-01",
      harvestDate: "2026-10-23",
      cycleLength: 23,
      sectorType: 26,
      plantsPerBox: 12,
      correction: 0,
    };
    const withoutGreenhouseRequired = { ...row, greenhouseRequiredPlants: undefined };

    expect(generateWorkItemsForRows([row], plannerConfig)).toEqual(generateWorkItemsForRows([withoutGreenhouseRequired], plannerConfig));
  });
});

describe("existing HUS sowing date changes", () => {
  function row(cycleLength = 23): SowingPlanRow {
    return {
      id: "sowing-date-regression", sectorName: "Hus 8A", variety: "Synthetic",
      sowingDate: "2026-10-20", harvestDate: calculateMoveOutDate("2026-10-20", cycleLength),
      cycleLength, requiredPlants: 3557, extraPlants: 0, sectorType: 26,
      plantsPerBox: 30, correction: 0, source: "user",
    };
  }

  it.each([
    [21, "2026-10-18", "2026-11-07"],
    [22, "2026-10-18", "2026-11-08"],
    [23, "2026-10-18", "2026-11-09"],
    [21, "2026-10-25", "2026-11-14"],
    [22, "2026-10-25", "2026-11-15"],
    [23, "2026-10-25", "2026-11-16"],
    [28, "2026-12-20", "2027-01-16"],
  ] as const)("preserves a %i-day cycle when sowing moves to %s", (cycleLength, sowingDate, harvestDate) => {
    const original = row(cycleLength);
    const before = structuredClone(original);
    const updated = { ...original, ...updateRowSowingDate(original, sowingDate) };
    const work = generateWorkItemsForRows([updated], plannerConfig);

    expect(updated.cycleLength).toBe(cycleLength);
    expect(updated.harvestDate).toBe(harvestDate);
    expect(deriveCycleLength(updated.sowingDate, updated.harvestDate)).toBe(cycleLength);
    expect(work.find((item) => item.type === "sowing")?.date).toBe(sowingDate);
    expect(work.find((item) => item.type === "harvest")?.date).toBe(harvestDate);
    expect(work.find((item) => item.type === "sprayTables")?.date).toBe(harvestDate);
    expect(original).toEqual(before);
  });

  it("releases growing tables on recalculated Planting rather than the previous date", () => {
    const original = row();
    const updated = { ...original, ...updateRowSowingDate(original, "2026-10-18") };
    const work = generateWorkItemsForRows([updated], plannerConfig);

    expect(original.harvestDate).toBe("2026-11-11");
    expect(work.find((item) => item.type === "rings")?.date).toBe("2026-11-08");
    expect(buildGreenhouseOccupancyDay([updated], plannerConfig, "2026-11-08").growing.rows.some((entry) => entry.planRowId === original.id)).toBe(true);
    expect(buildGreenhouseOccupancyDay([updated], plannerConfig, "2026-11-09").growing.rows.some((entry) => entry.planRowId === original.id)).toBe(false);
    expect(buildGreenhouseOccupancyDay([original], plannerConfig, "2026-11-09").growing.rows.some((entry) => entry.planRowId === original.id)).toBe(true);
  });
});

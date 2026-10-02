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
} from "./hus-templates";
import type { SowingPlanDraft } from "./types";

const draft: SowingPlanDraft = {
  sectorName: "",
  requiredPlants: "",
  extraPlants: "",
  variety: "",
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
    expect(next.requiredPlants).toBe("3556");
  });

  it("defaults worker extra to +100", () => {
    const next = applyHusTemplateToDraft(draft, "Hus 3");

    expect(next.extraPlants).toBe(String(DEFAULT_WORKER_EXTRA));
    expect(operationalTotal(Number(next.requiredPlants), Number(next.extraPlants))).toBe(3844);
  });

  it("allows changing +100 for one cycle without changing the template", () => {
    const next = { ...applyHusTemplateToDraft(draft, "Hus 6"), extraPlants: "50" };

    expect(operationalTotal(Number(next.requiredPlants), Number(next.extraPlants))).toBe(3606);
    expect(findHusTemplate("Hus 6")?.agronomistSowCount).toBe(3556);
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

  it("supports non-standard Hus values", () => {
    const next = applyHusTemplateToDraft(draft, "Hus X");

    expect(next.sectorName).toBe("Hus X");
    expect(next.requiredPlants).toBe("");
    expect(next.variety).toBe("");
  });

  it("does not mutate standard templates when editing a draft", () => {
    const before = standardHusTemplates.find((template) => template.hus === "Hus 3");
    const next = updateDraftCycleLength({ ...applyHusTemplateToDraft(draft, "Hus 3"), variety: "Cita" }, 23);

    expect(next.variety).toBe("Cita");
    expect(before).toEqual({ hus: "Hus 3", agronomistSowCount: 3744, variety: "Baltazsara" });
  });
});

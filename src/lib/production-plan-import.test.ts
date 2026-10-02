import { describe, expect, it } from "vitest";
import {
  buildProductionPlanImportResult,
  DEFAULT_IMPORT_WORKER_EXTRA,
  extractedRowToCandidate,
  normalizePlanDate,
  unconfiguredProductionPlanImportResult,
} from "./production-plan-import";

describe("production plan photo import parsing", () => {
  it("normalizes printed Latvian date formats", () => {
    expect(normalizePlanDate("29.09.2026")).toBe("2026-09-29");
    expect(normalizePlanDate("21/10/26")).toBe("2026-10-21");
    expect(normalizePlanDate("2026-10-21")).toBe("2026-10-21");
  });

  it("uses biological day cycle convention for extracted dates", () => {
    const candidate = extractedRowToCandidate({
      hus: "Hus 6",
      moveOutDate: "23.10.2026",
      sowingCount: 3556,
      sowingDate: "01.10.2026",
      variety: "Baltazsara",
    });

    expect(candidate.cycleLength).toBe(23);
  });

  it("defaults worker reserve to +100 and calculates operational total from Såantall", () => {
    const candidate = extractedRowToCandidate({
      hus: "Hus 6",
      moveOutDate: "21.10.2026",
      sowingCount: 3556,
      sowingDate: "29.09.2026",
      variety: "Baltazsara",
    });

    expect(candidate.fields.extraPlants.value).toBe(DEFAULT_IMPORT_WORKER_EXTRA);
    expect(candidate.operationalTotal).toBe(3656);
  });

  it("compares extracted Hus values to templates without replacing the photo value", () => {
    const candidate = extractedRowToCandidate({
      hus: "Hus 7",
      moveOutDate: "28.10.2026",
      sowingCount: 5057,
      sowingDate: "06.10.2026",
      variety: "Baltazsara",
    });

    expect(candidate.fields.requiredPlants.value).toBe(5057);
    expect(candidate.warnings.join(" ")).toContain("atšķiras no Hus šablona");
  });

  it("flags missing required fields and invalid dates", () => {
    const candidate = extractedRowToCandidate({
      hus: "Hus 404",
      moveOutDate: "32.10.2026",
      sowingDate: "",
      variety: "Baltazsara",
    });

    expect(candidate.selected).toBe(false);
    expect(candidate.warnings).toContain("Nezināms Hus.");
    expect(candidate.warnings).toContain("Trūkst vai nederīgs sēšanas datums.");
    expect(candidate.warnings).toContain("Trūkst vai nederīgs izvākšanas datums.");
    expect(candidate.warnings).toContain("Trūkst agronoma sējamais skaits.");
  });

  it("builds review-only import results without Supabase write intent", () => {
    const result = buildProductionPlanImportResult({
      extractedAt: "2026-10-01T10:00:00.000Z",
      fileName: "plan.jpg",
      provider: "fixture",
      rows: [
        {
          hus: "Hus 6",
          moveOutDate: "21.10.2026",
          sowingCount: 3556,
          sowingDate: "29.09.2026",
          variety: "Baltazsara",
        },
      ],
    });

    expect(result.providerConfigured).toBe(true);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).not.toHaveProperty("supabaseRecord");
  });

  it("returns a safe unconfigured result instead of fake production extraction", () => {
    const result = unconfiguredProductionPlanImportResult("photo.png");

    expect(result.providerConfigured).toBe(false);
    expect(result.mode).toBe("unconfigured");
    expect(result.candidates).toEqual([]);
  });
});

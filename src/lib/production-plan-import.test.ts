import { describe, expect, it } from "vitest";
import {
  buildProductionPlanImportResult,
  DEFAULT_IMPORT_WORKER_EXTRA,
  extractedRowToCandidate,
  importCandidateToSowingPlanRow,
  importCandidateValidationErrors,
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
      agronomistRequiredPlants: 3500,
      hus: "Hus 6",
      moveOutDate: "21.10.2026",
      sowingCount: 3556,
      sowingDate: "29.09.2026",
      variety: "Baltazsara",
    });

    expect(candidate.fields.extraPlants.value).toBe(DEFAULT_IMPORT_WORKER_EXTRA);
    expect(candidate.fields.greenhouseRequiredPlants.value).toBe(3500);
    expect(candidate.fields.requiredPlants.value).toBe(3556);
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

  it("builds import review results without writing to Supabase during extraction", () => {
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

  it("converts reviewed Hus 3 photo values to a SowingPlanRow for confirmed import", () => {
    const candidate = extractedRowToCandidate({
      agronomistRequiredPlants: 3600,
      hus: "Hus 3",
      moveOutDate: "23.10.2026",
      sowingCount: 3744,
      sowingDate: "01.10.2026",
      variety: "Baltazsara",
      weekNumber: 40,
    });

    const row = importCandidateToSowingPlanRow(candidate, {
      id: "imported-hus-3",
      now: "2026-10-05T10:00:00.000Z",
      plantsPerBox: 12,
    });

    expect(row.sectorName).toBe("Hus 3");
    expect(row.greenhouseRequiredPlants).toBe(3600);
    expect(row.requiredPlants).toBe(3744);
    expect(row.extraPlants).toBe(100);
    expect(row.requiredPlants + row.extraPlants).toBe(3844);
    expect(row.weekNumber).toBe(40);
    expect(row.source).toBe("import");
    expect(row.status).toBe("imported");
  });

  it("updates an existing duplicate row instead of creating a second identity", () => {
    const candidate = extractedRowToCandidate({
      agronomistRequiredPlants: 3600,
      hus: "Hus 3",
      moveOutDate: "23.10.2026",
      sowingCount: 3744,
      sowingDate: "01.10.2026",
      variety: "Baltazsara",
    });

    const row = importCandidateToSowingPlanRow(candidate, {
      existingRow: {
        id: "existing-row",
        sectorName: "Hus 3",
        requiredPlants: 3700,
        extraPlants: 100,
        variety: "Baltazsara",
        sowingDate: "2026-10-01",
        harvestDate: "2026-10-23",
        cycleLength: 23,
        sectorType: 26,
        plantsPerBox: 12,
        correction: 0,
        updatedAt: "2026-10-04T10:00:00.000Z",
      },
      id: "new-id-should-not-be-used",
      now: "2026-10-05T10:00:00.000Z",
      plantsPerBox: 12,
    });

    expect(row.id).toBe("existing-row");
    expect(row.updatedAt).toBe("2026-10-04T10:00:00.000Z");
    expect(row.greenhouseRequiredPlants).toBe(3600);
    expect(row.requiredPlants).toBe(3744);
  });

  it("rejects confirmed import candidates with missing critical fields", () => {
    const candidate = extractedRowToCandidate({
      agronomistRequiredPlants: 3600,
      hus: "Hus 3",
      moveOutDate: "",
      sowingCount: 3744,
      sowingDate: "01.10.2026",
      variety: "Baltazsara",
    });

    expect(importCandidateValidationErrors(candidate)).toContain("Nav norādīts izvākšanas datums.");
    expect(() =>
      importCandidateToSowingPlanRow(candidate, {
        id: "invalid",
        now: "2026-10-05T10:00:00.000Z",
        plantsPerBox: 12,
      }),
    ).toThrow("Nav norādīts izvākšanas datums.");
  });

  it("returns a safe unconfigured result instead of fake production extraction", () => {
    const result = unconfiguredProductionPlanImportResult("photo.png");

    expect(result.providerConfigured).toBe(false);
    expect(result.mode).toBe("unconfigured");
    expect(result.candidates).toEqual([]);
  });
});

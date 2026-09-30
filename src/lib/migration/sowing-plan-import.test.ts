import { describe, expect, it } from "vitest";
import {
  countImportableRows,
  importIdentityFromValues,
  importPreviewForRow,
  validateImportRow,
} from "./sowing-plan-import";

const realRow = {
  id: "local-real-1",
  sectorName: "Hus 4",
  requiredPlants: 5000,
  extraPlants: 144,
  variety: "Balta",
  sowingDate: "2026-10-07",
  harvestDate: "2026-10-29",
  cycleLength: 23,
  sectorType: 39,
  correction: 0,
  status: "planned",
  source: "user",
};

describe("Supabase sowing plan import helpers", () => {
  it("validates a real localStorage row and creates a stable duplicate identity", () => {
    const result = validateImportRow(realRow);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.row.identityKey).toBe("hus 4|2026-10-07|2026-10-29");
    expect(result.row.plantCount).toBe(5144);
    expect(importIdentityFromValues("  HUS   4 ", "2026-10-07", "2026-10-29")).toBe(result.row.identityKey);
  });

  it("excludes built-in demo rows", () => {
    const result = validateImportRow({
      ...realRow,
      id: "plan-hus-3",
      sectorName: "Hus 3",
      sowingDate: "2026-09-02",
      harvestDate: "2026-09-23",
      source: "demo",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.preview.action).toBe("exclude");
    expect(result.preview.reason).toContain("Demo");
  });

  it("excludes rows that are clearly marked as test data", () => {
    const result = validateImportRow({
      ...realRow,
      id: "local-test",
      sectorName: "Test Hus",
      source: "user",
    });

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.preview.reason).toContain("Testa");
  });

  it("counts only create actions as importable rows", () => {
    const result = validateImportRow(realRow);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const rows = [
      importPreviewForRow(result.row, "create"),
      importPreviewForRow(result.row, "skipDuplicate", "Already exists"),
      { ...importPreviewForRow(result.row, "exclude"), reason: "Demo" },
    ];

    expect(countImportableRows(rows)).toBe(1);
  });
});

import { describe, expect, it } from "vitest";
import { calculateGreenhouseTablePlacement } from "./greenhouse-placement";

describe("standalone greenhouse table placement", () => {
  it.each([
    [3656, 24, 0, "normal"],
    [3844, 26, 0, "normal"],
    [4200, 26, 0, "slightlyCompressed"],
    [5000, 33, 7, "normal"],
    [6157, 39, 13, "slightlyCompressed"],
  ] as const)(
    "places %i plants into an operationally sensible layout",
    (plants, totalTables, extraTables, densityClass) => {
      const placement = calculateGreenhouseTablePlacement(plants);

      expect(placement.totalTables).toBe(totalTables);
      expect(placement.primaryRowTables).toBe(Math.min(totalTables, 26));
      expect(placement.extraTables).toBe(extraTables);
      expect(placement.densityClass).toBe(densityClass);
      expect(placement.plantsPerTrough).toBeLessThanOrEqual(35);
    },
  );

  it("keeps about 4200 plants in one slightly compressed row instead of 26+1", () => {
    const placement = calculateGreenhouseTablePlacement(4200);

    expect(placement.totalTables).toBe(26);
    expect(placement.extraTables).toBe(0);
    expect(placement.plantsPerTrough).toBeCloseTo(26.9, 1);
    expect(placement.reason).toContain("vienā 26 galdu rindā");
  });

  it("uses extra tables for genuinely large sectors instead of forcing one exceptional row", () => {
    const placement = calculateGreenhouseTablePlacement(5000);

    expect(placement.totalTables).toBeGreaterThan(26);
    expect(placement.extraTables).toBeGreaterThan(0);
    expect(placement.plantsPerTrough).toBeLessThan(28);
  });

  it("does not expand smaller sectors to a full 26-table row just to fill the row", () => {
    const placement = calculateGreenhouseTablePlacement(3656);

    expect(placement.totalTables).toBeLessThan(26);
    expect(placement.densityClass).toBe("normal");
  });

  it("never proposes a layout above 35 plants per trough", () => {
    [3656, 3844, 4200, 5000, 6157].forEach((plants) => {
      expect(calculateGreenhouseTablePlacement(plants).plantsPerTrough).toBeLessThanOrEqual(35);
    });
  });
});

import { describe, expect, it } from "vitest";
import {
  addDays,
  calculateAvailability,
  calculateBoxPlan,
  calculateBoxesNeeded,
  calculatePlantBalance,
  calculateRecommendedTables,
  compactMonthlyPrintRows,
  calculateSowingPlan,
  calculateThinningPlan,
  calculateWorkMaterialSummary,
  balanceWorkload,
  countMainWork,
  createPlacementPlan,
  continuousWorkPlanPrintRows,
  daysBetween,
  getAllCapacityConflicts,
  applyWorkloadBalanceProposals,
  generateBaseWorkItemsForRows,
  generateMonthlyWorkPlan,
  generateWorksheetDays,
  generateWorksheetDaysFromWorkItems,
  generateWorkItems,
  generateWorkItemsForRows,
  getActualPlantCount,
  getPlantCorrectionTotal,
  getTotalSow,
  groupMonthlyPrintRowsByDate,
  groupMonthlyPrintRowsIntoDateGroups,
  formatSowingTableSelection,
  isAllowedMove,
  parseSowingTableSelection,
  removePlantCorrection,
  signedPlantCorrectionAmount,
  sowingTableIds,
  toggleSowingTableSelection,
  upsertPlantCorrection,
} from "./planning";
import { candidateCycleLength, mockPlanImportService } from "./plan-import-service";
import { deriveCycleLength } from "./hus-templates";
import { recordToSowingPlanRow, rowPlantCorrectionsToRecords, sowingPlanRowToRecord } from "./supabase/mappers";
import type { SowingPlanRow, WorkItem, WorkType } from "./types";

const row: SowingPlanRow = {
  id: "test",
  sectorName: "Hus 3",
  requiredPlants: 3400,
  extraPlants: 142,
  variety: "Proloog",
  sowingDate: "2026-09-25",
  harvestDate: "2026-10-16",
  cycleLength: 22,
  sectorType: 26,
  plantsPerBox: 30,
  correction: 0,
};

function printWorkItem(overrides: Partial<WorkItem> & Pick<WorkItem, "date" | "planRowId" | "sectorName" | "type">): WorkItem {
  return {
    id: `${overrides.planRowId}-${overrides.type}-${overrides.date}`,
    variety: "Baltazsara",
    title:
      overrides.type === "removeFilm"
        ? "Noņemt plēvi"
        : overrides.type === "addAgrofilm"
          ? "Uzlikt agroplēvi"
          : overrides.type === "previcur"
            ? "Previcur"
          : overrides.type === "harvest"
            ? "Izvākšana"
            : "Retināšana",
    cycleDay: 1,
    plantCount: 3600,
    fixed: false,
    scheduleKind: "fixed",
    workloadWeight: 0,
    color: "mint",
    details: [],
    ...overrides,
  };
}

describe("planning calculations", () => {
  it("calculates cycle length inclusively from sowing and harvest dates", () => {
    expect(daysBetween("2026-09-25", "2026-10-16")).toBe(22);
  });

  it("uses required plus extra as the total sow count", () => {
    expect(getTotalSow(row)).toBe(3542);
  });

  it("calculates full sowing tables and partial table reserve rows", () => {
    const plan = calculateSowingPlan(3542);

    expect(plan.fullTables).toBe(2);
    expect(plan.partialRows).toBe(38);
    expect(plan.partialRowsWithReserve).toBe(43);
    expect(plan.label).toBe("2 pilni galdi + nepilns galds 16x43");
  });

  it("chooses a thinning plan inside the 23-28 plants per gutter target", () => {
    const plan = calculateThinningPlan(3542, 26);

    expect(plan.tables).toBeLessThanOrEqual(26);
    expect(plan.plantsPerGutterMin).toBeGreaterThanOrEqual(23);
    expect(plan.plantsPerGutterMax).toBeLessThanOrEqual(28);
    expect(plan.withinTargetRange).toBe(true);
  });

  it("calculates box count with ceiling", () => {
    expect(calculateBoxesNeeded(101, 25)).toBe(5);
  });

  it("keeps material summaries consistent between work items and print rows", () => {
    const items = generateWorkItems(row, { defaultPlantsPerBox: 30 });
    const materials = calculateWorkMaterialSummary(row);
    const sowing = items.find((item) => item.type === "sowing");
    const thinning = items.find((item) => item.type === "thinning");
    const harvest = items.find((item) => item.type === "harvest");
    const printRows = compactMonthlyPrintRows(items);

    expect(sowing?.details).toContain(materials.sowing);
    expect(thinning?.details).toContain(materials.thinning);
    expect(harvest?.details).toContain(materials.harvest);
    expect(printRows.find((item) => item.workTitle === "Sēšana")?.notes).toContain(materials.sowing);
    expect(printRows.find((item) => item.workTitle === "Retināšana")?.notes).toContain(materials.thinning);
    expect(printRows.find((item) => item.workTitle === "Izvākšana")?.notes).toContain(materials.harvest);
  });

  it("calculates actual plant balance from correction history without changing the original sow count", () => {
    const corrected: SowingPlanRow = {
      ...row,
      greenhouseRequiredPlants: 3600,
      requiredPlants: 3744,
      extraPlants: 100,
      plantCorrections: [
        { id: "loss-1", amount: -100, date: "2026-10-08", reason: "thinning" },
        { id: "loss-2", amount: -68, date: "2026-10-12", reason: "brownRoots" },
        { id: "loss-3", amount: -70, date: "2026-10-13", reason: "brownRoots" },
      ],
    };

    expect(getTotalSow(corrected)).toBe(3844);
    expect(getPlantCorrectionTotal(corrected)).toBe(-238);
    expect(getActualPlantCount(corrected)).toBe(3606);
    expect(calculatePlantBalance(corrected)).toMatchObject({
      actualPlants: 3606,
      correctionTotal: -238,
      difference: 6,
      label: "Rezerve 6 stādi",
      tone: "ok",
    });
    expect(getTotalSow(corrected)).toBe(3844);
  });

  it("calculates reserve and shortage against greenhouse required plants", () => {
    const baseBalanceRow: SowingPlanRow = {
      ...row,
      greenhouseRequiredPlants: 3600,
      requiredPlants: 3744,
      extraPlants: 100,
    };

    expect(getTotalSow(baseBalanceRow)).toBe(3844);
    expect(calculatePlantBalance({ ...baseBalanceRow, plantCorrections: [{ id: "loss", amount: -168, date: "2026-10-08", reason: "thinning" }] })).toMatchObject({
      actualPlants: 3676,
      difference: 76,
      label: "Rezerve 76 stādi",
      tone: "ok",
    });
    expect(calculatePlantBalance({ ...baseBalanceRow, plantCorrections: [{ id: "loss", amount: -244, date: "2026-10-08", reason: "thinning" }] })).toMatchObject({
      actualPlants: 3600,
      difference: 0,
      label: "Rezerve 0 stādi",
      tone: "ok",
    });
    expect(calculatePlantBalance({ ...baseBalanceRow, plantCorrections: [{ id: "loss", amount: -274, date: "2026-10-08", reason: "thinning" }] })).toMatchObject({
      actualPlants: 3570,
      difference: -30,
      label: "Trūkst 30 stādi",
      tone: "short",
    });
  });

  it("calculates the live Hus balance after multiple losses", () => {
    const baseBalanceRow: SowingPlanRow = {
      ...row,
      greenhouseRequiredPlants: 3600,
      requiredPlants: 3744,
      extraPlants: 100,
    };

    expect(calculatePlantBalance(baseBalanceRow)).toMatchObject({
      actualPlants: 3844,
      difference: 244,
      label: "Rezerve 244 stādi",
    });
    expect(calculatePlantBalance({
      ...baseBalanceRow,
      plantCorrections: [{ id: "loss-1", amount: -100, date: "2026-10-08", reason: "thinning" }],
    })).toMatchObject({
      actualPlants: 3744,
      difference: 144,
      label: "Rezerve 144 stādi",
    });
    expect(calculatePlantBalance({
      ...baseBalanceRow,
      plantCorrections: [
        { id: "loss-1", amount: -100, date: "2026-10-08", reason: "thinning" },
        { id: "loss-2", amount: -68, date: "2026-10-12", reason: "brownRoots" },
      ],
    })).toMatchObject({
      actualPlants: 3676,
      difference: 76,
      label: "Rezerve 76 stādi",
    });
  });

  it("stores plant correction direction as signed amounts", () => {
    expect(signedPlantCorrectionAmount("loss", 100)).toBe(-100);
    expect(signedPlantCorrectionAmount("loss", -100)).toBe(-100);
    expect(signedPlantCorrectionAmount("addition", 100)).toBe(100);
    expect(signedPlantCorrectionAmount("addition", -100)).toBe(100);
  });

  it("edits and deletes plant correction events by id", () => {
    const entries = [
      { id: "loss-1", amount: -100, date: "2026-10-08", reason: "thinning" as const },
      { id: "loss-2", amount: -68, date: "2026-10-12", reason: "brownRoots" as const },
    ];

    const edited = upsertPlantCorrection(entries, {
      id: "loss-2",
      amount: -70,
      date: "2026-10-13",
      reason: "brownRoots",
    });

    expect(edited).toEqual([
      entries[0],
      { id: "loss-2", amount: -70, date: "2026-10-13", reason: "brownRoots" },
    ]);
    expect(removePlantCorrection(edited, "loss-1")).toEqual([
      { id: "loss-2", amount: -70, date: "2026-10-13", reason: "brownRoots" },
    ]);
  });

  it("does not infer greenhouse required plants from old rows", () => {
    const corrected: SowingPlanRow = {
      ...row,
      requiredPlants: 3700,
      extraPlants: 207,
      plantCorrections: [{ id: "gain", amount: -100, date: "2026-10-08", reason: "thinning" }],
    };

    expect(calculatePlantBalance(corrected)).toMatchObject({
      actualPlants: 3807,
      difference: null,
      label: "Siltumnīcas nepieciešamais daudzums nav norādīts",
      tone: "unknown",
    });
  });

  it("maps plant correction history as separate persistent events", () => {
    const corrected: SowingPlanRow = {
      ...row,
      plantCorrections: [
        { id: "loss-1", amount: -100, date: "2026-10-08", reason: "thinning" },
        { id: "loss-2", amount: -68, date: "2026-10-12", reason: "brownRoots", note: "2 galdi" },
      ],
    };
    const records = rowPlantCorrectionsToRecords(corrected);
    const mapped = recordToSowingPlanRow({
      id: row.id,
      hus: row.sectorName,
      greenhouse_required_plants: 3300,
      required_plants: row.requiredPlants,
      extra_plants: row.extraPlants,
      variety: row.variety,
      week_number: null,
      sowing_tables: null,
      sowing_date: row.sowingDate,
      move_out_date: row.harvestDate,
      previcure_date: null,
      cycle_length: row.cycleLength,
      sector_type: row.sectorType,
      correction: row.correction,
      status: "planned",
      source: "user",
      plant_corrections: records,
    });

    expect(records).toHaveLength(2);
    expect(mapped.plantCorrections).toEqual(corrected.plantCorrections);
    expect(mapped.greenhouseRequiredPlants).toBe(3300);
  });

  it("round-trips greenhouse required plants through Supabase mappers", () => {
    const record = sowingPlanRowToRecord({ ...row, greenhouseRequiredPlants: 3600 });

    expect(record?.greenhouse_required_plants).toBe(3600);
    expect(record?.required_plants).toBe(row.requiredPlants);
    expect(recordToSowingPlanRow({ ...record!, greenhouse_required_plants: null }).greenhouseRequiredPlants).toBeUndefined();
    expect(recordToSowingPlanRow(record!)).toMatchObject({
      greenhouseRequiredPlants: 3600,
      requiredPlants: row.requiredPlants,
    });
  });

  it("does not change scheduler dates when plant corrections are added", () => {
    const before = generateWorkItems(row, { defaultPlantsPerBox: 30 }).map((item) => `${item.type}:${item.date}`);
    const after = generateWorkItems(
      {
        ...row,
        plantCorrections: [{ id: "loss", amount: -100, date: "2026-10-08", reason: "thinning" }],
      },
      { defaultPlantsPerBox: 30 },
    ).map((item) => `${item.type}:${item.date}`);

    expect(after).toEqual(before);
  });

  it("keeps 3500 and 4200 plant batches in one 26 table row", () => {
    expect(calculateRecommendedTables(3500)).toBeLessThanOrEqual(26);
    expect(calculateRecommendedTables(4200)).toBe(26);
  });

  it("uses extra 13 tables for large 5000-6000 plant batches", () => {
    expect(calculateRecommendedTables(5000)).toBeGreaterThan(26);
    expect(calculateRecommendedTables(6000)).toBeLessThanOrEqual(39);
  });

  it("generates thinning on day 9 and harvest on the planned harvest date", () => {
    const items = generateWorkItems(row, { defaultPlantsPerBox: 30 });

    expect(items.find((item) => item.type === "thinning")?.date).toBe("2026-10-03");
    expect(items.find((item) => item.type === "rings")?.date).toBe("2026-10-15");
    expect(items.find((item) => item.type === "harvest")?.date).toBe("2026-10-16");
  });

  it("limits movable work to allowed cycle days", () => {
    expect(isAllowedMove(row, "thinning", "2026-10-02")).toBe(true);
    expect(isAllowedMove(row, "thinning", "2026-10-05")).toBe(false);
    expect(isAllowedMove(row, "sideShoots", "2026-10-10")).toBe(false);
    expect(isAllowedMove(row, "sideShoots", "2026-10-11")).toBe(true);
  });

  it("reports available plants after correction against greenhouse required plants", () => {
    expect(calculateAvailability({ ...row, greenhouseRequiredPlants: 3300, correction: -300 }).label).toBe("🔴 Trūkst 58");
    expect(calculateAvailability({ ...row, greenhouseRequiredPlants: 3300, correction: -38 }).label).toBe("🟢 +204 extra");
    expect(calculateAvailability({ ...row, correction: -38 }).label).toBe("Nav norādīts siltumnīcai nepieciešamais skaits");
  });

  it("detects a fourth overlapping batch capacity conflict", () => {
    const rows = ["A", "B", "C"].map((primaryRow, index) => ({
      ...row,
      id: `busy-${primaryRow}`,
      sectorName: `Hus ${index}`,
      sowingDate: "2026-09-20",
      harvestDate: "2026-10-20",
      placement: { primaryRow: primaryRow as "A" | "B" | "C", tables: 26, manual: true },
    }));
    const fourth = { ...row, id: "fourth", sectorName: "Hus 7" };
    const placement = createPlacementPlan(fourth, [...rows, fourth]);

    expect(placement.conflict?.overlapping).toHaveLength(4);
    expect(placement.conflict?.standardCapacity).toBe(78);
  });

  it("shows no conflict when 9th day is full but thinning is manually moved to day 10 after release", () => {
    const busyRows = ["A", "B", "C"].map((primaryRow) => ({
      ...row,
      id: `busy-${primaryRow}`,
      sowingDate: "2026-09-20",
      harvestDate: "2026-10-04",
      placement: { primaryRow: primaryRow as "A" | "B" | "C", tables: 26, manual: true },
    }));
    const moved = {
      ...row,
      id: "moved",
      adjustments: { thinning: "2026-10-04" },
    };

    expect(createPlacementPlan({ ...row, id: "blocked" }, [...busyRows, row]).conflict).toBeDefined();
    expect(createPlacementPlan(moved, [...busyRows, moved]).conflict).toBeUndefined();
  });

  it("recalculates density after manual table reduction", () => {
    const placement = createPlacementPlan({ ...row, placement: { tables: 20, manual: true } });

    expect(placement.tables).toBe(20);
    expect(placement.averagePlantsPerGutter).toBeCloseTo(29.52, 2);
  });

  it("calculates 12 plant boxes and partial last box", () => {
    expect(calculateBoxPlan({ ...row, requiredPlants: 3600, extraPlants: 0 }).label).toBe("300 pilnas kastītes");
    expect(calculateBoxPlan({ ...row, requiredPlants: 3745, extraPlants: 0 }).label).toBe(
      "312 pilnas kastītes + 1 nepilna kastīte ar 1 stādiem",
    );
  });

  it("summarizes table conflicts for a selected date", () => {
    const rows = [0, 1, 2, 3].map((index) => ({
      ...row,
      id: `overlap-${index}`,
      sectorName: `Hus ${index}`,
      placement: { tables: 26, manual: true },
    }));

    expect(getAllCapacityConflicts(rows, "2026-10-03")[0].totalTables).toBe(104);
  });

  it("returns mock photo import candidates with review metadata", async () => {
    const file = new File(["demo"], "plans.png", { type: "image/png" });
    const result = await mockPlanImportService.analyzeImage(file);

    expect(result.mode).toBe("mock");
    expect(result.fileName).toBe("plans.png");
    expect(result.candidates.length).toBeGreaterThanOrEqual(3);
    expect(result.candidates.some((candidate) => candidate.fields.requiredPlants.needsReview)).toBe(true);
  });

  it("calculates an imported candidate cycle from checked dates", async () => {
    const file = new File(["demo"], "plans.png", { type: "image/png" });
    const result = await mockPlanImportService.analyzeImage(file);
    const candidate = result.candidates[0];

    expect(candidateCycleLength(candidate)).toBe(
      deriveCycleLength(candidate.fields.sowingDate.value, candidate.fields.harvestDate.value),
    );
  });

  it("generates printable worksheet rows for the cycle without adding an extra spray-tables day", () => {
    expect(generateWorksheetDays({ ...row, cycleLength: 21, harvestDate: "2026-10-15" }, { defaultPlantsPerBox: 30 })).toHaveLength(21);
    expect(generateWorksheetDays(row, { defaultPlantsPerBox: 30 })).toHaveLength(22);
    expect(generateWorksheetDays({ ...row, cycleLength: 23, harvestDate: "2026-10-17" }, { defaultPlantsPerBox: 30 })).toHaveLength(23);
  });

  it("places previcure into the printable worksheet and monthly plan when set", () => {
    const withPrevicure = { ...row, previcureDate: "2026-10-01" };
    const worksheetDay = generateWorksheetDays(withPrevicure, { defaultPlantsPerBox: 30 }).find(
      (day) => day.date === "2026-10-01",
    );
    const monthly = generateMonthlyWorkPlan([withPrevicure], { defaultPlantsPerBox: 30 }, "2026-10-01");

    expect(worksheetDay?.works.map((work) => work.type)).toContain("previcure");
    expect(monthly.map((work) => work.type)).toContain("previcure");
  });

  it("filters the monthly work plan by selected month", () => {
    const september = generateMonthlyWorkPlan([row], { defaultPlantsPerBox: 30 }, "2026-09-01");
    const october = generateMonthlyWorkPlan([row], { defaultPlantsPerBox: 30 }, "2026-10-01");

    expect(september.every((item) => item.date.startsWith("2026-09"))).toBe(true);
    expect(october.every((item) => item.date.startsWith("2026-10"))).toBe(true);
    expect(october.length).toBeGreaterThan(september.length);
  });

  it("does not count sowing as workload for overload planning", () => {
    const items = generateWorkItems(row, { defaultPlantsPerBox: 30 });

    expect(countMainWork(items, row.sowingDate)).toBe(0);
    expect(countMainWork(items, row.harvestDate)).toBe(1);
  });

  it("generates minor Hus tasks without adding main workload", () => {
    const items = generateWorkItems(row, { defaultPlantsPerBox: 30 });
    const byType = Object.fromEntries(items.map((item) => [item.type, item]));

    expect(byType.removeFilm.date).toBe(cycleDayDateForTest(row, 3));
    expect(byType.addAgrofilm.date).toBe(cycleDayDateForTest(row, 3));
    expect(byType.removeAgrofilm.date).toBe(cycleDayDateForTest(row, 5));
    expect(byType.previcur.date).toBe(byType.thinning.date);
    expect(byType.disinfectTables.date).toBe(byType.thinning.date);
    expect(byType.sprayTables.date).toBe(row.harvestDate);
    expect(countMainWork(items, byType.thinning.date)).toBe(1);
    expect(countMainWork(items, cycleDayDateForTest(row, 3))).toBe(0);
  });

  it("formats sowing table selections as compact ranges", () => {
    expect(formatSowingTableSelection(["A3", "A4", "A5", "A6", "A7"])).toBe("A3–A7");
    expect(formatSowingTableSelection(["A1", "A2", "A5"])).toBe("A1–A2, A5");
    expect(formatSowingTableSelection(["A1"])).toBe("A1");
    expect(parseSowingTableSelection("A3–A7")).toEqual(["A3", "A4", "A5", "A6", "A7"]);
    expect(parseSowingTableSelection("A1-A2, A5")).toEqual(["A1", "A2", "A5"]);
  });

  it("offers exactly sowing tables A1 through A13", () => {
    expect(sowingTableIds).toEqual(["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8", "A9", "A10", "A11", "A12", "A13"]);
    expect(new Set(sowingTableIds).size).toBe(13);
  });

  it("keeps sowing table dialog edits local until saved", () => {
    const savedValue = "A1";
    const draft = toggleSowingTableSelection(parseSowingTableSelection(savedValue), "A2");

    expect(formatSowingTableSelection(draft)).toBe("A1–A2");
    expect(formatSowingTableSelection(parseSowingTableSelection(savedValue))).toBe("A1");
  });

  it("prints minor monthly work as notes instead of separate rows", () => {
    const items = generateWorkItems(row, { defaultPlantsPerBox: 30 });
    const compactRows = compactMonthlyPrintRows(items);
    const thinningRow = compactRows.find((item) => item.workTitle === "Retināšana");
    const harvestRow = compactRows.find((item) => item.workTitle === "Izvākšana");
    const dayThreeRow = compactRows.find((item) => item.date === cycleDayDateForTest(row, 3));

    expect(thinningRow?.notes).toContain("Previcur");
    expect(thinningRow?.notes).toContain("Dezinficēt galdus");
    expect(harvestRow?.notes).toContain("Nomiglot galdus");
    expect(dayThreeRow?.workTitle).toBe("—");
    expect(dayThreeRow?.notes).toBe("Noņemt plēvi · Uzlikt agroplēvi");
    expect(compactRows.some((item) => item.workTitle === "Nomiglot galdus")).toBe(false);
  });

  it("marks only the first monthly print row for each date to show the date", () => {
    const grouped = groupMonthlyPrintRowsByDate([
      { date: "2026-10-01", planRowId: "a", sectorName: "Hus 4", plantCount: 3919, workTitle: "Retināšana", notes: "Previcur" },
      { date: "2026-10-01", planRowId: "b", sectorName: "Hus 6", plantCount: 3656, workTitle: "—", notes: "Noņemt plēvi" },
      { date: "2026-10-02", planRowId: "c", sectorName: "Hus 10B", plantCount: 3684, workTitle: "Izvākšana", notes: "Nomiglot galdus" },
    ]);

    expect(grouped.map((item) => item.showDate)).toEqual([true, false, true]);
    expect(grouped.map((item) => item.startsNewDate)).toEqual([true, false, true]);
  });

  it("prints a continuous work plan across month boundaries", () => {
    const rows = continuousWorkPlanPrintRows(
      [
        printWorkItem({ date: "2026-09-30", planRowId: "old", sectorName: "Hus Old", type: "thinning" }),
        printWorkItem({ date: "2026-11-01", planRowId: "november", sectorName: "Hus 9", type: "harvest" }),
        printWorkItem({ date: "2026-10-31", planRowId: "october", sectorName: "Hus 8", type: "thinning" }),
      ],
      "2026-10-01",
    );

    expect(rows.map((item) => item.date)).toEqual(["2026-10-31", "2026-11-01"]);
  });

  it("keeps every print row inside date groups without dropping rows", () => {
    const rows = [
      { date: "2026-10-31", planRowId: "a", sectorName: "Hus 8", plantCount: 3457, workTitle: "Retināšana", notes: "Previcur" },
      { date: "2026-10-31", planRowId: "b", sectorName: "Hus 9", plantCount: 3707, workTitle: "Gredzeni", notes: "" },
      { date: "2026-11-01", planRowId: "c", sectorName: "Hus 10A", plantCount: 4195, workTitle: "Izvākšana", notes: "Nomiglot galdus" },
    ];
    const groups = groupMonthlyPrintRowsIntoDateGroups(rows);

    expect(groups.map((group) => group.date)).toEqual(["2026-10-31", "2026-11-01"]);
    expect(groups[0].rows.map((item) => item.planRowId)).toEqual(["a", "b"]);
    expect(groups.flatMap((group) => group.rows)).toHaveLength(rows.length);
    expect(groups[0].rows.map((item) => item.showDate)).toEqual([true, false]);
  });

  it("keeps major work in work title and minor work in notes for continuous print rows", () => {
    const rows = compactMonthlyPrintRows([
      printWorkItem({ date: "2026-10-31", planRowId: "major-minor", sectorName: "Hus 8", type: "thinning" }),
      printWorkItem({ date: "2026-10-31", planRowId: "major-minor", sectorName: "Hus 8", type: "previcur" }),
      printWorkItem({ date: "2026-11-01", planRowId: "minor-only", sectorName: "Hus 9", type: "removeFilm" }),
      printWorkItem({ date: "2026-11-01", planRowId: "minor-only", sectorName: "Hus 9", type: "addAgrofilm" }),
    ]);

    expect(rows.find((item) => item.planRowId === "major-minor")).toMatchObject({
      workTitle: "Retināšana",
      notes: "Previcur",
    });
    expect(rows.find((item) => item.planRowId === "minor-only")).toMatchObject({
      workTitle: "—",
      notes: "Noņemt plēvi · Uzlikt agroplēvi",
    });
  });

  it("renders flexible work on every manually selected work date", () => {
    const adjusted: SowingPlanRow = {
      ...row,
      adjustments: {
        sideShoots: ["2026-10-11", "2026-10-12", "2026-10-13"],
      },
    };
    const sideShootDates = generateWorkItems(adjusted, { defaultPlantsPerBox: 30 })
      .filter((item) => item.type === "sideShoots")
      .map((item) => item.date);

    expect(sideShootDates).toEqual(["2026-10-11", "2026-10-12", "2026-10-13"]);
  });

  it("proposes workload balancing inside allowed biological windows", () => {
    const rows = [
      { ...row, id: "a", sectorName: "Hus A", sowingDate: "2026-09-25", harvestDate: "2026-10-16" },
      { ...row, id: "b", sectorName: "Hus B", sowingDate: "2026-09-25", harvestDate: "2026-10-16" },
      { ...row, id: "c", sectorName: "Hus C", sowingDate: "2026-09-25", harvestDate: "2026-10-16" },
    ];
    const proposals = balanceWorkload(rows, { defaultPlantsPerBox: 30 });
    const thinningProposal = proposals.find((proposal) => proposal.type === "thinning");

    if (thinningProposal) {
      expect(thinningProposal.toDates.every((date) => ["2026-10-02", "2026-10-03", "2026-10-04"].includes(date))).toBe(true);
    }
  });

  it("moves thinning away from day 9 when that day already has a fixed harvest", () => {
    const target: SowingPlanRow = {
      ...row,
      id: "target-thinning",
      sectorName: "Hus T",
      sowingDate: "2026-10-01",
      harvestDate: "2026-10-21",
      cycleLength: 21,
    };
    const fixedHarvest: SowingPlanRow = {
      ...row,
      id: "fixed-harvest",
      sectorName: "Hus Harvest",
      sowingDate: "2026-09-19",
      harvestDate: "2026-10-09",
      cycleLength: 21,
    };
    const proposal = balanceWorkload([target, fixedHarvest], { defaultPlantsPerBox: 30 }).find(
      (item) => item.planRowId === target.id && item.type === "thinning",
    );

    expect(["2026-10-08", "2026-10-10"]).toContain(proposal?.toDates[0]);
    expect(proposal?.toDates[0]).not.toBe("2026-10-09");
  });

  it("moves side shoots after day 17 when the earliest day is already full", () => {
    const target: SowingPlanRow = {
      ...row,
      id: "target-side-shoots",
      sectorName: "Hus P",
      sowingDate: "2026-10-01",
      harvestDate: "2026-10-23",
      cycleLength: 23,
    };
    const busyDay17: SowingPlanRow = {
      ...row,
      id: "busy-day-17",
      sectorName: "Hus Busy",
      sowingDate: "2026-09-27",
      harvestDate: "2026-10-17",
      cycleLength: 21,
    };
    const proposal = balanceWorkload([target, busyDay17], { defaultPlantsPerBox: 30 }).find(
      (item) => item.planRowId === target.id && item.type === "sideShoots",
    );

    expect(proposal?.fromDates).toEqual(["2026-10-17"]);
    expect(proposal?.toDates[0]).not.toBe("2026-10-17");
    expect(proposal?.toDates[0] && proposal.toDates[0] <= "2026-10-21").toBe(true);
  });

  it("keeps side shoots inside their allowed window when balancing crowded days", () => {
    const target: SowingPlanRow = {
      ...row,
      id: "target-split",
      sectorName: "Hus Split",
      sowingDate: "2026-10-01",
      harvestDate: "2026-10-21",
      cycleLength: 21,
    };
    const halfWorkOn17: SowingPlanRow = {
      ...row,
      id: "half-work-on-17",
      sectorName: "Hus K17",
      sowingDate: "2026-09-20",
      harvestDate: "2026-10-30",
      cycleLength: 41,
      adjustments: {
        thinning: "2026-09-27",
        sideShoots: "2026-10-08",
        sticks: "2026-10-17",
      },
    };
    const halfWorkOn18: SowingPlanRow = {
      ...row,
      id: "half-work-on-18",
      sectorName: "Hus K18",
      sowingDate: "2026-09-21",
      harvestDate: "2026-10-30",
      cycleLength: 40,
      adjustments: {
        thinning: "2026-09-28",
        sideShoots: "2026-10-09",
        sticks: "2026-10-18",
      },
    };
    const previcureOn19: SowingPlanRow = {
      ...row,
      id: "previcure-on-19",
      sectorName: "Hus P19",
      sowingDate: "2026-10-10",
      harvestDate: "2026-10-30",
      previcureDate: "2026-10-19",
      cycleLength: 21,
    };
    const proposal = balanceWorkload([target, halfWorkOn17, halfWorkOn18, previcureOn19], {
      defaultPlantsPerBox: 30,
    }).find((item) => item.planRowId === target.id && item.type === "sideShoots");

    expect(proposal?.toDates.length).toBeGreaterThan(0);
    expect(proposal?.toDates.every((date) => date >= "2026-10-17" && date <= "2026-10-19")).toBe(true);
  });

  it("moves half-day sticks away from a full rings day into an empty allowed day", () => {
    const target: SowingPlanRow = {
      ...row,
      id: "target-sticks",
      sectorName: "Hus K",
      sowingDate: "2026-10-03",
      harvestDate: "2026-10-23",
      cycleLength: 21,
      adjustments: {
        sideShoots: "2026-10-18",
      },
    };
    const ringsOnDefaultSticksDay: SowingPlanRow = {
      ...row,
      id: "rings-on-sticks-day",
      sectorName: "Hus R",
      sowingDate: "2026-09-12",
      harvestDate: "2026-10-21",
      cycleLength: 40,
      adjustments: {
        thinning: "2026-09-20",
        sideShoots: "2026-09-28",
        sticks: "2026-10-18",
      },
    };
    const proposal = balanceWorkload([target, ringsOnDefaultSticksDay], { defaultPlantsPerBox: 30 }).find(
      (item) => item.planRowId === target.id && item.type === "sticks",
    );

    expect(proposal?.fromDates).toEqual(["2026-10-20"]);
    expect(proposal?.toDates).toEqual(["2026-10-19"]);
  });

  it("moves side shoots away from an overloaded date when an allowed empty date exists", () => {
    const sideShootsTarget: SowingPlanRow = {
      ...row,
      id: "side-shoots-overload-target",
      sectorName: "Hus Pazares",
      sowingDate: "2026-09-16",
      harvestDate: "2026-10-06",
      cycleLength: 21,
    };
    const thinningOnSecond: SowingPlanRow = {
      ...row,
      id: "thinning-on-second",
      sectorName: "Hus Ret",
      sowingDate: "2026-09-24",
      harvestDate: "2026-10-14",
      cycleLength: 21,
    };
    const harvestOnSecond: SowingPlanRow = {
      ...row,
      id: "harvest-on-second",
      sectorName: "Hus Izv",
      sowingDate: "2026-09-12",
      harvestDate: "2026-10-02",
      cycleLength: 21,
    };
    const proposal = balanceWorkload([sideShootsTarget, thinningOnSecond, harvestOnSecond], {
      defaultPlantsPerBox: 30,
    }).find((item) => item.planRowId === sideShootsTarget.id && item.type === "sideShoots");

    expect(proposal?.fromDates).toEqual(["2026-10-02"]);
    expect(proposal?.toDates[0]).not.toBe("2026-10-02");
    expect(proposal?.toDates[0] && proposal.toDates[0] <= "2026-10-04").toBe(true);
  });

  it("moves sticks away from rings when an adjacent allowed day is empty", () => {
    const sticksTarget: SowingPlanRow = {
      ...row,
      id: "sticks-overload-target",
      sectorName: "Hus Kociņi",
      sowingDate: "2026-10-03",
      harvestDate: "2026-10-23",
      cycleLength: 21,
      adjustments: {
        sideShoots: "2026-10-18",
      },
    };
    const ringsOnSticksDay: SowingPlanRow = {
      ...row,
      id: "rings-on-overload-day",
      sectorName: "Hus Gredzeni",
      sowingDate: "2026-09-12",
      harvestDate: "2026-10-21",
      cycleLength: 40,
      adjustments: {
        thinning: "2026-09-20",
        sideShoots: "2026-09-28",
        sticks: "2026-10-18",
      },
    };
    const proposal = balanceWorkload([sticksTarget, ringsOnSticksDay], { defaultPlantsPerBox: 30 }).find(
      (item) => item.planRowId === sticksTarget.id && item.type === "sticks",
    );

    expect(proposal?.fromDates).toEqual(["2026-10-20"]);
    expect(proposal?.toDates).toEqual(["2026-10-19"]);
  });

  it("chooses day 8 for thinning when day 9 has workload 1.0 and day 10 has workload 0.5", () => {
    const thinningTarget: SowingPlanRow = {
      ...row,
      id: "thinning-day-8-target",
      sectorName: "Hus Retināšana",
      sowingDate: "2026-10-01",
      harvestDate: "2026-10-21",
      cycleLength: 21,
    };
    const workloadOnDay9: SowingPlanRow = {
      ...row,
      id: "workload-day-9",
      sectorName: "Hus Darbs",
      sowingDate: "2026-09-19",
      harvestDate: "2026-11-01",
      previcureDate: "2026-10-09",
      cycleLength: 44,
      adjustments: {
        thinning: "2026-09-26",
        sideShoots: "2026-10-05",
        sticks: "2026-10-27",
      },
    };
    const halfWorkloadOnDay10: SowingPlanRow = {
      ...row,
      id: "workload-day-10",
      sectorName: "Hus Sēšana",
      sowingDate: "2026-10-10",
      harvestDate: "2026-10-30",
      cycleLength: 21,
    };
    const proposal = balanceWorkload([thinningTarget, workloadOnDay9, halfWorkloadOnDay10], {
      defaultPlantsPerBox: 30,
    }).find((item) => item.planRowId === thinningTarget.id && item.type === "thinning");

    expect(proposal?.fromDates).toEqual(["2026-10-09"]);
    expect(proposal?.toDates).toEqual(["2026-10-08"]);
  });

  it("prefers the normal one-sector rhythm: Wednesday harvest, Tuesday rings, Thursday thinning", () => {
    const normalWeek: SowingPlanRow = {
      ...row,
      id: "normal-week",
      sectorName: "Hus Normal",
      sowingDate: "2026-10-01",
      harvestDate: "2026-10-21",
      cycleLength: 21,
    };
    const items = generateWorkItems(normalWeek, { defaultPlantsPerBox: 30 });
    const proposal = balanceWorkload([normalWeek], { defaultPlantsPerBox: 30 }).find(
      (item) => item.planRowId === normalWeek.id && item.type === "thinning",
    );

    expect(items.find((item) => item.type === "harvest")?.date).toBe("2026-10-21");
    expect(items.find((item) => item.type === "rings")?.date).toBe("2026-10-20");
    expect(proposal?.toDates).toEqual(["2026-10-08"]);
  });

  it("prefers Thursday and Saturday thinning when two sectors fit those windows", () => {
    const first: SowingPlanRow = {
      ...row,
      id: "two-sector-first",
      sectorName: "Hus Wed",
      sowingDate: "2026-10-01",
      harvestDate: "2026-10-21",
      cycleLength: 21,
    };
    const second: SowingPlanRow = {
      ...row,
      id: "two-sector-second",
      sectorName: "Hus Fri",
      sowingDate: "2026-10-01",
      harvestDate: "2026-10-23",
      cycleLength: 23,
    };
    const proposals = balanceWorkload([first, second], { defaultPlantsPerBox: 30 });

    expect(proposals.find((item) => item.planRowId === first.id && item.type === "thinning")?.toDates).toEqual([
      "2026-10-08",
    ]);
    expect(proposals.find((item) => item.planRowId === second.id && item.type === "thinning")?.toDates).toEqual([
      "2026-10-10",
    ]);
  });

  it("treats Thursday rings plus thinning as a normal compatible production day", () => {
    const ringsSector: SowingPlanRow = {
      ...row,
      id: "rings-thursday-sector",
      sectorName: "Hus Rings",
      sowingDate: "2026-10-03",
      harvestDate: "2026-10-23",
      cycleLength: 21,
    };
    const thinningSector: SowingPlanRow = {
      ...row,
      id: "thinning-thursday-sector",
      sectorName: "Hus Thin",
      sowingDate: "2026-10-15",
      harvestDate: "2026-11-04",
      cycleLength: 21,
      adjustments: {
        thinning: "2026-10-22",
      },
    };
    const items = [ringsSector, thinningSector].flatMap((item) =>
      generateWorkItems(item, { defaultPlantsPerBox: 30 }),
    );

    expect(items.filter((item) => item.date === "2026-10-22").map((item) => item.type)).toEqual([
      "rings",
      "thinning",
      "previcur",
      "disinfectTables",
    ]);
    expect(countMainWork(items, "2026-10-22")).toBe(1);
  });

  it("keeps the real two-sector weekly rhythm with Thursday rings plus thinning and Saturday thinning", () => {
    const movingA: SowingPlanRow = {
      ...row,
      id: "rhythm-moving-a",
      sectorName: "Hus A",
      sowingDate: "2026-10-01",
      harvestDate: "2026-10-21",
      cycleLength: 21,
      adjustments: {
        thinning: "2026-10-08",
        sideShoots: "2026-10-17",
        sticks: "2026-10-18",
      },
    };
    const movingB: SowingPlanRow = {
      ...row,
      id: "rhythm-moving-b",
      sectorName: "Hus B",
      sowingDate: "2026-10-03",
      harvestDate: "2026-10-23",
      cycleLength: 21,
      adjustments: {
        thinning: "2026-10-11",
        sideShoots: "2026-10-19",
        sticks: "2026-10-20",
      },
    };
    const thinningThursday: SowingPlanRow = {
      ...row,
      id: "rhythm-thinning-thursday",
      sectorName: "Hus C",
      sowingDate: "2026-10-15",
      harvestDate: "2026-11-04",
      cycleLength: 21,
    };
    const thinningSaturday: SowingPlanRow = {
      ...row,
      id: "rhythm-thinning-saturday",
      sectorName: "Hus D",
      sowingDate: "2026-10-15",
      harvestDate: "2026-11-06",
      cycleLength: 23,
    };
    const proposals = balanceWorkload(
      [movingA, movingB, thinningThursday, thinningSaturday],
      { defaultPlantsPerBox: 30 },
    );

    expect(generateWorkItems(movingA, { defaultPlantsPerBox: 30 }).find((item) => item.type === "rings")?.date).toBe(
      "2026-10-20",
    );
    expect(movingA.harvestDate).toBe("2026-10-21");
    expect(generateWorkItems(movingB, { defaultPlantsPerBox: 30 }).find((item) => item.type === "rings")?.date).toBe(
      "2026-10-22",
    );
    expect(movingB.harvestDate).toBe("2026-10-23");
    expect(proposals.find((item) => item.planRowId === thinningThursday.id && item.type === "thinning")?.toDates).toEqual([
      "2026-10-22",
    ]);
    expect(proposals.find((item) => item.planRowId === thinningSaturday.id && item.type === "thinning")?.toDates).toEqual([
      "2026-10-24",
    ]);
  });

  it("does not use Thursday for thinning when Thursday would be cycle day 11", () => {
    const target: SowingPlanRow = {
      ...row,
      id: "invalid-thursday",
      sectorName: "Hus Day 11",
      sowingDate: "2026-09-28",
      harvestDate: "2026-10-18",
      cycleLength: 21,
    };
    const proposal = balanceWorkload([target], { defaultPlantsPerBox: 30 }).find(
      (item) => item.planRowId === target.id && item.type === "thinning",
    );
    const plannedDate = proposal?.toDates[0] ?? "2026-10-06";

    expect(plannedDate).not.toBe("2026-10-08");
    expect(plannedDate <= "2026-10-07").toBe(true);
  });

  it("chooses another valid thinning day when Thursday has no free tables", () => {
    const target: SowingPlanRow = {
      ...row,
      id: "blocked-thursday-target",
      sectorName: "Hus Tables",
      sowingDate: "2026-10-01",
      harvestDate: "2026-10-21",
      cycleLength: 21,
      placement: { tables: 26, manual: true },
    };
    const busyRows: SowingPlanRow[] = ["A", "B", "C"].map((primaryRow, index) => ({
      ...row,
      id: `busy-thursday-${primaryRow}`,
      sectorName: `Hus Busy ${index}`,
      sowingDate: "2026-09-01",
      harvestDate: "2026-10-09",
      cycleLength: 39,
      placement: { primaryRow: primaryRow as "A" | "B" | "C", tables: 26, manual: true },
      adjustments: {
        thinning: "2026-10-01",
        sideShoots: "2026-09-20",
        sticks: "2026-10-05",
      },
    }));
    const proposal = balanceWorkload([target, ...busyRows], { defaultPlantsPerBox: 30 }).find(
      (item) => item.planRowId === target.id && item.type === "thinning",
    );

    expect(proposal?.toDates[0]).not.toBe("2026-10-08");
    expect(["2026-10-09", "2026-10-10"]).toContain(proposal?.toDates[0]);
  });

  it("keeps an agronomist Monday harvest fixed and moves only dependent work around it", () => {
    const mondayHarvest: SowingPlanRow = {
      ...row,
      id: "monday-harvest",
      sectorName: "Hus Monday",
      sowingDate: "2026-09-29",
      harvestDate: "2026-10-19",
      cycleLength: 21,
    };
    const items = generateWorkItems(mondayHarvest, { defaultPlantsPerBox: 30 });
    const proposals = balanceWorkload([mondayHarvest], { defaultPlantsPerBox: 30 });

    expect(items.find((item) => item.type === "harvest")?.date).toBe("2026-10-19");
    expect(items.find((item) => item.type === "rings")?.date).toBe("2026-10-18");
    expect(proposals.some((proposal) => proposal.type === "thinning")).toBe(true);
    expect(proposals.some((proposal) => proposal.type === "sideShoots" && proposal.toDates.some((date) => date >= "2026-10-18"))).toBe(false);
  });

  it("does not mark a full work day as overloaded just because sowing is also shown", () => {
    const sowingSameDay: SowingPlanRow = {
      ...row,
      id: "sowing-same-day",
      sectorName: "Hus Sowing",
      sowingDate: "2026-10-21",
      harvestDate: "2026-11-10",
      cycleLength: 21,
    };
    const harvestSameDay: SowingPlanRow = {
      ...row,
      id: "harvest-same-day",
      sectorName: "Hus Harvest",
      sowingDate: "2026-10-01",
      harvestDate: "2026-10-21",
      cycleLength: 21,
    };
    const items = [sowingSameDay, harvestSameDay].flatMap((item) =>
      generateWorkItems(item, { defaultPlantsPerBox: 30 }),
    );

    expect(countMainWork(items, "2026-10-21")).toBe(1);
  });

  it("places side shoots and sticks into freer available days before rings", () => {
    const target: SowingPlanRow = {
      ...row,
      id: "free-flexible-days",
      sectorName: "Hus Flexible",
      sowingDate: "2026-10-01",
      harvestDate: "2026-10-23",
      cycleLength: 23,
    };
    const busyOnDay17: SowingPlanRow = {
      ...row,
      id: "busy-flex-day",
      sectorName: "Hus Busy Flex",
      sowingDate: "2026-09-27",
      harvestDate: "2026-10-17",
      cycleLength: 21,
      adjustments: {
        thinning: "2026-10-04",
        sideShoots: "2026-10-13",
        sticks: "2026-10-15",
      },
    };
    const busyOnDefaultSticksDay: SowingPlanRow = {
      ...row,
      id: "busy-default-sticks-day",
      sectorName: "Hus Busy Kociņi",
      sowingDate: "2026-09-25",
      harvestDate: "2026-10-30",
      previcureDate: "2026-10-20",
      cycleLength: 36,
      adjustments: {
        thinning: "2026-10-02",
        sideShoots: "2026-10-12",
        sticks: "2026-10-18",
      },
    };
    const proposals = balanceWorkload([target, busyOnDay17, busyOnDefaultSticksDay], { defaultPlantsPerBox: 30 });
    const sideShoots = proposals.find((item) => item.planRowId === target.id && item.type === "sideShoots");
    const sticks = proposals.find((item) => item.planRowId === target.id && item.type === "sticks");

    expect(sideShoots?.toDates[0]).not.toBe("2026-10-17");
    expect(sideShoots?.toDates.every((date) => date < "2026-10-22")).toBe(true);
    expect(sticks?.toDates.every((date) => date < "2026-10-22")).toBe(true);
  });

  it("never moves deadline work beyond its deadline", () => {
    const target: SowingPlanRow = {
      ...row,
      id: "deadline-target",
      sectorName: "Hus D",
      sowingDate: "2026-10-01",
      harvestDate: "2026-10-19",
      cycleLength: 19,
    };
    const busyDeadline: SowingPlanRow = {
      ...row,
      id: "busy-deadline",
      sectorName: "Hus Deadline Busy",
      sowingDate: "2026-09-27",
      harvestDate: "2026-10-17",
      cycleLength: 21,
    };
    const proposal = balanceWorkload([target, busyDeadline], { defaultPlantsPerBox: 30 }).find(
      (item) => item.planRowId === target.id && item.type === "sideShoots",
    );

    if (proposal) {
      expect(proposal.toDates.every((date) => date <= "2026-10-16")).toBe(true);
    }
  });

  it("adds a warning when deadline capacity is not sufficient", () => {
    const target: SowingPlanRow = {
      ...row,
      id: "warning-target",
      sectorName: "Hus 5",
      sowingDate: "2026-10-01",
      harvestDate: "2026-10-19",
      cycleLength: 19,
    };
    const busyDeadline: SowingPlanRow = {
      ...row,
      id: "busy-warning",
      sectorName: "Hus Warning Busy",
      sowingDate: "2026-09-27",
      harvestDate: "2026-10-17",
      cycleLength: 21,
    };
    const proposal = balanceWorkload([target, busyDeadline], { defaultPlantsPerBox: 30 }).find(
      (item) => item.planRowId === target.id && item.type === "sideShoots",
    );

    if (proposal) {
      expect(proposal.warning).toContain("pieejamā darba kapacitāte nav pietiekama");
    }
  });

  it("keeps the mandatory work set unchanged after applying workload balance proposals", () => {
    const rows: SowingPlanRow[] = [
      { ...row, id: "invariant-a", sectorName: "Hus A", sowingDate: "2026-10-01", harvestDate: "2026-10-23", cycleLength: 23 },
      { ...row, id: "invariant-b", sectorName: "Hus B", sowingDate: "2026-10-02", harvestDate: "2026-10-24", cycleLength: 23 },
      { ...row, id: "invariant-c", sectorName: "Hus C", sowingDate: "2026-10-03", harvestDate: "2026-10-25", cycleLength: 23 },
    ];
    const before = workSet(generateWorkItemsForRows(rows, { defaultPlantsPerBox: 30 }));
    const proposals = balanceWorkload(rows, { defaultPlantsPerBox: 30 });
    const nextRows = rows.map((planRow) => {
      const rowProposals = proposals.filter((proposal) => proposal.planRowId === planRow.id && proposal.toDates.length > 0);
      if (rowProposals.length === 0) {
        return planRow;
      }

      return {
        ...planRow,
        adjustments: {
          ...planRow.adjustments,
          ...Object.fromEntries(
            rowProposals.map((proposal) => [
              proposal.type,
              proposal.toDates.length === 1 ? proposal.toDates[0] : proposal.toDates,
            ]),
          ),
        },
      };
    });
    const after = workSet(generateWorkItemsForRows(nextRows, { defaultPlantsPerBox: 30 }));

    expect(after).toEqual(before);
  });

  it("generates the initial plan equivalent to applying workload balance manually", () => {
    const rows: SowingPlanRow[] = [
      { ...row, id: "auto-a", sectorName: "Hus Auto A", sowingDate: "2026-10-01", harvestDate: "2026-10-23", cycleLength: 23 },
      { ...row, id: "auto-b", sectorName: "Hus Auto B", sowingDate: "2026-10-02", harvestDate: "2026-10-24", cycleLength: 23 },
      { ...row, id: "auto-c", sectorName: "Hus Auto C", sowingDate: "2026-10-03", harvestDate: "2026-10-25", cycleLength: 23 },
    ];
    const proposals = balanceWorkload(rows, { defaultPlantsPerBox: 30 });
    const manuallyBalancedRows = applyWorkloadBalanceProposals(rows, proposals);
    const automatic = workDates(generateWorkItemsForRows(rows, { defaultPlantsPerBox: 30 }));
    const manual = workDates(generateBaseWorkItemsForRows(manuallyBalancedRows, { defaultPlantsPerBox: 30 }));

    expect(automatic).toEqual(manual);
  });

  it("recalculates derived work, calendar data, and worksheet data when an existing plan row changes", () => {
    const rows = realisticPlanRows();
    const initialItems = generateWorkItemsForRows(rows, { defaultPlantsPerBox: 30 });
    const changedRows = rows.map((planRow) =>
      planRow.id === "flow-h6"
        ? {
            ...planRow,
            sowingDate: "2026-09-30",
            harvestDate: "2026-10-22",
          }
        : planRow,
    );
    const changedItems = generateWorkItemsForRows(changedRows, { defaultPlantsPerBox: 30 });
    const changedRow = changedRows.find((planRow) => planRow.id === "flow-h6");

    expect(workDatesForRow(initialItems, "flow-h6")).not.toEqual(workDatesForRow(changedItems, "flow-h6"));
    expect(generateMonthlyWorkPlan(changedRows, { defaultPlantsPerBox: 30 }, "2026-10-01").map(workItemIdentity).sort()).toEqual(
      changedItems.filter((item) => item.date.startsWith("2026-10")).map(workItemIdentity).sort(),
    );
    expect(changedRow).toBeDefined();
    expect(worksheetWorkDates(changedRow as SowingPlanRow)).toEqual(workDatesForRow(generateWorkItems(changedRow as SowingPlanRow, { defaultPlantsPerBox: 30 }), "flow-h6"));
  });

  it("adds a new sector through the full generated work, calendar, and worksheet data flow", () => {
    const rows = realisticPlanRows().slice(0, 3);
    const addedRow = realisticPlanRows().find((planRow) => planRow.id === "flow-h7") as SowingPlanRow;
    const nextRows = [...rows, addedRow];
    const items = generateWorkItemsForRows(nextRows, { defaultPlantsPerBox: 30 });
    const calendarItems = generateMonthlyWorkPlan(nextRows, { defaultPlantsPerBox: 30 }, "2026-10-01");

    expectMandatoryWork(items, addedRow.id);
    expect(workDatesForRow(calendarItems, addedRow.id).length).toBeGreaterThan(0);
    expect(worksheetWorkDates(addedRow)).toEqual(workDatesForRow(generateWorkItems(addedRow, { defaultPlantsPerBox: 30 }), addedRow.id));
  });

  it("removes deleted sector work without leaving stale calendar data and keeps remaining sectors valid", () => {
    const rows = realisticPlanRows();
    const remainingRows = rows.filter((planRow) => planRow.id !== "flow-h5");
    const items = generateWorkItemsForRows(remainingRows, { defaultPlantsPerBox: 30 });
    const calendarItems = generateMonthlyWorkPlan(remainingRows, { defaultPlantsPerBox: 30 }, "2026-10-01");

    expect(items.some((item) => item.planRowId === "flow-h5")).toBe(false);
    expect(calendarItems.some((item) => item.planRowId === "flow-h5")).toBe(false);
    remainingRows.forEach((planRow) => expectMandatoryWork(items, planRow.id));
  });

  it("keeps manual adjustments locked when other rows change and ignores empty adjustment arrays", () => {
    const rows = realisticPlanRows();
    const manuallyMoved: SowingPlanRow = {
      ...rows.find((planRow) => planRow.id === "flow-h6")!,
      adjustments: {
        sideShoots: "2026-10-16",
      },
    };
    const changedRows = [
      ...rows.filter((planRow) => planRow.id !== "flow-h6"),
      manuallyMoved,
      {
        ...row,
        id: "flow-extra",
        sectorName: "Hus Extra",
        requiredPlants: 4200,
        extraPlants: 100,
        variety: "Baltazsara",
        sowingDate: "2026-10-05",
        harvestDate: "2026-10-27",
        cycleLength: 23,
      },
    ];
    const items = generateWorkItemsForRows(changedRows, { defaultPlantsPerBox: 30 });
    const movedSideShoots = items.find((item) => item.planRowId === "flow-h6" && item.type === "sideShoots");
    const emptyAdjustmentRow: SowingPlanRow = {
      ...rows.find((planRow) => planRow.id === "flow-h7")!,
      adjustments: {
        sideShoots: [],
        sticks: [],
      },
    };
    const emptyAdjustmentItems = generateWorkItemsForRows([emptyAdjustmentRow], { defaultPlantsPerBox: 30 });

    expect(movedSideShoots?.date).toBe("2026-10-16");
    expect(movedSideShoots?.source).toBe("manual");
    expect(movedSideShoots?.locked).toBe(true);
    expectMandatoryWork(emptyAdjustmentItems, emptyAdjustmentRow.id);
  });

  it("preserves the mandatory work invariant before and after balancing", () => {
    const rows = realisticPlanRows();
    const base = mandatoryWorkCounts(generateBaseWorkItemsForRows(rows, { defaultPlantsPerBox: 30 }));
    const balanced = mandatoryWorkCounts(generateWorkItemsForRows(rows, { defaultPlantsPerBox: 30 }));

    expect(balanced).toEqual(base);
  });

  it("is idempotent when generating the same plan twice", () => {
    const rows = realisticPlanRows();
    const first = workDates(generateWorkItemsForRows(rows, { defaultPlantsPerBox: 30 }));
    const second = workDates(generateWorkItemsForRows(rows, { defaultPlantsPerBox: 30 }));

    expect(second).toEqual(first);
  });

  it("recalculation clears scheduling adjustments without changing plan rows and matches clean generation", () => {
    const cleanRows = realisticPlanRows();
    const adjustedRows = cleanRows.map((planRow) =>
      planRow.id === "flow-h6"
        ? {
            ...planRow,
            adjustments: {
              thinning: "2026-10-07",
              sideShoots: "2026-10-16",
              sticks: "2026-10-17",
            },
          }
        : planRow,
    );
    const recalculatedRows = clearAdjustments(adjustedRows);

    expect(recalculatedRows.map(planRowData)).toEqual(cleanRows.map(planRowData));
    expect(workDates(generateWorkItemsForRows(recalculatedRows, { defaultPlantsPerBox: 30 }))).toEqual(
      workDates(generateWorkItemsForRows(cleanRows, { defaultPlantsPerBox: 30 })),
    );
  });

  it("uses the same final work item source for calendar and worksheet dates", () => {
    const rows = realisticPlanRows();
    const finalItems = generateWorkItemsForRows(rows, { defaultPlantsPerBox: 30 });
    const rowWithGlobalMove = rows.find((planRow) => {
      const globalDates = workDatesForRow(finalItems, planRow.id);
      const isolatedDates = workDatesForRow(generateWorkItems(planRow, { defaultPlantsPerBox: 30 }), planRow.id);
      return JSON.stringify(globalDates) !== JSON.stringify(isolatedDates);
    });

    expect(rowWithGlobalMove).toBeDefined();

    const worksheetDates = worksheetWorkDatesFromItems(rowWithGlobalMove as SowingPlanRow, finalItems);
    const calendarDates = workDatesForRow(finalItems, (rowWithGlobalMove as SowingPlanRow).id);

    expect(worksheetDates).toEqual(calendarDates);
  });

  it("keeps calendar and worksheet dates identical after a plan row changes", () => {
    const rows = realisticPlanRows().map((planRow) =>
      planRow.id === "flow-h6"
        ? {
            ...planRow,
            sowingDate: "2026-09-30",
            harvestDate: "2026-10-22",
          }
        : planRow,
    );
    const finalItems = generateWorkItemsForRows(rows, { defaultPlantsPerBox: 30 });
    const changedRow = rows.find((planRow) => planRow.id === "flow-h6") as SowingPlanRow;

    expect(worksheetWorkDatesFromItems(changedRow, finalItems)).toEqual(workDatesForRow(finalItems, changedRow.id));
  });

  it("keeps worksheet dates in sync when a new sector changes another sector's balanced dates", () => {
    const rows = [realisticPlanRows().find((planRow) => planRow.id === "flow-h6") as SowingPlanRow];
    const beforeItems = generateWorkItemsForRows(rows, { defaultPlantsPerBox: 30 });
    const originalSideShootsDate = beforeItems.find((item) => item.planRowId === "flow-h6" && item.type === "sideShoots")?.date;
    const blockingRow: SowingPlanRow = {
      ...row,
      id: "flow-blocker",
      sectorName: "Hus Blocker",
      requiredPlants: 4200,
      extraPlants: 100,
      variety: "Baltazsara",
      sowingDate: addDays(originalSideShootsDate ?? "2026-10-17", -22),
      harvestDate: originalSideShootsDate ?? "2026-10-17",
      cycleLength: 23,
    };
    const nextRows = [...rows, blockingRow];
    const afterItems = generateWorkItemsForRows(nextRows, { defaultPlantsPerBox: 30 });
    const changedExistingRow = rows[0];

    expect(workDatesForRow(afterItems, changedExistingRow.id)).not.toEqual(workDatesForRow(beforeItems, changedExistingRow.id));
    expect(worksheetWorkDatesFromItems(changedExistingRow as SowingPlanRow, afterItems)).toEqual(
      workDatesForRow(afterItems, (changedExistingRow as SowingPlanRow).id),
    );
  });

  it("renders manual adjustments identically in calendar and worksheet data", () => {
    const adjustedRows = realisticPlanRows().map((planRow) =>
      planRow.id === "flow-h6"
        ? {
            ...planRow,
            adjustments: {
              sideShoots: "2026-10-16",
              sticks: "2026-10-17",
            },
          }
        : planRow,
    );
    const finalItems = generateWorkItemsForRows(adjustedRows, { defaultPlantsPerBox: 30 });
    const adjustedRow = adjustedRows.find((planRow) => planRow.id === "flow-h6") as SowingPlanRow;

    expect(workDatesForRow(finalItems, adjustedRow.id)).toContain("2026-10-16:flow-h6:sideShoots:1");
    expect(workDatesForRow(finalItems, adjustedRow.id)).toContain("2026-10-17:flow-h6:sticks:0.5");
    expect(worksheetWorkDatesFromItems(adjustedRow, finalItems)).toEqual(workDatesForRow(finalItems, adjustedRow.id));
  });

  it("keeps minor tasks attached to balanced base work dates in calendar and worksheet data", () => {
    const rows = realisticPlanRows();
    const finalItems = generateWorkItemsForRows(rows, { defaultPlantsPerBox: 30 });
    const targetRow = rows.find((planRow) => planRow.id === "flow-h7") as SowingPlanRow;
    const targetItems = finalItems.filter((item) => item.planRowId === targetRow.id);
    const thinningDate = targetItems.find((item) => item.type === "thinning")?.date;

    expect(targetItems.find((item) => item.type === "previcur")?.date).toBe(thinningDate);
    expect(targetItems.find((item) => item.type === "disinfectTables")?.date).toBe(thinningDate);
    expect(worksheetWorkDatesFromItems(targetRow, finalItems)).toEqual(workDatesForRow(finalItems, targetRow.id));
  });
});

function workSet(items: ReturnType<typeof generateWorkItemsForRows>): string[] {
  return items
    .filter((item) => item.type !== "sowing" && item.type !== "previcure")
    .map((item) => `${item.planRowId}:${item.type}`)
    .sort();
}

function workDates(items: ReturnType<typeof generateWorkItemsForRows>): string[] {
  return items
    .filter((item) => item.type !== "sowing" && item.type !== "previcure")
    .map((item) => `${item.planRowId}:${item.type}:${item.date}`)
    .sort();
}

function realisticPlanRows(): SowingPlanRow[] {
  return [
    {
      ...row,
      id: "flow-h4",
      sectorName: "Hus 4",
      requiredPlants: 3819,
      extraPlants: 100,
      variety: "Baltazsara",
      sowingDate: "2026-09-22",
      harvestDate: "2026-10-14",
      cycleLength: 23,
    },
    {
      ...row,
      id: "flow-h5",
      sectorName: "Hus 5",
      requiredPlants: 3556,
      extraPlants: 100,
      variety: "Baltazsara",
      sowingDate: "2026-09-24",
      harvestDate: "2026-10-16",
      cycleLength: 23,
    },
    {
      ...row,
      id: "flow-h6",
      sectorName: "Hus 6",
      requiredPlants: 3556,
      extraPlants: 100,
      variety: "Baltazsara",
      sowingDate: "2026-09-29",
      harvestDate: "2026-10-21",
      cycleLength: 23,
    },
    {
      ...row,
      id: "flow-h7",
      sectorName: "Hus 7",
      requiredPlants: 6057,
      extraPlants: 100,
      variety: "Baltazsara",
      sowingDate: "2026-10-06",
      harvestDate: "2026-10-28",
      cycleLength: 23,
    },
    {
      ...row,
      id: "flow-h9",
      sectorName: "Hus 9",
      requiredPlants: 3707,
      extraPlants: 100,
      variety: "Baltazsara",
      sowingDate: "2026-10-13",
      harvestDate: "2026-11-04",
      cycleLength: 23,
    },
  ];
}

function workItemIdentity(item: WorkItem): string {
  return `${item.date}:${item.planRowId}:${item.type}:${item.portion ?? ""}`;
}

function workDatesForRow(items: WorkItem[], planRowId: string): string[] {
  return items
    .filter((item) => item.planRowId === planRowId)
    .map(workItemIdentity)
    .sort();
}

function worksheetWorkDates(planRow: SowingPlanRow): string[] {
  return generateWorksheetDays(planRow, { defaultPlantsPerBox: 30 })
    .flatMap((day) => day.works)
    .map(workItemIdentity)
    .sort();
}

function worksheetWorkDatesFromItems(planRow: SowingPlanRow, workItems: WorkItem[]): string[] {
  return generateWorksheetDaysFromWorkItems(planRow, workItems)
    .flatMap((day) => day.works)
    .map(workItemIdentity)
    .sort();
}

function expectMandatoryWork(items: WorkItem[], planRowId: string) {
  const actual = mandatoryWorkTypes(items.filter((item) => item.planRowId === planRowId));

  expect(actual).toEqual([
    "addAgrofilm",
    "disinfectTables",
    "harvest",
    "previcur",
    "removeAgrofilm",
    "removeFilm",
    "rings",
    "sideShoots",
    "sowing",
    "sprayTables",
    "sticks",
    "thinning",
  ]);
}

function mandatoryWorkCounts(items: WorkItem[]): string[] {
  return items
    .filter((item) => item.type !== "previcure")
    .map((item) => `${item.planRowId}:${item.type}`)
    .sort();
}

function mandatoryWorkTypes(items: WorkItem[]): WorkType[] {
  return [...new Set(items.filter((item) => item.type !== "previcure").map((item) => item.type))].sort();
}

function clearAdjustments(rows: SowingPlanRow[]): SowingPlanRow[] {
  return rows.map((planRow) => {
    const data = { ...planRow };
    delete data.adjustments;
    return data;
  });
}

function planRowData(planRow: SowingPlanRow): Omit<SowingPlanRow, "adjustments"> {
  const data: Partial<SowingPlanRow> = { ...planRow };
  delete data.adjustments;
  return data as Omit<SowingPlanRow, "adjustments">;
}

function cycleDayDateForTest(planRow: SowingPlanRow, day: number): string {
  return addDays(planRow.sowingDate, day - 1);
}

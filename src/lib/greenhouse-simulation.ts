import {
  addDays,
  applyWorkloadBalanceProposals,
  balanceWorkload,
  calculateRecommendedTables,
  clearOptimizerWorkAdjustments,
  eachDate,
  generateWorkItemsForRows,
  getTotalSow,
  parseSowingTableSelection,
} from "./planning";
import { scheduleProductionWork } from "./scheduler";
import type { PlannerConfig, SowingPlanRow, WorkItem, WorkType } from "./types";

export const SEEDING_TABLE_CAPACITY = 13;
export const GROWING_TABLE_CAPACITY = 91;

export const greenhouseTableStructure = {
  seeding: { label: "A1-A13", tables: 13 },
  growing: [
    { id: "A", label: "A14-A26", tables: 13 },
    { id: "B", label: "B1-B26", tables: 26 },
    { id: "C", label: "C1-C26", tables: 26 },
    { id: "D", label: "D1-D26", tables: 26 },
  ],
};

export type GreenhouseOccupancyStatus = "can" | "conditional" | "insufficientData" | "cannot";

export type GreenhouseSeedingOccupancy = {
  capacity: number;
  conflicts: Array<{
    planRowIds: string[];
    sectorNames: string[];
    table: string;
  }>;
  freeTableIds: string[];
  freeTables: number;
  incomplete: boolean;
  overCapacity: boolean;
  rows: Array<{
    dateRange?: { end: string; start: string };
    planRowId: string;
    sectorName: string;
    sowingDate: string;
    tables: string[];
    tableCount: number;
  }>;
  unknownRows: Array<{
    planRowId: string;
    reason: "missingSowingTables" | "unknownRelease";
    sectorName: string;
  }>;
  occupiedTableIds: string[];
  tableOccupancy: Array<{
    planRowIds: string[];
    sectorNames: string[];
    table: string;
  }>;
  usedTables: number;
};

export type GreenhouseGrowingOccupancy = {
  capacity: number;
  freeTables: number;
  overCapacity: boolean;
  rows: Array<{
    dateRange: { end: string; start: string };
    density?: number;
    planRowId: string;
    sectorName: string;
    tables: number;
  }>;
  usedTables: number;
};

export type GreenhouseOccupancyDay = {
  date: string;
  growing: GreenhouseGrowingOccupancy;
  seeding: GreenhouseSeedingOccupancy;
  warnings: string[];
};

export type SowingDateSimulationResult = {
  changedOtherWork: Array<{
    after: string[];
    before: string[];
    planRowId: string;
    sectorName: string;
    type: WorkType;
  }>;
  currentMoveOutDate: string;
  currentSowingDate: string;
  explanation: string;
  newMoveOutDate: string;
  newSowingDate: string;
  occupancy: GreenhouseOccupancyDay[];
  originalRowsUnchanged: boolean;
  scenarioRows: SowingPlanRow[];
  status: GreenhouseOccupancyStatus;
  targetPlanRowId: string;
  targetSectorName: string;
  warnings: string[];
};

type GrowingPlacement = {
  density?: number;
  endDate: string;
  planRowId: string;
  releaseKnown: boolean;
  sectorName: string;
  startDate: string;
  tables: number;
};

type SeedingLifecycle = {
  endDate?: string;
  planRowId: string;
  sectorName: string;
  sowingDate: string;
  tables: string[];
};

export function buildGreenhouseOccupancyCalendar(
  rows: SowingPlanRow[],
  config: PlannerConfig,
  startDate = firstRelevantDate(rows),
  endDate = lastRelevantDate(rows),
): GreenhouseOccupancyDay[] {
  if (!startDate || !endDate || startDate > endDate) {
    return [];
  }

  return eachDate(startDate, endDate).map((date) => buildGreenhouseOccupancyDay(rows, config, date));
}

export function buildGreenhouseOccupancyDay(
  rows: SowingPlanRow[],
  config: PlannerConfig,
  date: string,
): GreenhouseOccupancyDay {
  const finalRows = finalScheduledRows(rows, config);
  const placements = growingPlacements(finalRows);
  const seeding = seedingOccupancy(finalRows, placements, date);
  const growing = growingOccupancy(placements, date);
  const warnings = [
    ...seeding.unknownRows.map((row) =>
      row.reason === "missingSowingTables"
        ? `${row.sectorName}: nav norādīti sēšanas galdi.`
        : `${row.sectorName}: nav droši zināms sēšanas galdu atbrīvošanas datums.`
    ),
    ...seeding.conflicts.map((conflict) => `${conflict.table}: sēšanas galda konflikts (${conflict.sectorNames.join(", ")}).`),
    ...(seeding.overCapacity ? [`Sēšanas galdu noslodze pārsniedz ${SEEDING_TABLE_CAPACITY}.`] : []),
    ...(growing.overCapacity ? [`Augšanas galdu noslodze pārsniedz ${GROWING_TABLE_CAPACITY}.`] : []),
  ];

  return {
    date,
    growing,
    seeding,
    warnings,
  };
}

export function simulateSowingDateChange(
  rows: SowingPlanRow[],
  config: PlannerConfig,
  targetPlanRowId: string,
  newSowingDate: string,
): SowingDateSimulationResult {
  const originalRowsSnapshot = JSON.stringify(rows);
  const target = rows.find((row) => row.id === targetPlanRowId);

  if (!target) {
    throw new Error("HUS nav atrasts simulācijai.");
  }

  const scenarioRows = rows.map((row) => {
    if (row.id !== targetPlanRowId) {
      return row;
    }

    return clearOptimizerWorkAdjustments({
      ...row,
      harvestDate: addDays(newSowingDate, row.cycleLength - 1),
      sowingDate: newSowingDate,
    });
  });

  const currentWorkItems = generateWorkItemsForRows(rows, config);
  const scenarioWorkItems = generateWorkItemsForRows(scenarioRows, config);
  const currentRange = relevantDateRange(rows);
  const scenarioRange = relevantDateRange(scenarioRows);
  const startDate = minIsoDate(currentRange.start, scenarioRange.start);
  const endDate = maxIsoDate(currentRange.end, scenarioRange.end);
  const occupancy = buildGreenhouseOccupancyCalendar(scenarioRows, config, startDate, endDate);
  const changedOtherWork = changedWorkItems(currentWorkItems, scenarioWorkItems, targetPlanRowId);
  const scheduleWarnings = scheduleProductionWork(finalScheduledRows(scenarioRows, config)).warnings.map((warning) => warning.message);
  const occupancyWarnings = occupancy.flatMap((day) => day.warnings.map((warning) => `${day.date}: ${warning}`));
  const warnings = [...scheduleWarnings, ...occupancyWarnings];
  const status = classifySimulation(occupancy, scheduleWarnings, changedOtherWork);
  const scenarioTarget = scenarioRows.find((row) => row.id === targetPlanRowId) ?? target;

  return {
    changedOtherWork,
    currentMoveOutDate: target.harvestDate,
    currentSowingDate: target.sowingDate,
    explanation: simulationExplanation(status),
    newMoveOutDate: scenarioTarget.harvestDate,
    newSowingDate,
    occupancy,
    originalRowsUnchanged: JSON.stringify(rows) === originalRowsSnapshot,
    scenarioRows,
    status,
    targetPlanRowId,
    targetSectorName: target.sectorName,
    warnings,
  };
}

function finalScheduledRows(rows: SowingPlanRow[], config: PlannerConfig): SowingPlanRow[] {
  return applyWorkloadBalanceProposals(rows, balanceWorkload(rows, config));
}

function growingPlacements(rows: SowingPlanRow[]): GrowingPlacement[] {
  const schedule = scheduleProductionWork(rows);
  const scheduledPlacements = schedule.items.filter((item) => item.type === "thinning");
  const scheduledIds = new Set(scheduledPlacements.map((item) => item.planRowId));

  return [
    ...scheduledPlacements.map((item) => {
      const row = rows.find((candidate) => candidate.id === item.planRowId);
      const tables =
        row?.placement?.tables ??
        item.greenhousePlacement?.totalTables ??
        (row ? calculateRecommendedTables(getTotalSow(row)) : 0);

      return {
        density: item.greenhousePlacement?.plantsPerTrough,
        endDate: row?.harvestDate ?? item.date,
        planRowId: item.planRowId,
        releaseKnown: true,
        sectorName: item.sectorName,
        startDate: item.date,
        tables,
      };
    }),
    ...rows
      .filter((row) => !scheduledIds.has(row.id))
      .map((row) => ({
        density: undefined,
        endDate: row.harvestDate,
        planRowId: row.id,
        releaseKnown: false,
        sectorName: row.sectorName,
        startDate: firstAdjustmentDate(row.adjustments?.thinning) ?? addDays(row.sowingDate, 8),
        tables: row.placement?.tables ?? calculateRecommendedTables(getTotalSow(row)),
      })),
  ];
}

function growingOccupancy(placements: GrowingPlacement[], date: string): GreenhouseGrowingOccupancy {
  const rows = placements
    .filter((placement) => placement.startDate <= date && date < placement.endDate)
    .map((placement) => ({
      dateRange: { start: placement.startDate, end: placement.endDate },
      density: placement.density,
      planRowId: placement.planRowId,
      sectorName: placement.sectorName,
      tables: placement.tables,
    }));
  const usedTables = rows.reduce((sum, row) => sum + row.tables, 0);

  return {
    capacity: GROWING_TABLE_CAPACITY,
    freeTables: Math.max(0, GROWING_TABLE_CAPACITY - usedTables),
    overCapacity: usedTables > GROWING_TABLE_CAPACITY,
    rows,
    usedTables,
  };
}

function seedingOccupancy(rows: SowingPlanRow[], placements: GrowingPlacement[], date: string): GreenhouseSeedingOccupancy {
  const lifecycles: SeedingLifecycle[] = rows.map((row) => {
    const placement = placements.find((candidate) => candidate.planRowId === row.id);
    return {
      endDate: placement?.releaseKnown ? placement.startDate : undefined,
      planRowId: row.id,
      sectorName: row.sectorName,
      sowingDate: row.sowingDate,
      tables: parseSowingTableSelection(row.sowingTables),
    };
  });
  const activeLifecycles = lifecycles.filter((row) => row.sowingDate <= date && (!row.endDate || date <= row.endDate));
  const sowingRows = activeLifecycles
    .filter((row) => row.tables.length > 0 && row.endDate)
    .map((row) => ({
      dateRange: { start: row.sowingDate, end: row.endDate ?? row.sowingDate },
      planRowId: row.planRowId,
      sectorName: row.sectorName,
      sowingDate: row.sowingDate,
      tables: row.tables,
      tableCount: row.tables.length,
    }));
  const unknownRows = activeLifecycles.flatMap((row): GreenhouseSeedingOccupancy["unknownRows"] => {
    if (row.tables.length === 0) {
      return [{ planRowId: row.planRowId, reason: "missingSowingTables", sectorName: row.sectorName }];
    }

    if (!row.endDate) {
      return [{ planRowId: row.planRowId, reason: "unknownRelease", sectorName: row.sectorName }];
    }

    return [];
  });
  const tableOccupancy = tableOccupancyFor(sowingRows);
  const conflicts = tableOccupancy.filter((table) => table.planRowIds.length > 1);
  const occupiedTableIds = tableOccupancy.map((table) => table.table);
  const usedTables = occupiedTableIds.length;
  const freeTableIds = Array.from({ length: SEEDING_TABLE_CAPACITY }, (_, index) => `A${index + 1}`).filter(
    (table) => !occupiedTableIds.includes(table),
  );

  return {
    capacity: SEEDING_TABLE_CAPACITY,
    conflicts,
    freeTableIds,
    freeTables: Math.max(0, SEEDING_TABLE_CAPACITY - usedTables),
    incomplete: unknownRows.length > 0,
    overCapacity: usedTables > SEEDING_TABLE_CAPACITY || conflicts.length > 0,
    rows: sowingRows,
    unknownRows,
    occupiedTableIds,
    tableOccupancy,
    usedTables,
  };
}

function tableOccupancyFor(rows: GreenhouseSeedingOccupancy["rows"]): GreenhouseSeedingOccupancy["tableOccupancy"] {
  const byTable = new Map<string, { planRowIds: string[]; sectorNames: string[]; table: string }>();

  rows.forEach((row) => {
    row.tables.forEach((table) => {
      const current = byTable.get(table) ?? { planRowIds: [], sectorNames: [], table };
      current.planRowIds.push(row.planRowId);
      current.sectorNames.push(row.sectorName);
      byTable.set(table, current);
    });
  });

  return Array.from(byTable.values()).sort((left, right) => Number(left.table.slice(1)) - Number(right.table.slice(1)));
}

function changedWorkItems(current: WorkItem[], scenario: WorkItem[], targetPlanRowId: string): SowingDateSimulationResult["changedOtherWork"] {
  const currentMap = workItemDateMap(current.filter((item) => item.planRowId !== targetPlanRowId));
  const scenarioMap = workItemDateMap(scenario.filter((item) => item.planRowId !== targetPlanRowId));
  const keys = new Set([...currentMap.keys(), ...scenarioMap.keys()]);

  return Array.from(keys)
    .map((key) => {
      const before = currentMap.get(key) ?? [];
      const after = scenarioMap.get(key) ?? [];
      if (sameDates(before, after)) {
        return undefined;
      }

      const [planRowId, type, sectorName] = key.split("|");
      return {
        after,
        before,
        planRowId,
        sectorName,
        type: type as WorkType,
      };
    })
    .filter((item): item is SowingDateSimulationResult["changedOtherWork"][number] => Boolean(item));
}

function workItemDateMap(items: WorkItem[]): Map<string, string[]> {
  const map = new Map<string, string[]>();
  items.forEach((item) => {
    if (!["thinning", "sideShoots", "sticks", "rings", "harvest", "sowing"].includes(item.type)) {
      return;
    }

    const key = `${item.planRowId}|${item.type}|${item.sectorName}`;
    map.set(key, [...(map.get(key) ?? []), item.date].sort());
  });
  return map;
}

function firstAdjustmentDate(value: string | string[] | undefined): string | undefined {
  if (!value) {
    return undefined;
  }

  return Array.isArray(value) ? value[0] : value;
}

function classifySimulation(
  occupancy: GreenhouseOccupancyDay[],
  scheduleWarnings: string[],
  changedOtherWork: SowingDateSimulationResult["changedOtherWork"],
): GreenhouseOccupancyStatus {
  const hasHardCapacityConflict = occupancy.some((day) => day.growing.overCapacity || day.seeding.overCapacity || day.seeding.conflicts.length > 0);
  const hasUnresolvedScheduleConflict = scheduleWarnings.some((warning) =>
    warning.includes("nepietiek brīvu galdu pat 11. dienā") ||
    warning.includes("nevar ieplānot") ||
    warning.includes("ārpus atļautā perioda")
  );

  if (hasHardCapacityConflict || hasUnresolvedScheduleConflict) {
    return "cannot";
  }

  if (occupancy.some((day) => day.seeding.incomplete)) {
    return "insufficientData";
  }

  if (scheduleWarnings.length > 0 || changedOtherWork.length > 0) {
    return "conditional";
  }

  return "can";
}

function simulationExplanation(status: GreenhouseOccupancyStatus): string {
  if (status === "can") {
    return "Var: pārbaudītajos datos nav atrasts sēšanas vai augšanas galdu konflikts.";
  }

  if (status === "conditional") {
    return "Var ar nosacījumiem: plāns ir iespējams, bet ir jāpārskata norādītās izmaiņas vai brīdinājumi.";
  }

  if (status === "insufficientData") {
    return "Nepietiek datu: sēšanas galdu atbrīvošanas brīdis nav droši zināms.";
  }

  return "Nevar: ir neatrisināts kapacitātes vai termiņa konflikts.";
}

function sameDates(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((date, index) => date === right[index]);
}

function relevantDateRange(rows: SowingPlanRow[]): { end: string; start: string } {
  return {
    end: lastRelevantDate(rows) ?? "",
    start: firstRelevantDate(rows) ?? "",
  };
}

function firstRelevantDate(rows: SowingPlanRow[]): string | undefined {
  return rows.map((row) => row.sowingDate).sort()[0];
}

function lastRelevantDate(rows: SowingPlanRow[]): string | undefined {
  return rows.map((row) => row.harvestDate).sort().at(-1);
}

function minIsoDate(left: string, right: string): string {
  if (!left) {
    return right;
  }

  if (!right) {
    return left;
  }

  return left < right ? left : right;
}

function maxIsoDate(left: string, right: string): string {
  if (!left) {
    return right;
  }

  if (!right) {
    return left;
  }

  return left > right ? left : right;
}

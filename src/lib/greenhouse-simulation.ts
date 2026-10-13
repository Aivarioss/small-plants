import {
  addDays,
  applyWorkloadBalanceProposals,
  balanceWorkload,
  calculateRecommendedTables,
  clearOptimizerWorkAdjustments,
  eachDate,
  generateWorkItemsForRows,
  getTotalSow,
  parseHusEventMovementRows,
  parseSowingTableSelection,
} from "./planning";
import {
  calculateGreenhouseTablePlacement,
  type GreenhouseTablePlacement,
  type PlacementDensityClass,
} from "./greenhouse-placement";
import { scheduleProductionWork } from "./scheduler";
import type { GreenhouseRowId, HusEventEntry, PlannerConfig, SowingPlanRow, WorkItem, WorkType } from "./types";

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
  physicalUsedTables: number;
  rows: Array<{
    actualTableIds?: string[];
    dateRange: { end: string; start: string };
    density?: number;
    placementKind?: GrowingPlacementKind;
    placementSource: "actual" | "planned";
    planRowId: string;
    primaryRow?: PhysicalGrowingRowId;
    reservedTables?: number;
    rowLabel?: string;
    sectorName: string;
    tables: number;
    usesExtraBlock?: boolean;
    warnings?: string[];
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
  alternatives: GreenhouseSimulationAlternative[];
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

export type SimulationAlternativeTier = "preferred" | "compromise" | "strained";
export type GrowingPlacementKind = "standardRow" | "largeWithExtra" | "aExtraOnly" | "sharedRow" | "unplaced";
type PhysicalGrowingRowId = Extract<GreenhouseRowId, "A" | "B" | "C" | "D">;
type LongGrowingRowId = Extract<GreenhouseRowId, "B" | "C" | "D">;

export type GreenhouseSimulationAlternative = {
  cycleDay: number;
  densityClass: PlacementDensityClass;
  explanation: string;
  physicalTables: number;
  risks: string[];
  reservedTables: number;
  score: number;
  sharedWith: Array<{
    overlapDays: number;
    planRowId: string;
    sectorName: string;
  }>;
  thinningDate: string;
  tier: SimulationAlternativeTier;
  usesExtraBlock: boolean;
  wateringZone?: PhysicalGrowingRowId;
};

type GrowingPlacement = {
  actualMovements?: ActualGrowingMovement[];
  density?: number;
  endDate: string;
  placementKind?: GrowingPlacementKind;
  planRowId: string;
  primaryRow?: PhysicalGrowingRowId;
  releaseKnown: boolean;
  reservedTables?: number;
  sectorName: string;
  startDate: string;
  tables: number;
  usesExtraBlock?: boolean;
  warnings?: string[];
};

type RawGrowingPlacement = {
  actualMovements?: ActualGrowingMovement[];
  density?: number;
  densityClass?: PlacementDensityClass;
  endDate: string;
  planRowId: string;
  plantsPerTrough?: number;
  plannedTables?: number;
  releaseKnown: boolean;
  row: SowingPlanRow;
  sectorName: string;
  startDate: string;
  tables: number;
};

export type ActualGrowingMovement = {
  eventDate: string;
  eventId: string;
  fromTableIds: string[];
  tableIds: string[];
  warnings: string[];
};

export type InterpretedMovingEventPlacement = {
  eventDate: string;
  eventId: string;
  rows: Array<{
    from: string;
    fromGrowingTables: string[];
    to: string;
    toGrowingTables: string[];
  }>;
  tableIds: string[];
  warnings: string[];
};

type PhysicalPlacementOption = {
  densityClass: PlacementDensityClass;
  explanation: string;
  feasible: boolean;
  kind: GrowingPlacementKind;
  physicalTables: number;
  plantsPerTrough: number;
  primaryRow?: PhysicalGrowingRowId;
  reservedTables: number;
  risks: string[];
  score: number;
  sharedWith: Array<{
    overlapDays: number;
    planRowId: string;
    sectorName: string;
  }>;
  usesExtraBlock: boolean;
};

type SeedingLifecycle = {
  endDate?: string;
  planRowId: string;
  sectorName: string;
  sowingDate: string;
  tables: string[];
};

const LONG_GROWING_ROWS: LongGrowingRowId[] = ["B", "C", "D"];
const A_EXTRA_TABLE_CAPACITY = 13;
const LONG_ROW_TABLE_CAPACITY = 26;

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
    ...growing.rows.flatMap((row) => (row.warnings ?? []).map((warning) => `${row.sectorName}: ${warning}`)),
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
  const scenarioTarget = scenarioRows.find((row) => row.id === targetPlanRowId) ?? target;
  const alternatives = findSowingDateAlternatives(scenarioRows, config, targetPlanRowId);
  const status = classifySimulation(occupancy, scheduleWarnings, changedOtherWork, alternatives);

  return {
    alternatives,
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
  const rawPlacements: RawGrowingPlacement[] = [
    ...scheduledPlacements.map((item) => {
      const row = rows.find((candidate) => candidate.id === item.planRowId);
      const tables =
        row?.placement?.tables ??
        item.greenhousePlacement?.totalTables ??
        (row ? calculateRecommendedTables(getTotalSow(row)) : 0);
      const actualMovements = row ? actualGrowingMovements(row) : [];
      const actualTables = finalActualGrowingTables(actualMovements);

      return {
        actualMovements,
        density: item.greenhousePlacement?.plantsPerTrough,
        densityClass: item.greenhousePlacement?.densityClass,
        endDate: row?.harvestDate ?? item.date,
        planRowId: item.planRowId,
        plantsPerTrough: item.greenhousePlacement?.plantsPerTrough,
        plannedTables: tables,
        releaseKnown: true,
        row: row ?? fallbackRowFor(item.planRowId, item.sectorName, item.date),
        sectorName: item.sectorName,
        startDate: actualMovements[0]?.eventDate ?? item.date,
        tables: actualTables.length > 0 ? actualTables.length : tables,
      };
    }),
    ...rows
      .filter((row) => !scheduledIds.has(row.id))
      .map((row) => ({
        actualMovements: actualGrowingMovements(row),
        density: undefined,
        densityClass: undefined,
        endDate: row.harvestDate,
        planRowId: row.id,
        plantsPerTrough: undefined,
        plannedTables: row.placement?.tables ?? calculateRecommendedTables(getTotalSow(row)),
        releaseKnown: false,
        row,
        sectorName: row.sectorName,
        startDate: actualGrowingMovements(row)[0]?.eventDate ?? firstAdjustmentDate(row.adjustments?.thinning) ?? addDays(row.sowingDate, 8),
        tables: finalActualGrowingTables(actualGrowingMovements(row)).length || row.placement?.tables || calculateRecommendedTables(getTotalSow(row)),
      })),
  ];

  return assignPhysicalGrowingPlacements(rawPlacements);
}

function growingOccupancy(placements: GrowingPlacement[], date: string): GreenhouseGrowingOccupancy {
  const rows = placements
    .filter((placement) => placement.startDate <= date && date < placement.endDate)
    .map((placement) => growingOccupancyRowForDate(placement, date))
    .filter((row): row is NonNullable<typeof row> => Boolean(row));
  const physicalUsedTables = rows.reduce((sum, row) => sum + row.tables, 0);
  const usedTables = rows.reduce((sum, row) => sum + (row.reservedTables ?? row.tables), 0);

  return {
    capacity: GROWING_TABLE_CAPACITY,
    freeTables: Math.max(0, GROWING_TABLE_CAPACITY - usedTables),
    overCapacity: usedTables > GROWING_TABLE_CAPACITY,
    physicalUsedTables,
    rows,
    usedTables,
  };
}

function growingOccupancyRowForDate(placement: GrowingPlacement, date: string): GreenhouseGrowingOccupancy["rows"][number] | undefined {
  if ((placement.actualMovements ?? []).length > 0) {
    const actualTableIds = actualGrowingTablesOnDate(placement.actualMovements ?? [], date);
    if (actualTableIds.length === 0) {
      return undefined;
    }
    const reservation = reservationForActualTables(actualTableIds);
    const warnings = [
      ...(placement.warnings ?? []),
      ...actualPlacementMismatchWarnings(placement, actualTableIds, reservation),
    ];

    return {
      actualTableIds,
      dateRange: { start: placement.startDate, end: placement.endDate },
      density: placement.density,
      placementKind: "standardRow",
      placementSource: "actual",
      planRowId: placement.planRowId,
      primaryRow: reservation.primaryRow,
      reservedTables: reservation.reservedTables,
      rowLabel: formatGrowingTableSelection(actualTableIds),
      sectorName: placement.sectorName,
      tables: actualTableIds.length,
      usesExtraBlock: reservation.usesExtraBlock,
      warnings,
    };
  }

  return {
    dateRange: { start: placement.startDate, end: placement.endDate },
    density: placement.density,
    placementKind: placement.placementKind,
    placementSource: "planned",
    planRowId: placement.planRowId,
    primaryRow: placement.primaryRow,
    reservedTables: placement.reservedTables,
    rowLabel: plannedPlacementLabel(placement),
    sectorName: placement.sectorName,
    tables: placement.tables,
    usesExtraBlock: placement.usesExtraBlock,
    warnings: placement.warnings,
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

function assignPhysicalGrowingPlacements(rawPlacements: RawGrowingPlacement[]): GrowingPlacement[] {
  const reservations: GrowingPlacement[] = [];

  rawPlacements
    .slice()
    .sort((left, right) => left.startDate.localeCompare(right.startDate) || left.sectorName.localeCompare(right.sectorName))
    .forEach((raw) => {
      const active = activeGrowingReservations(reservations, raw.startDate);
      if ((raw.actualMovements ?? []).length > 0) {
        const actualTableIds = finalActualGrowingTables(raw.actualMovements ?? []);
        const reservation = reservationForActualTables(actualTableIds);
        const actualWarnings = [
          ...(raw.actualMovements?.flatMap((movement) => movement.warnings) ?? []),
          ...actualPlacementMismatchWarningsForPlan(raw.row, raw.plannedTables ?? raw.tables, actualTableIds, reservation),
        ];

        reservations.push({
          actualMovements: raw.actualMovements,
          density: raw.density,
          endDate: raw.endDate,
          placementKind: "standardRow",
          planRowId: raw.planRowId,
          primaryRow: reservation.primaryRow,
          releaseKnown: raw.releaseKnown,
          reservedTables: reservation.reservedTables,
          sectorName: raw.sectorName,
          startDate: raw.startDate,
          tables: actualTableIds.length || raw.tables,
          usesExtraBlock: reservation.usesExtraBlock,
          warnings: actualWarnings,
        });
        return;
      }
      const [option] = placementOptionsFor(raw.row, raw.tables, active, raw.startDate, raw.endDate);

      reservations.push({
        density: raw.density ?? option?.plantsPerTrough,
        endDate: raw.endDate,
        placementKind: option?.kind ?? "unplaced",
        planRowId: raw.planRowId,
        primaryRow: option?.primaryRow,
        releaseKnown: raw.releaseKnown,
        reservedTables: option?.reservedTables,
        sectorName: raw.sectorName,
        startDate: raw.startDate,
        tables: raw.tables,
        usesExtraBlock: option?.usesExtraBlock,
        warnings: option?.risks,
      });
    });

  return reservations.sort((left, right) => left.startDate.localeCompare(right.startDate) || left.sectorName.localeCompare(right.sectorName));
}

function findSowingDateAlternatives(
  rows: SowingPlanRow[],
  config: PlannerConfig,
  targetPlanRowId: string,
): GreenhouseSimulationAlternative[] {
  const finalRows = finalScheduledRows(rows, config);
  const target = finalRows.find((row) => row.id === targetPlanRowId);

  if (!target) {
    return [];
  }

  const schedule = scheduleProductionWork(finalRows);
  const existingReservations = assignPhysicalGrowingPlacements(
    schedule.items
      .filter((item) => item.type === "thinning" && item.planRowId !== targetPlanRowId)
      .map((item): RawGrowingPlacement | undefined => {
        const row = finalRows.find((candidate) => candidate.id === item.planRowId);
        if (!row) {
          return undefined;
        }

        return {
          density: item.greenhousePlacement?.plantsPerTrough,
          densityClass: item.greenhousePlacement?.densityClass,
          endDate: row.harvestDate,
          planRowId: row.id,
          plantsPerTrough: item.greenhousePlacement?.plantsPerTrough,
          releaseKnown: true,
          row,
          sectorName: row.sectorName,
          startDate: item.date,
          tables: row.placement?.tables ?? item.greenhousePlacement?.totalTables ?? calculateRecommendedTables(getTotalSow(row)),
        };
      })
      .filter((item): item is RawGrowingPlacement => Boolean(item)),
  );

  const workloadItems = schedule.items.filter((item) => item.planRowId !== targetPlanRowId);
  const candidates = [8, 9, 10, 11].flatMap((cycleDay) => {
    const thinningDate = addDays(target.sowingDate, cycleDay - 1);
    const activeReservations = activeGrowingReservations(existingReservations, thinningDate);
    const targetTables = target.placement?.tables ?? calculateGreenhouseTablePlacement(getTotalSow(target)).totalTables;

    return placementOptionsFor(target, targetTables, activeReservations, thinningDate, target.harvestDate).map((option) =>
      alternativeForOption(target, option, thinningDate, cycleDay, workloadItems),
    );
  });

  return candidates
    .filter((candidate) => candidate.physicalTables > 0)
    .sort(compareAlternatives)
    .filter(uniqueAlternative)
    .slice(0, 3);
}

function alternativeForOption(
  row: SowingPlanRow,
  option: PhysicalPlacementOption,
  thinningDate: string,
  cycleDay: number,
  scheduled: Array<Pick<WorkItem, "date" | "planRowId" | "type">>,
): GreenhouseSimulationAlternative {
  const sameDayItems = scheduled.filter((item) => item.date === thinningDate);
  const moveOutCollision = sameDayItems.some((item) => item.type === "harvest");
  const majorWorkCount = sameDayItems.filter((item) => ["thinning", "sideShoots", "sticks", "rings", "harvest"].includes(item.type)).length + 1;
  const workloadRisks = [
    ...(moveOutCollision ? ["Planting un retināšana vienā dienā: vispirms jāizvāc iepriekšējais HUS."] : []),
    ...(majorWorkCount > 2 ? [`Tajā pašā dienā ir ${majorWorkCount} galvenie darbi.`] : []),
  ];
  const emergencyRisks = cycleDay === 11 ? ["Retināšana 11. dienā ir ārkārtas risinājums; vajadzīga saskaņošana."] : [];
  const tier = alternativeTier(option, cycleDay, moveOutCollision, majorWorkCount);
  const risks = [...option.risks, ...workloadRisks, ...emergencyRisks];

  return {
    cycleDay,
    densityClass: option.densityClass,
    explanation: alternativeExplanation(option, tier),
    physicalTables: option.physicalTables,
    reservedTables: option.reservedTables,
    risks,
    score: option.score + (cycleDay === 11 ? 80 : 0) + (moveOutCollision ? 12 : 0) + Math.max(0, majorWorkCount - 2) * 8,
    sharedWith: option.sharedWith,
    thinningDate,
    tier,
    usesExtraBlock: option.usesExtraBlock,
    wateringZone: option.primaryRow,
  };
}

function alternativeTier(
  option: PhysicalPlacementOption,
  cycleDay: number,
  moveOutCollision: boolean,
  majorWorkCount: number,
): SimulationAlternativeTier {
  if (cycleDay === 11 || option.kind === "sharedRow" || moveOutCollision || majorWorkCount > 2 || option.densityClass === "exceptional") {
    return "strained";
  }

  if (option.kind === "aExtraOnly") {
    return "compromise";
  }

  return "preferred";
}

function alternativeExplanation(option: PhysicalPlacementOption, tier: SimulationAlternativeTier): string {
  if (tier === "preferred") {
    return "Vēlamais variants: viena HUS laistīšanas zona bez fiziskas rindu dalīšanas.";
  }

  if (option.kind === "aExtraOnly") {
    return "Kompromiss: mazs HUS izmanto brīvo A14-A26 papildu bloku.";
  }

  if (option.kind === "sharedRow") {
    return "Saspringts variants: viena B/C/D laistīšanas zona tiek dalīta ar citu HUS.";
  }

  return "Saspringts variants: izmanto pieļaujamu, bet ražošanā pārbaudāmu kompromisu.";
}

function placementOptionsFor(
  row: SowingPlanRow,
  requiredTables: number,
  activeReservations: GrowingPlacement[],
  startDate: string,
  endDate: string,
): PhysicalPlacementOption[] {
  const manualRow = row.placement?.primaryRow;
  const targetTables = Math.max(1, Math.min(39, Math.floor(requiredTables)));

  if (manualRow) {
    return [manualPlacementOption(row, targetTables, manualRow, activeReservations, startDate, endDate)].filter((option) => option.feasible);
  }

  return [
    ...standardRowOptions(row, targetTables, activeReservations, startDate),
    ...largeRowOptions(row, targetTables, activeReservations, startDate),
    ...aExtraOnlyOptions(row, targetTables, activeReservations, startDate),
    ...sharedRowOptions(row, targetTables, activeReservations, startDate, endDate),
  ].filter((option) => option.feasible);
}

function standardRowOptions(
  row: SowingPlanRow,
  requiredTables: number,
  activeReservations: GrowingPlacement[],
  date: string,
): PhysicalPlacementOption[] {
  if (requiredTables > LONG_ROW_TABLE_CAPACITY) {
    return [];
  }

  return freeLongRows(activeReservations).map((rowId) =>
    placementOption(row, {
      date,
      densityTables: requiredTables,
      explanation: "Viena HUS laistīšanas zona pilnā B/C/D rindā.",
      kind: "standardRow",
      physicalTables: requiredTables,
      primaryRow: rowId,
      reservedTables: LONG_ROW_TABLE_CAPACITY,
      risks: requiredTables < LONG_ROW_TABLE_CAPACITY ? [`${rowId} rinda rezervēta pilnībā, arī ja izmantoti ${requiredTables} no 26 galdiem.`] : [],
      score: 0,
      sharedWith: [],
      usesExtraBlock: false,
    }),
  );
}

function largeRowOptions(
  row: SowingPlanRow,
  requiredTables: number,
  activeReservations: GrowingPlacement[],
  date: string,
): PhysicalPlacementOption[] {
  if (requiredTables <= LONG_ROW_TABLE_CAPACITY || !aExtraBlockHasSpace(activeReservations, A_EXTRA_TABLE_CAPACITY)) {
    return [];
  }

  return freeLongRows(activeReservations).map((rowId) =>
    placementOption(row, {
      date,
      densityTables: requiredTables,
      explanation: "Lielais sektors: viena B/C/D rinda kopā ar A14-A26 papildu bloku.",
      kind: "largeWithExtra",
      physicalTables: requiredTables,
      primaryRow: rowId,
      reservedTables: LONG_ROW_TABLE_CAPACITY + A_EXTRA_TABLE_CAPACITY,
      risks: ["A14-A26 rezervēts šim HUS līdz Planting."],
      score: 4,
      sharedWith: [],
      usesExtraBlock: true,
    }),
  );
}

function aExtraOnlyOptions(
  row: SowingPlanRow,
  requiredTables: number,
  activeReservations: GrowingPlacement[],
  date: string,
): PhysicalPlacementOption[] {
  if (requiredTables > A_EXTRA_TABLE_CAPACITY || !aExtraBlockHasSpace(activeReservations, requiredTables)) {
    return [];
  }

  return [
    placementOption(row, {
      date,
      densityTables: requiredTables,
      explanation: "Mazs HUS atsevišķi izmanto A14-A26 papildu bloku.",
      kind: "aExtraOnly",
      physicalTables: requiredTables,
      primaryRow: "A",
      reservedTables: requiredTables,
      risks: ["Kompromiss: izmantots A papildu bloks, nevis garā B/C/D rinda."],
      score: 22,
      sharedWith: [],
      usesExtraBlock: true,
    }),
  ];
}

function sharedRowOptions(
  row: SowingPlanRow,
  requiredTables: number,
  activeReservations: GrowingPlacement[],
  date: string,
  endDate: string,
): PhysicalPlacementOption[] {
  if (requiredTables > LONG_ROW_TABLE_CAPACITY) {
    return [];
  }

  return LONG_GROWING_ROWS.flatMap((rowId) => {
    const existing = activeReservations.filter((reservation) => reservation.primaryRow === rowId && !reservation.usesExtraBlock);
    if (existing.length === 0) {
      return [];
    }

    const usedTables = existing.reduce((sum, reservation) => sum + reservation.tables, 0);
    if (usedTables + requiredTables > LONG_ROW_TABLE_CAPACITY) {
      return [];
    }

    const sharedWith = existing.map((reservation) => ({
      overlapDays: overlapDays(date, endDate, reservation.startDate, reservation.endDate),
      planRowId: reservation.planRowId,
      sectorName: reservation.sectorName,
    }));

    return [
      placementOption(row, {
        date,
        densityTables: requiredTables,
        explanation: "Ārkārtas variants: dalīta B/C/D laistīšanas zona.",
        kind: "sharedRow",
        physicalTables: requiredTables,
        primaryRow: rowId,
        reservedTables: requiredTables,
        risks: [
          `${rowId} laistīšanas zona tiek dalīta ar ${existing.map((reservation) => reservation.sectorName).join(", ")}; vajadzīga agronoma saskaņošana.`,
        ],
        score: 70 + existing.length * 8,
        sharedWith,
        usesExtraBlock: false,
      }),
    ];
  });
}

function manualPlacementOption(
  row: SowingPlanRow,
  requiredTables: number,
  primaryRow: GreenhouseRowId,
  activeReservations: GrowingPlacement[],
  date: string,
  endDate: string,
): PhysicalPlacementOption {
  const usesExtraBlock = primaryRow === "A" || requiredTables > LONG_ROW_TABLE_CAPACITY;
  const existingSameRow = primaryRow === "A"
    ? activeReservations.filter((reservation) => reservation.usesExtraBlock)
    : activeReservations.filter((reservation) => reservation.primaryRow === primaryRow);
  const physicalTables = primaryRow === "A" ? Math.min(requiredTables, A_EXTRA_TABLE_CAPACITY) : requiredTables;
  const capacity = primaryRow === "A" ? A_EXTRA_TABLE_CAPACITY : LONG_ROW_TABLE_CAPACITY;
  const used = existingSameRow.reduce((sum, reservation) => sum + (primaryRow === "A" ? reservation.tables : reservation.tables), 0);
  const feasible = used + physicalTables <= capacity || existingSameRow.length === 0;
  const sharedWith = existingSameRow.map((reservation) => ({
    overlapDays: overlapDays(date, endDate, reservation.startDate, reservation.endDate),
    planRowId: reservation.planRowId,
    sectorName: reservation.sectorName,
  }));

  return placementOption(row, {
    date,
    densityTables: requiredTables,
    explanation: "Manuāli norādīts izvietojums tiek respektēts.",
    feasible,
    kind: primaryRow === "A" ? "aExtraOnly" : requiredTables > LONG_ROW_TABLE_CAPACITY ? "largeWithExtra" : "standardRow",
    physicalTables,
    primaryRow,
    reservedTables: primaryRow === "A" ? physicalTables : requiredTables > LONG_ROW_TABLE_CAPACITY ? 39 : 26,
    risks: existingSameRow.length > 0 ? [`Manuālais izvietojums pārklājas ar ${existingSameRow.map((item) => item.sectorName).join(", ")}.`] : [],
    score: feasible ? 5 : 999,
    sharedWith,
    usesExtraBlock,
  });
}

function placementOption(
  row: SowingPlanRow,
  input: Omit<PhysicalPlacementOption, "densityClass" | "feasible" | "plantsPerTrough"> & {
    date: string;
    densityTables: number;
    feasible?: boolean;
  },
): PhysicalPlacementOption {
  const fixed = placementForTableCount(getTotalSow(row), input.densityTables);

  return {
    densityClass: fixed.densityClass,
    explanation: input.explanation,
    feasible: input.feasible ?? fixed.feasible,
    kind: input.kind,
    physicalTables: input.physicalTables,
    plantsPerTrough: fixed.plantsPerTrough,
    primaryRow: input.primaryRow,
    reservedTables: input.reservedTables,
    risks: [
      ...input.risks,
      ...(fixed.feasible ? [] : [fixed.reason]),
      ...(fixed.densityClass === "exceptional" ? [`Ārkārtas blīvums: ${fixed.plantsPerTrough} stādi renē.`] : []),
    ],
    score: input.score + densityScore(fixed.densityClass) + Math.abs(fixed.plantsPerTrough - 25) * 0.1,
    sharedWith: input.sharedWith,
    usesExtraBlock: input.usesExtraBlock,
  };
}

function placementForTableCount(plantCount: number, tables: number): GreenhouseTablePlacement {
  const base = calculateGreenhouseTablePlacement(plantCount, { maxTables: tables });
  const plantsPerTrough = Number((plantCount / (Math.max(1, tables) * 6)).toFixed(1));

  return {
    ...base,
    densityClass: densityClassFor(plantsPerTrough),
    extraTables: Math.max(0, tables - LONG_ROW_TABLE_CAPACITY),
    feasible: plantsPerTrough <= 35,
    plantsPerTrough,
    primaryRowTables: Math.min(tables, LONG_ROW_TABLE_CAPACITY),
    reason: plantsPerTrough <= 35 ? base.reason : `Blīvums ${plantsPerTrough} stādi renē pārsniedz 35 robežu.`,
    totalTables: tables,
  };
}

function densityClassFor(plantsPerTrough: number): PlacementDensityClass {
  if (plantsPerTrough >= 24 && plantsPerTrough <= 26) {
    return "normal";
  }

  if (plantsPerTrough <= 28) {
    return "slightlyCompressed";
  }

  return "exceptional";
}

function densityScore(densityClass: PlacementDensityClass): number {
  if (densityClass === "normal") {
    return 0;
  }

  if (densityClass === "slightlyCompressed") {
    return 10;
  }

  return 45;
}

function activeGrowingReservations(reservations: GrowingPlacement[], date: string): GrowingPlacement[] {
  return reservations
    .filter((reservation) => reservation.startDate <= date && date < reservation.endDate)
    .flatMap((reservation) => {
      if ((reservation.actualMovements ?? []).length === 0) {
        return [reservation];
      }

      const tableIds = actualGrowingTablesOnDate(reservation.actualMovements ?? [], date);
      if (tableIds.length === 0) {
        return [];
      }

      const actualReservation = reservationForActualTables(tableIds);
      return [{
        ...reservation,
        primaryRow: actualReservation.primaryRow,
        reservedTables: actualReservation.reservedTables,
        tables: tableIds.length,
        usesExtraBlock: actualReservation.usesExtraBlock,
      }];
    });
}

function freeLongRows(activeReservations: GrowingPlacement[]): LongGrowingRowId[] {
  const occupied = new Set(
    activeReservations
      .filter((reservation) => reservation.primaryRow && reservation.primaryRow !== "A")
      .map((reservation) => reservation.primaryRow),
  );

  return LONG_GROWING_ROWS.filter((row) => !occupied.has(row));
}

function aExtraBlockHasSpace(activeReservations: GrowingPlacement[], requiredTables: number): boolean {
  const used = activeReservations
    .filter((reservation) => reservation.usesExtraBlock)
    .reduce((sum, reservation) => sum + (reservation.placementKind === "largeWithExtra" ? A_EXTRA_TABLE_CAPACITY : reservation.tables), 0);

  return used + requiredTables <= A_EXTRA_TABLE_CAPACITY;
}

function overlapDays(leftStart: string, leftEnd: string, rightStart: string, rightEnd: string): number {
  const start = leftStart > rightStart ? leftStart : rightStart;
  const end = leftEnd < rightEnd ? leftEnd : rightEnd;
  if (start >= end) {
    return 0;
  }

  return eachDate(start, addDays(end, -1)).length;
}

function compareAlternatives(left: GreenhouseSimulationAlternative, right: GreenhouseSimulationAlternative): number {
  return (
    tierScore(left.tier) - tierScore(right.tier) ||
    left.score - right.score ||
    left.cycleDay - right.cycleDay ||
    left.thinningDate.localeCompare(right.thinningDate) ||
    (left.wateringZone ?? "").localeCompare(right.wateringZone ?? "")
  );
}

function tierScore(tier: SimulationAlternativeTier): number {
  if (tier === "preferred") {
    return 0;
  }

  if (tier === "compromise") {
    return 1;
  }

  return 2;
}

function uniqueAlternative(
  alternative: GreenhouseSimulationAlternative,
  index: number,
  alternatives: GreenhouseSimulationAlternative[],
): boolean {
  return alternatives.findIndex((candidate) =>
    candidate.thinningDate === alternative.thinningDate &&
    candidate.wateringZone === alternative.wateringZone &&
    candidate.usesExtraBlock === alternative.usesExtraBlock &&
    candidate.reservedTables === alternative.reservedTables
  ) === index;
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

export function interpretHusMovingEventPlacement(entry: HusEventEntry): InterpretedMovingEventPlacement | undefined {
  if (entry.eventType !== "move" && entry.eventType !== "thinning") {
    return undefined;
  }

  const movementRows = parseHusEventMovementRows(entry);
  if (movementRows.length === 0) {
    return undefined;
  }

  const rows = movementRows.map((row) => ({
    from: row.from,
    fromGrowingTables: parseGrowingTableSelection(row.from),
    to: row.to,
    toGrowingTables: parseGrowingTableSelection(row.to),
  }));
  const tableIds = uniqueGrowingTables(rows.flatMap((row) => row.toGrowingTables));
  const warnings = rows.flatMap((row) => {
    if (!row.to && !row.from) {
      return [];
    }

    if (row.to && row.toGrowingTables.length === 0) {
      return [`Moving ieraksta galamērķi "${row.to}" nevar droši interpretēt kā augšanas galdus.`];
    }

    return [];
  });

  if (tableIds.length === 0 && warnings.length === 0) {
    return undefined;
  }

  return {
    eventDate: entry.eventDate,
    eventId: entry.id,
    rows,
    tableIds,
    warnings,
  };
}

function actualGrowingMovements(row: Pick<SowingPlanRow, "husEvents">): ActualGrowingMovement[] {
  return (row.husEvents ?? [])
    .map(interpretHusMovingEventPlacement)
    .filter((placement): placement is InterpretedMovingEventPlacement => Boolean(placement))
    .sort((left, right) => left.eventDate.localeCompare(right.eventDate) || left.eventId.localeCompare(right.eventId))
    .map((placement) => ({
      eventDate: placement.eventDate,
      eventId: placement.eventId,
      fromTableIds: uniqueGrowingTables(placement.rows.flatMap((row) => row.fromGrowingTables)),
      tableIds: placement.tableIds,
      warnings: placement.warnings,
    }));
}

function actualGrowingTablesOnDate(movements: ActualGrowingMovement[], date: string): string[] {
  const state = new Set<string>();

  movements
    .filter((movement) => movement.eventDate <= date)
    .forEach((movement) => {
      movement.fromTableIds.forEach((table) => state.delete(table));
      movement.tableIds.forEach((table) => state.add(table));
    });

  return uniqueGrowingTables(Array.from(state));
}

function finalActualGrowingTables(movements: ActualGrowingMovement[]): string[] {
  if (movements.length === 0) {
    return [];
  }

  return actualGrowingTablesOnDate(movements, movements.at(-1)?.eventDate ?? "");
}

function parseGrowingTableSelection(value: string | undefined): string[] {
  if (!value) {
    return [];
  }

  const tables: string[] = [];
  value
    .split(/[,\s]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .forEach((part) => {
      const rangeMatch = /^([ABCD])(\d{1,2})\s*[-–]\s*(?:([ABCD])?(\d{1,2}))$/i.exec(part);
      if (rangeMatch) {
        const startRow = rangeMatch[1].toUpperCase() as PhysicalGrowingRowId;
        const endRow = (rangeMatch[3] ?? rangeMatch[1]).toUpperCase() as PhysicalGrowingRowId;
        const start = Number(rangeMatch[2]);
        const end = Number(rangeMatch[4]);

        if (startRow === endRow) {
          const from = Math.min(start, end);
          const to = Math.max(start, end);
          for (let table = from; table <= to; table += 1) {
            const id = `${startRow}${table}`;
            if (isGrowingTableId(id)) {
              tables.push(id);
            }
          }
        }
        return;
      }

      const tableMatch = /^([ABCD])(\d{1,2})$/i.exec(part);
      if (tableMatch) {
        const id = `${tableMatch[1].toUpperCase()}${Number(tableMatch[2])}`;
        if (isGrowingTableId(id)) {
          tables.push(id);
        }
      }
    });

  return uniqueGrowingTables(tables);
}

function isGrowingTableId(tableId: string): boolean {
  const match = /^([ABCD])(\d{1,2})$/.exec(tableId);
  if (!match) {
    return false;
  }

  const row = match[1] as PhysicalGrowingRowId;
  const table = Number(match[2]);

  if (row === "A") {
    return table >= 14 && table <= 26;
  }

  return table >= 1 && table <= 26;
}

function uniqueGrowingTables(tables: string[]): string[] {
  return Array.from(new Set(tables)).sort(compareGrowingTableIds);
}

function compareGrowingTableIds(left: string, right: string): number {
  const leftRow = left[0];
  const rightRow = right[0];
  if (leftRow !== rightRow) {
    return leftRow.localeCompare(rightRow);
  }

  return Number(left.slice(1)) - Number(right.slice(1));
}

function reservationForActualTables(tableIds: string[]): Pick<GrowingPlacement, "primaryRow" | "reservedTables" | "usesExtraBlock"> {
  const rows = new Set(tableIds.map((table) => table[0] as PhysicalGrowingRowId));
  const longRows = LONG_GROWING_ROWS.filter((row) => rows.has(row));
  const usesExtraBlock = rows.has("A");
  const reservedLongRows = longRows.length * LONG_ROW_TABLE_CAPACITY;
  const reservedExtra = usesExtraBlock ? tableIds.filter((table) => table.startsWith("A")).length : 0;

  return {
    primaryRow: longRows[0] ?? (usesExtraBlock ? "A" : undefined),
    reservedTables: reservedLongRows + reservedExtra,
    usesExtraBlock,
  };
}

function formatGrowingTableSelection(tableIds: string[]): string {
  const byRow = new Map<string, number[]>();
  tableIds.forEach((tableId) => {
    const row = tableId[0];
    const table = Number(tableId.slice(1));
    byRow.set(row, [...(byRow.get(row) ?? []), table].sort((left, right) => left - right));
  });

  return Array.from(byRow.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([row, tables]) => formatNumberRanges(tables).map((range) => formatRowRange(row, range)))
    .join(", ");
}

function formatRowRange(row: string, range: string): string {
  const [start, end] = range.split("-");
  return end ? `${row}${start}-${row}${end}` : `${row}${start}`;
}

function formatNumberRanges(values: number[]): string[] {
  const ranges: string[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const start = values[index];
    let end = start;
    while (index + 1 < values.length && values[index + 1] === end + 1) {
      index += 1;
      end = values[index];
    }
    ranges.push(start === end ? `${start}` : `${start}-${end}`);
  }
  return ranges;
}

function plannedPlacementLabel(placement: Pick<GrowingPlacement, "primaryRow" | "tables" | "usesExtraBlock">): string | undefined {
  if (!placement.primaryRow) {
    return undefined;
  }

  if (placement.primaryRow === "A") {
    return "A14-A26";
  }

  return `${placement.primaryRow}1-${placement.primaryRow}${Math.min(placement.tables, LONG_ROW_TABLE_CAPACITY)}`;
}

function actualPlacementMismatchWarnings(
  placement: GrowingPlacement,
  actualTableIds: string[],
  reservation: Pick<GrowingPlacement, "primaryRow" | "reservedTables">,
): string[] {
  const warnings: string[] = [];
  if (placement.primaryRow && reservation.primaryRow && placement.primaryRow !== reservation.primaryRow) {
    warnings.push(`Faktiskais Moving izvietojums ir ${reservation.primaryRow} rindā, bet plānotā rinda bija ${placement.primaryRow}.`);
  }

  if (placement.tables && actualTableIds.length !== placement.tables) {
    warnings.push(`Faktiskais Moving izmanto ${actualTableIds.length} galdus, plānoti bija ${placement.tables}.`);
  }

  return warnings;
}

function actualPlacementMismatchWarningsForPlan(
  row: Pick<SowingPlanRow, "placement">,
  plannedTables: number,
  actualTableIds: string[],
  reservation: Pick<GrowingPlacement, "primaryRow">,
): string[] {
  const warnings: string[] = [];
  if (row.placement?.primaryRow && reservation.primaryRow && row.placement.primaryRow !== reservation.primaryRow) {
    warnings.push(`Faktiskais Moving izvietojums ir ${reservation.primaryRow} rindā, bet plānotā rinda bija ${row.placement.primaryRow}.`);
  }

  if (plannedTables && actualTableIds.length !== plannedTables) {
    warnings.push(`Faktiskais Moving izmanto ${actualTableIds.length} galdus, plānoti bija ${plannedTables}.`);
  }

  return warnings;
}

function classifySimulation(
  occupancy: GreenhouseOccupancyDay[],
  scheduleWarnings: string[],
  changedOtherWork: SowingDateSimulationResult["changedOtherWork"],
  alternatives: GreenhouseSimulationAlternative[],
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

  if (alternatives.length === 0) {
    return "cannot";
  }

  if (scheduleWarnings.length > 0 || changedOtherWork.length > 0 || alternatives[0]?.tier !== "preferred") {
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

function fallbackRowFor(planRowId: string, sectorName: string, date: string): SowingPlanRow {
  return {
    correction: 0,
    cycleLength: 21,
    extraPlants: 0,
    harvestDate: date,
    id: planRowId,
    plantsPerBox: 12,
    requiredPlants: 0,
    sectorName,
    sectorType: 26,
    sowingDate: date,
    variety: "",
  };
}

import {
  addDays,
  applyWorkloadBalanceProposals,
  balanceWorkload,
  calculateRecommendedTables,
  calculateSowingPlan,
  clearOptimizerWorkAdjustments,
  eachDate,
  generateWorkItemsForRows,
  getTotalSow,
  parseHusEventMovementRows,
  parseSowingTableSelection,
} from "./planning";
import {
  calculateGreenhouseTablePlacement,
  evaluateGreenhouseDensity,
  type GreenhouseTablePlacement,
  type PlacementDensityClass,
} from "./greenhouse-placement";
import { evaluateThinningWorkload, scheduleProductionWork } from "./scheduler";
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
    reason: "missingSowingTables" | "unknownRelease" | "unknownCount";
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
  recommendation?: GreenhouseSimulationAlternative;
  notices: SimulationNotice[];
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
  status: "can" | "conditional";
  seedingTables: string[];
  seedingTableCount: number;
  normalTables: number;
  plantsPerTrough: number;
  placementKind: GrowingPlacementKind;
  workload: ReturnType<typeof evaluateThinningWorkload>;
  avoidsDay9Overload: boolean;
  upcomingSowingCount: number;
  notices: SimulationNotice[];
  explanationEn: string;
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

export type SimulationNotice = { lv: string; en: string };

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

  // Freeze existing reservations and work for other HUS. A proposal must not
  // become feasible by silently moving another HUS or changing its density.
  const currentWorkItems = generateWorkItemsForRows(rows, config);
  const currentRows = finalScheduledRows(rows, config);
  const existingPlacements = growingPlacements(currentRows)
    .filter((entry) => entry.planRowId !== targetPlanRowId)
    .map((entry) => {
      const row = currentRows.find((candidate) => candidate.id === entry.planRowId);
      const primaryRow = row?.placement?.primaryRow;
      if (!primaryRow || entry.actualMovements?.length) return entry;
      // The occupancy view can flag an overlapping plan as unplaced. Its
      // explicit future row is still a reservation that this search must keep.
      const tables = row.placement?.tables ?? entry.tables;
      return { ...entry, primaryRow, tables,
        reservedTables: primaryRow === "A" ? tables : tables > 26 ? 39 : 26,
        usesExtraBlock: primaryRow === "A" || tables > 26,
        placementKind: primaryRow === "A" ? "aExtraOnly" as const : tables > 26 ? "largeWithExtra" as const : "standardRow" as const };
    });
  const scenarioTarget = scenarioRows.find((row) => row.id === targetPlanRowId) ?? target;
  const search = findSowingDateAlternatives(currentRows, scenarioTarget, existingPlacements, currentWorkItems);
  const alternatives = search.alternatives;
  const recommendation = alternatives[0];
  const previewRows = scenarioRows.map((row) => row.id === targetPlanRowId && recommendation ? {
    ...row,
    adjustments: { ...row.adjustments, thinning: recommendation.thinningDate },
  } : row);
  const previewTarget = previewRows.find((row) => row.id === targetPlanRowId) ?? scenarioTarget;
  const placements: GrowingPlacement[] = recommendation ? [...existingPlacements, {
    planRowId: target.id, sectorName: target.sectorName, startDate: recommendation.thinningDate,
    endDate: previewTarget.harvestDate, tables: recommendation.physicalTables,
    reservedTables: recommendation.reservedTables, primaryRow: recommendation.wateringZone,
    usesExtraBlock: recommendation.usesExtraBlock, density: recommendation.plantsPerTrough,
    placementKind: recommendation.placementKind, releaseKnown: true,
  }] : existingPlacements;
  const currentRange = relevantDateRange(rows);
  const scenarioRange = relevantDateRange(scenarioRows);
  const startDate = minIsoDate(currentRange.start, scenarioRange.start);
  const endDate = maxIsoDate(currentRange.end, scenarioRange.end);
  const occupancy = eachDate(startDate, endDate).map((date) => ({
    date, seeding: simulationSeedingOccupancy(previewRows, placements, date),
    growing: simulationGrowingPreview(placements, date, recommendation, target.id), warnings: [],
  }));
  const notices = search.notices;
  const status = recommendation?.status ?? (search.incomplete ? "insufficientData" : "cannot");
  const warnings = notices.map((entry) => entry.lv);

  return {
    alternatives,
    recommendation,
    notices,
    changedOtherWork: [],
    currentMoveOutDate: target.harvestDate,
    currentSowingDate: target.sowingDate,
    explanation: simulationExplanation(status),
    newMoveOutDate: scenarioTarget.harvestDate,
    newSowingDate,
    occupancy,
    originalRowsUnchanged: JSON.stringify(rows) === originalRowsSnapshot,
    scenarioRows: previewRows,
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
  target: SowingPlanRow,
  reservations: GrowingPlacement[],
  currentWork: WorkItem[],
): { alternatives: GreenhouseSimulationAlternative[]; notices: SimulationNotice[]; incomplete: boolean } {
  const notices: SimulationNotice[] = [];
  const plants = getTotalSow(target);
  if (!Number.isFinite(plants) || !Number.isInteger(plants) || plants <= 0) {
    return { alternatives: [], incomplete: true, notices: [{
      lv: "Trūkst derīga HUS sējamo stādu skaita; sēšanas galdu skaitu nevar aprēķināt.",
      en: "A valid HUS sowing plant count is missing; the number of seeding tables cannot be calculated.",
    }] };
  }
  if (actualGrowingMovements(target).length > 0) {
    return { alternatives: [], incomplete: true, notices: [{
      lv: "Šim HUS jau ir faktiskais Moving. Vēsturisku izvietojumu nepārplānojam; simulācijai izvēlies HUS pirms Moving.",
      en: "This HUS already has an actual Moving record. Historical placement is preserved; select a HUS before Moving.",
    }] };
  }
  const targetSchedule = scheduleProductionWork([target]);
  const invalid = targetSchedule.warnings.filter((warning) =>
    warning.code === "invalid_manual_adjustment" || warning.code === "no_valid_window");
  if (invalid.length) return {
    alternatives: [], incomplete: false,
    notices: invalid.map((warning) => ({ lv: warning.message,
      en: target.sectorName + ": an existing manual work date or biological work window is invalid (" + warning.type + ")." })),
  };
  const seedingPlan = calculateSowingPlan(plants);
  const needed = seedingPlan.fullTables + Number(seedingPlan.hasPartialTable);
  const normalTables = target.placement?.tables ?? calculateGreenhouseTablePlacement(plants).totalTables;
  if (!Number.isInteger(normalTables) || normalTables < 1 || normalTables > 39) {
    return { alternatives: [], incomplete: true, notices: [{
      lv: "HUS augšanas galdu skaits nav derīgs fiziskajam 26+13 galdu modelim.",
      en: "The HUS growing table count is invalid for the physical 26+13 table model.",
    }] };
  }
  const work = [
    ...currentWork.filter((item) => item.planRowId !== target.id),
    ...targetSchedule.items.filter((item) => item.type !== "thinning"),
  ];
  const otherRows = rows.filter((row) => row.id !== target.id && !row.archivedAt);
  const counts = Array.from({ length: normalTables }, (_, index) => normalTables - index)
    .filter((count) => evaluateGreenhouseDensity(plants, count).feasible);
  if (!counts.length) return { alternatives: [], incomplete: false, notices: [{
    lv: "Ar " + normalTables + " augšanas galdiem " + plants + " stādi pārsniedz atļauto blīvumu; vajadzīgs lielāks izvietojums.",
    en: plants + " plants exceed the permitted density on " + normalTables + " growing tables; a larger placement is required.",
  }] };
  let incomplete = false;
  function candidatesForDay(cycleDay: number): GreenhouseSimulationAlternative[] {
    const date = addDays(target.sowingDate, cycleDay - 1);
    if (date >= target.harvestDate) return [];
    const seeding = checkSimulationSeedingCapacity(target, otherRows, reservations, date, needed);
    if (!seeding.feasible && !seeding.incomplete) {
      notices.push(...seeding.notices);
      return [];
    }
    const interval = eachDate(date, addDays(target.harvestDate, -1)).map((day) => ({
      date: day, active: simulationReservationsOnDate(reservations, day),
    }));
    const workload = evaluateThinningWorkload(date, target.id, work);
    const avoidsDay9Overload = cycleDay === 8 &&
      evaluateThinningWorkload(addDays(target.sowingDate, 8), target.id, work).overload > workload.overload;
    const growingCandidates = counts.flatMap((count) => {
      const density = evaluateGreenhouseDensity(plants, count);
      const options = [...new Map([{ active: [] as GrowingPlacement[] }, ...interval].flatMap((day) =>
        placementOptionsFor(target, count, day.active, date, target.harvestDate))
        .map((option) => {
          // A manual row may share physical space, even when it was free on
          // the thinning date. Classify it consistently for the whole stay.
          if (target.placement?.primaryRow && option.kind === "standardRow" &&
            interval.some((day) => day.active.some((entry) => entry.primaryRow === option.primaryRow))) {
            option = { ...option, kind: "sharedRow", reservedTables: option.physicalTables };
          }
          return [[option.kind, option.primaryRow, option.physicalTables].join("|"), option] as const;
        })).values()];
      return options.filter((option) => {
        if (option.physicalTables !== count) return false;
        const conflict = interval.find((day) => !simulationOptionFits(option, day.active));
        if (conflict) notices.push(simulationGrowingConflict(option, conflict.active, conflict.date));
        return !conflict;
      }).map((option) => {
        const sharedById = new Map<string, { planRowId: string; sectorName: string; overlapDays: number }>();
        if (option.kind === "sharedRow") for (const day of interval) {
          for (const entry of day.active.filter((entry) => entry.primaryRow === option.primaryRow)) {
            const previous = sharedById.get(entry.planRowId);
            sharedById.set(entry.planRowId, { planRowId: entry.planRowId, sectorName: entry.sectorName,
              overlapDays: (previous?.overlapDays ?? 0) + 1 });
          }
        }
        const sharedWith = [...sharedById.values()];
        const missing = [...seeding.notices];
        if (reservations.some((entry) => entry.placementKind === "unplaced" &&
          overlapDays(date, target.harvestDate, entry.startDate, entry.endDate) > 0)) missing.push({
          lv: "Citam HUS pārklājošajā periodā nav zināma augšanas rinda; izvietojums ir nosacīts.",
          en: "Another HUS has no known growing row during the overlap; this placement is conditional.",
        });
        const unknownMoving = reservations.some((entry) => entry.endDate > date && entry.actualMovements?.some((movement) =>
          movement.eventDate < target.harvestDate && movement.warnings.length > 0));
        if (unknownMoving) missing.push({
          lv: "Cita HUS Moving ierakstā ir neskaidra atrašanās vieta; vajadzīgs precizējums.",
          en: "Another HUS has an unclear Moving destination; clarification is required.",
        });
        const plantingHandoff = reservations.filter((entry) => entry.endDate === date &&
          (entry.primaryRow === option.primaryRow || option.usesExtraBlock && entry.usesExtraBlock));
        const freedFor = otherRows.filter((row) => row.sowingDate > date &&
          row.sowingDate <= addDays(target.sowingDate, 9));
        const upcomingSowingCount = otherRows.filter((row) =>
          row.sowingDate > date && row.sowingDate <= addDays(target.sowingDate, 9)).length;
        const risks: SimulationNotice[] = [...missing];
        if (workload.sowingCount) risks.push({
          lv: date + ": paredzēta arī cita HUS sēšana; šī darbu kombinācija ir pieļaujama.",
          en: date + ": another HUS is also being seeded; this combination of work is permitted.",
        });
        if (workload.thinningCount) risks.push({
          lv: "Tajā pašā dienā paredzēta arī cita HUS retināšana.",
          en: "Another HUS is also being thinned on this date.",
        });
        if (workload.plantingCount || plantingHandoff.length) risks.push({
          lv: "Planting un retināšana vienā dienā: vispirms jāizvāc iepriekšējais HUS, pēc tam retināšana.",
          en: "Planting and thinning on the same day: remove the previous HUS first, then thin the new HUS.",
        });
        if (workload.overload > 0) risks.push({
          lv: "Plānotā darbu slodze " + workload.projectedLoad + "; pārsniegums " + workload.overload + ". Jāsaskaņo darba kapacitāte.",
          en: "Planned workload " + workload.projectedLoad + "; overload " + workload.overload + ". Confirm labour capacity.",
        });
        if (count < normalTables) risks.push({
          lv: "Sablīvēts priekšlikums: " + normalTables + " → " + count + " galdi. Citu HUS blīvums nemainās.",
          en: "Compressed proposal: " + normalTables + " → " + count + " tables. Other HUS densities are unchanged.",
        });
        if (density.densityClass === "exceptional") risks.push({
          lv: "Ārkārtas blīvums " + density.plantsPerTrough + " stādi/renē: tehniskā robeža ir esošajos noteikumos, bet konkrētā HUS atļauja jāsaskaņo ar agronomu.",
          en: "Exceptional density " + density.plantsPerTrough + " plants/trough: within the existing technical limit, but approval for this HUS requires an agronomist.",
        });
        if (option.kind === "sharedRow") risks.push({
          lv: "Dalīta laistīšanas zona ar " + sharedWith.map((entry) => entry.sectorName).join(", ") + "; vajadzīga agronoma saskaņošana.",
          en: "Shared watering zone with " + sharedWith.map((entry) => entry.sectorName).join(", ") + "; agronomist approval is required.",
        });
        if (option.usesExtraBlock) risks.push({
          lv: "Izmantots A14–A26 papildu bloks; tas jāsaglabā brīvs visā augšanas periodā.",
          en: "Uses the A14–A26 extra block; it must remain available throughout the growing period.",
        });
        if (cycleDay === 11) risks.push({
          lv: "Retināšana 11. dienā ir ārkārtas risinājums; vajadzīga saskaņošana.",
          en: "Day-11 thinning is an emergency option requiring approval.",
        });
        const conditional = missing.length > 0 || count < normalTables || cycleDay === 11 ||
          workload.overload > 0 || workload.plantingCount > 0 || plantingHandoff.length > 0 ||
          option.kind === "sharedRow" || option.usesExtraBlock || density.densityClass === "exceptional";
        const tier: SimulationAlternativeTier = cycleDay === 11 || option.kind === "sharedRow" ||
          density.densityClass === "exceptional" || workload.overload > 0 ? "strained"
          : count < normalTables || option.kind === "aExtraOnly" || plantingHandoff.length ? "compromise" : "preferred";
        const explanation = avoidsDay9Overload ? {
          lv: "Retināšana 8. dienā ļauj izvairīties no darba pārslodzes 9. dienā un agrāk atbrīvo sēšanas galdus.",
          en: "Thinning on day 8 avoids the workload overload on day 9 and releases seeding tables earlier.",
        } : freedFor.length ? {
          lv: "Agrāka retināšana atbrīvo sēšanas galdus nākamajai sēšanai: " + freedFor.map((row) => row.sectorName + " " + row.sowingDate).join(", ") + ".",
          en: "Earlier thinning releases seeding tables for the next sowing: " + freedFor.map((row) => row.sectorName + " " + row.sowingDate).join(", ") + ".",
        } : upcomingSowingCount ? {
          lv: "Tuvākajās dienās paredzēta cita sēšana; agrāka retināšana saīsina sēšanas galdu aizņemšanu.",
          en: "Another sowing is scheduled in the next few days; earlier thinning releases seeding tables sooner.",
        } : {
          lv: "Izvērtēta visa sēšanas un augšanas perioda pieejamība un darbu slodze pēc pašreizējiem plānošanas noteikumiem; priekšroka vienai laistīšanas rindai.",
          en: "Availability was checked throughout seeding and growing, using the existing workload rules; one watering row is preferred.",
        };
        return {
          cycleDay, thinningDate: date, densityClass: density.densityClass,
          explanation: explanation.lv, explanationEn: explanation.en,
          physicalTables: count, normalTables, plantsPerTrough: density.plantsPerTrough,
          reservedTables: option.reservedTables, usesExtraBlock: option.usesExtraBlock,
          wateringZone: option.primaryRow, placementKind: option.kind, sharedWith,
          tier, status: conditional ? "conditional" as const : "can" as const,
          score: option.score, risks: risks.map((entry) => entry.lv), notices: uniqueNotices(risks),
          seedingTables: seeding.tables, seedingTableCount: seeding.tableCount, workload, avoidsDay9Overload, upcomingSowingCount,
        };
      });
    });
    if (!seeding.feasible) {
      // Missing release data matters only if a growing placement could work.
      // Otherwise the independently proven growing conflict explains rejection.
      if (growingCandidates.length) {
        incomplete = true;
        notices.unshift(...seeding.notices);
      }
      return [];
    }
    return growingCandidates;
  }
  const regular = [8, 9, 10].flatMap(candidatesForDay);
  const normalFits = regular.some((option) => option.physicalTables === normalTables);
  // Compression is a fallback, not an extra near-identical choice when an
  // ordinary placement already fits within the normal biological window.
  const candidates = regular.length
    ? normalFits ? regular.filter((option) => option.physicalTables === normalTables) : regular
    : candidatesForDay(11);
  const alternatives = candidates.sort(compareAlternatives).filter(uniqueAlternative).slice(0, 4);
  if (!alternatives.length && !notices.length) notices.push({
    lv: "Nav atrasts fiziski derīgs sēšanas un augšanas izvietojums 8.–10. vai ārkārtas 11. dienā.",
    en: "No physically valid seeding and growing placement was found on days 8–10 or emergency day 11.",
  });
  return { alternatives, notices: uniqueNotices([...notices, ...(alternatives[0]?.notices ?? [])]), incomplete };
}

function uniqueNotices(notices: SimulationNotice[]): SimulationNotice[] {
  return [...new Map(notices.map((entry) => [entry.lv, entry])).values()];
}

function simulationGrowingPreview(
  placements: GrowingPlacement[], date: string, recommendation: GreenhouseSimulationAlternative | undefined, targetId: string,
): GreenhouseGrowingOccupancy {
  const occupancy = growingOccupancy(placements, date);
  if (recommendation?.placementKind !== "sharedRow" || !occupancy.rows.some((row) => row.planRowId === targetId)) return occupancy;
  const sameZone = occupancy.rows.filter((row) => row.primaryRow === recommendation.wateringZone);
  const unusedReservation = sameZone.reduce((sum, row) => sum + Math.max(0, (row.reservedTables ?? row.tables) - row.tables), 0);
  // A shared proposal uses free physical space inside an existing reservation,
  // rather than counting that watering zone twice. The main capacity view is unchanged.
  const usedTables = occupancy.usedTables - Math.min(unusedReservation, recommendation.reservedTables);
  return { ...occupancy, usedTables, freeTables: Math.max(0, occupancy.capacity - usedTables), overCapacity: usedTables > occupancy.capacity };
}

function checkSimulationSeedingCapacity(
  target: SowingPlanRow, rows: SowingPlanRow[], reservations: GrowingPlacement[], thinningDate: string, needed: number,
): { tables: string[]; tableCount: number; feasible: boolean; notices: SimulationNotice[]; incomplete: boolean } {
  const targetTables = parseSowingTableSelection(target.sowingTables);
  const tableCount = Math.max(needed, targetTables.length);
  const lifecycles = simulationSeedingLifecycles(rows, reservations).filter((entry) =>
    entry.start <= thinningDate && entry.end >= target.sowingDate);
  lifecycles.push({ planRowId: target.id, sectorName: target.sectorName, tables: targetTables,
    start: target.sowingDate, end: thinningDate, count: tableCount, releaseKnown: true });
  const notices: SimulationNotice[] = [];
  const conflicts: SimulationNotice[] = [];
  const notified = new Set<string>();
  let blockedByUnknownRelease = false;
  for (const date of eachDate(target.sowingDate, thinningDate)) {
    const active = lifecycles.filter((entry) => entry.start <= date && date <= entry.end);
    for (const entry of active) {
      if ((entry.count === undefined || !entry.releaseKnown) && !notified.has(entry.planRowId)) {
        notified.add(entry.planRowId);
        notices.push({
          lv: date + ": " + entry.sectorName + (entry.count === undefined
            ? " nav zināms nepieciešamais sēšanas galdu skaits; kapacitāti nevar pilnībā apstiprināt."
            : " nav droši zināms sēšanas galdu atbrīvošanas datums; kapacitāti nevar pilnībā apstiprināt."),
          en: date + ": " + entry.sectorName + (entry.count === undefined
            ? " has an unknown required seeding-table count; capacity cannot be fully confirmed."
            : " has an unknown seeding-table release date; capacity cannot be fully confirmed."),
        });
      }
    }
    const used = active.reduce((sum, entry) => sum + (entry.count ?? entry.tables.length), 0);
    const certain = active.filter((entry) => entry.releaseKnown);
    const certainUsed = certain.reduce((sum, entry) => sum + (entry.count ?? entry.tables.length), 0);
    if (used > SEEDING_TABLE_CAPACITY) {
      const uncertain = certainUsed <= SEEDING_TABLE_CAPACITY;
      blockedByUnknownRelease ||= uncertain;
      if (!uncertain) conflicts.push({
        lv: date + ": vajag " + certainUsed + " sēšanas galdus, pieejami " + SEEDING_TABLE_CAPACITY + " (" + certain.map((entry) => entry.sectorName).join(", ") + ").",
        en: date + ": " + certainUsed + " seeding tables required, " + SEEDING_TABLE_CAPACITY + " available (" + certain.map((entry) => entry.sectorName).join(", ") + ").",
      });
    }
    for (let index = 1; index <= SEEDING_TABLE_CAPACITY; index++) {
      const table = "A" + index;
      const owners = active.filter((entry) => entry.tables.includes(table));
      if (owners.length < 2) continue;
      if (owners.filter((entry) => entry.releaseKnown).length < 2) {
        blockedByUnknownRelease = true;
      } else conflicts.push({
        lv: date + ": " + table + " sēšanas galda konflikts (" + owners.map((entry) => entry.sectorName).join(", ") + ").",
        en: date + ": " + table + " seeding-table conflict (" + owners.map((entry) => entry.sectorName).join(", ") + ").",
      });
    }
  }
  if (conflicts.length) return { tables: targetTables, tableCount, feasible: false, notices: uniqueNotices(conflicts), incomplete: false };
  // A daily count is sufficient for interchangeable tables. Fixed reservations
  // also need a continuous allocation: no unrecorded mid-cycle table moves.
  const certainLifecycles = lifecycles.filter((entry) => entry.releaseKnown);
  if (!simulationFixedSeedingFits(certainLifecycles, target.sowingDate, thinningDate)) {
    const fixed = certainLifecycles.filter((entry) => entry.tables.length);
    const conflict = {
      lv: target.sowingDate + "–" + thinningDate + ": fiksētās sēšanas galdu rezervācijas neatstāj nepārtrauktu vietu nepieciešamajam galdu skaitam (" + fixed.map((entry) => entry.sectorName + ": " + entry.tables.join(", ") + " " + entry.start + "–" + entry.end).join("; ") + ").",
      en: target.sowingDate + "–" + thinningDate + ": fixed seeding-table reservations leave no continuous allocation for the required table counts (" + fixed.map((entry) => entry.sectorName + ": " + entry.tables.join(", ") + " " + entry.start + "–" + entry.end).join("; ") + ").",
    };
    return { tables: targetTables, tableCount, feasible: false, notices: [conflict], incomplete: false };
  }
  if (blockedByUnknownRelease || certainLifecycles.length !== lifecycles.length &&
    !simulationFixedSeedingFits(lifecycles, target.sowingDate, thinningDate)) {
    return { tables: targetTables, tableCount, feasible: false, notices: uniqueNotices(notices), incomplete: true };
  }
  return { tables: targetTables, tableCount, feasible: true, notices: uniqueNotices(notices), incomplete: notices.length > 0 };
}

type SimulationSeedingLifecycle = {
  planRowId: string; sectorName: string; start: string; end: string;
  tables: string[]; count?: number; releaseKnown: boolean;
};

function simulationSeedingLifecycles(rows: SowingPlanRow[], reservations: GrowingPlacement[]): SimulationSeedingLifecycle[] {
  return rows.filter((row) => !row.archivedAt).map((row) => {
    const placement = reservations.find((entry) => entry.planRowId === row.id);
    const releaseKnown = Boolean(placement?.releaseKnown || placement?.actualMovements?.length);
    const plants = getTotalSow(row);
    const validCount = Number.isFinite(plants) && Number.isInteger(plants) && plants > 0;
    const plan = validCount ? calculateSowingPlan(plants) : undefined;
    const tables = parseSowingTableSelection(row.sowingTables);
    return { planRowId: row.id, sectorName: row.sectorName, start: row.sowingDate,
      // Planting bounds even an unknown release; old cycles cannot reserve forever.
      end: releaseKnown && placement ? minIsoDate(placement.startDate, addDays(row.harvestDate, -1)) : addDays(row.harvestDate, -1),
      tables, releaseKnown,
      count: plan ? Math.max(tables.length, plan.fullTables + Number(plan.hasPartialTable)) : undefined };
  });
}

function simulationFixedSeedingFits(entries: SimulationSeedingLifecycle[], start: string, end: string): boolean {
  if (!entries.some((entry) => entry.tables.length)) return true;
  const overlaps = (a: SimulationSeedingLifecycle, b: SimulationSeedingLifecycle) =>
    maxIsoDate(maxIsoDate(a.start, b.start), start) <= minIsoDate(minIsoDate(a.end, b.end), end);
  const mask = (tables: string[]) => tables.reduce((bits, table) => bits | 1 << (Number(table.slice(1)) - 1), 0);
  const all = (1 << SEEDING_TABLE_CAPACITY) - 1;
  const jobs = entries.map((entry) => {
    const fixed = mask(entry.tables);
    const blocked = entries.filter((other) => other !== entry && overlaps(entry, other))
      .reduce((bits, other) => bits | mask(other.tables), 0);
    return { entry, fixed, available: all & ~blocked & ~fixed,
      extra: (entry.count ?? entry.tables.length) - entry.tables.length };
  }).sort((a, b) => bitCount(a.available) - a.extra - (bitCount(b.available) - b.extra) || b.extra - a.extra);
  const allocated: Array<{ entry: SimulationSeedingLifecycle; bits: number }> = [];
  function fit(index: number): boolean {
    if (index === jobs.length) return true;
    const job = jobs[index];
    const busy = allocated.filter((other) => overlaps(job.entry, other.entry)).reduce((bits, other) => bits | other.bits, 0);
    const available = job.available & ~busy;
    if (bitCount(available) < job.extra || (busy & job.fixed)) return false;
    function choose(bits: number, remaining: number, from: number): boolean {
      if (!remaining) {
        allocated.push({ entry: job.entry, bits: bits | job.fixed });
        const valid = fit(index + 1);
        allocated.pop();
        return valid;
      }
      for (let i = from; i < SEEDING_TABLE_CAPACITY; i++) {
        if ((available & 1 << i) && choose(bits | 1 << i, remaining - 1, i + 1)) return true;
      }
      return false;
    }
    return choose(0, job.extra, 0);
  }
  return fit(0);
}

function bitCount(bits: number): number {
  let count = 0;
  for (; bits; bits &= bits - 1) count++;
  return count;
}

function simulationSeedingOccupancy(rows: SowingPlanRow[], placements: GrowingPlacement[], date: string): GreenhouseSeedingOccupancy {
  const active = simulationSeedingLifecycles(rows, placements).filter((entry) => entry.start <= date && date <= entry.end);
  const tableOccupancy = Array.from({ length: SEEDING_TABLE_CAPACITY }, (_, index) => "A" + (index + 1)).map((table) => {
    const owners = active.filter((entry) => entry.tables.includes(table));
    return { table, planRowIds: owners.map((entry) => entry.planRowId), sectorNames: owners.map((entry) => entry.sectorName) };
  }).filter((entry) => entry.planRowIds.length);
  const usedTables = active.reduce((sum, entry) => sum + (entry.count ?? entry.tables.length), 0);
  return { capacity: SEEDING_TABLE_CAPACITY, usedTables, freeTables: Math.max(0, SEEDING_TABLE_CAPACITY - usedTables),
    incomplete: active.some((entry) => entry.count === undefined || !entry.releaseKnown), overCapacity: usedTables > SEEDING_TABLE_CAPACITY,
    occupiedTableIds: tableOccupancy.map((entry) => entry.table),
    // No concrete free table numbers are claimed for count-only reservations.
    freeTableIds: active.some((entry) => entry.count !== entry.tables.length) ? [] :
      Array.from({ length: SEEDING_TABLE_CAPACITY }, (_, index) => "A" + (index + 1)).filter((table) => !tableOccupancy.some((entry) => entry.table === table)),
    tableOccupancy, conflicts: tableOccupancy.filter((entry) => entry.planRowIds.length > 1),
    unknownRows: active.flatMap((entry) => entry.count === undefined || !entry.releaseKnown ? [{
      planRowId: entry.planRowId, sectorName: entry.sectorName, reason: entry.count === undefined ? "unknownCount" as const : "unknownRelease" as const,
    }] : []),
    rows: active.map((entry) => ({ planRowId: entry.planRowId, sectorName: entry.sectorName, sowingDate: entry.start,
      dateRange: { start: entry.start, end: entry.end }, tables: entry.tables, tableCount: entry.count ?? entry.tables.length })),
  };
}

function simulationReservationsOnDate(reservations: GrowingPlacement[], date: string): GrowingPlacement[] {
  return reservations.flatMap((entry) => {
    if (entry.startDate > date || date >= entry.endDate) return [];
    if (!entry.actualMovements?.length) return [entry];
    const tables = actualGrowingTablesOnDate(entry.actualMovements, date);
    return (["A", "B", "C", "D"] as const).flatMap((rowId) => {
      const count = tables.filter((table) => table.startsWith(rowId)).length;
      return count ? [{ ...entry, primaryRow: rowId, tables: count,
        reservedTables: rowId === "A" ? count : 26, usesExtraBlock: rowId === "A",
        placementKind: rowId === "A" ? "aExtraOnly" as const : "standardRow" as const }] : [];
    });
  });
}

function simulationOptionFits(option: PhysicalPlacementOption, active: GrowingPlacement[]): boolean {
  if (!option.feasible || !option.primaryRow) return false;
  if (active.reduce((sum, entry) => sum + entry.tables, 0) + option.physicalTables > GROWING_TABLE_CAPACITY) return false;
  const sameRow = active.filter((entry) => entry.primaryRow === option.primaryRow);
  const aUsed = active.filter((entry) => entry.primaryRow === "A" || entry.usesExtraBlock)
    .reduce((sum, entry) => sum + (entry.placementKind === "largeWithExtra" ? 13 : entry.tables), 0);
  if (option.primaryRow === "A") return option.physicalTables <= 13 && aUsed + option.physicalTables <= 13;
  if (option.kind === "sharedRow") return sameRow.reduce((sum, entry) => sum + entry.tables, 0) + option.physicalTables <= 26;
  if (sameRow.length) return false;
  return option.physicalTables <= 26 || option.kind === "largeWithExtra" &&
    option.physicalTables <= 39 && aUsed === 0;
}

function simulationGrowingConflict(option: PhysicalPlacementOption, active: GrowingPlacement[], date: string): SimulationNotice {
  const used = active.reduce((sum, entry) => sum + entry.tables, 0);
  if (used + option.physicalTables > GROWING_TABLE_CAPACITY) return {
    lv: date + ": augšanas vietā aizņemti " + used + " galdi; kopā ar vēl " + option.physicalTables + " galdiem pārsniegta " + GROWING_TABLE_CAPACITY + " galdu kapacitāte (" + active.map((entry) => entry.sectorName).join(", ") + ").",
    en: date + ": " + used + " growing tables are occupied; adding " + option.physicalTables + " exceeds the " + GROWING_TABLE_CAPACITY + "-table capacity (" + active.map((entry) => entry.sectorName).join(", ") + ").",
  };
  const sameRow = active.filter((entry) => entry.primaryRow === option.primaryRow);
  const extra = active.filter((entry) => entry.primaryRow === "A" || entry.usesExtraBlock);
  const extraConflict = option.usesExtraBlock && extra.length && (option.primaryRow === "A" || !sameRow.length);
  const owners = extraConflict ? extra : sameRow;
  const row = extraConflict ? "A14–A26" : option.primaryRow;
  const names = [...new Set(owners.map((entry) => entry.sectorName))].join(", ");
  return {
    lv: date + ": " + row + " rinda nepieciešama " + names + "; vēl " + option.physicalTables + " galdiem nepietiek vietas.",
    en: date + ": " + row + " row is required by " + names + "; there is not enough room for another " + option.physicalTables + " tables.",
  };
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
    Number(left.status !== "can") - Number(right.status !== "can") ||
    tierScore(left.tier) - tierScore(right.tier) ||
    left.workload.overload - right.workload.overload ||
    Number(right.avoidsDay9Overload) - Number(left.avoidsDay9Overload) ||
    right.upcomingSowingCount - left.upcomingSowingCount ||
    left.workload.projectedLoad - right.workload.projectedLoad ||
    left.workload.sowingCount - right.workload.sowingCount ||
    left.workload.thinningCount - right.workload.thinningCount ||
    left.workload.plantingCount - right.workload.plantingCount ||
    left.score - right.score ||
    left.workload.weekdayScore - right.workload.weekdayScore ||
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
  const signature = (candidate: GreenhouseSimulationAlternative) => JSON.stringify([
    candidate.tier, candidate.status, candidate.cycleDay === 11, candidate.placementKind,
    candidate.densityClass, candidate.physicalTables < candidate.normalTables,
    candidate.workload.projectedLoad, candidate.workload.sowingCount,
    candidate.workload.thinningCount, candidate.workload.plantingCount,
    candidate.sharedWith.map((entry) => entry.planRowId).sort(), candidate.explanation,
    candidate.notices.map((entry) => entry.lv).filter((text) => text.includes("Moving") || text.includes("Planting")),
  ]);
  return alternatives.findIndex((candidate) => signature(candidate) === signature(alternative)) === index;
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



function simulationExplanation(status: GreenhouseOccupancyStatus): string {
  if (status === "can") {
    return "Var: pārbaudītajos datos nav atrasts sēšanas vai augšanas galdu konflikts.";
  }

  if (status === "conditional") {
    return "Var ar nosacījumiem: plāns ir iespējams, bet ir jāpārskata norādītās izmaiņas vai brīdinājumi.";
  }

  if (status === "insufficientData") {
    return "Nepietiek datu: būtisks nosacījums nav pārbaudāms; precīzs iemesls norādīts detalizētajā pārbaudē.";
  }

  return "Nevar: ir neatrisināts kapacitātes vai termiņa konflikts.";
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

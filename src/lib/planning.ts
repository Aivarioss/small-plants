import type {
  AvailabilityStatus,
  BoxPlan,
  CapacityConflict,
  GreenhouseRow,
  GreenhouseRowId,
  GreenhouseSnapshot,
  PlannerConfig,
  PlacementPlan,
  SectorType,
  SowingPlan,
  SowingPlanRow,
  ThinningPlan,
  WorkItem,
  WorksheetDay,
  WorkloadBalanceProposal,
  WorkScheduleKind,
  WorkType,
} from "./types";
import { scheduleProductionWork, type ScheduledWorkItem } from "./scheduler";

const FULL_TABLE_PLANTS = 16 * 92;
const GUTTERS_PER_TABLE = 6;
const TARGET_MIN = 23;
const TARGET_MAX = 28;
const TARGET_IDEAL = 25;
const BOX_SIZE = 12;
const DAILY_WORKLOAD_TARGET = 1;

type ScheduledWorkEntry = {
  date: string;
  planRowId: string;
  type: WorkType;
  workload: number;
};

type WorkloadMetrics = {
  overloadDays: number;
  totalOverload: number;
  maxDailyWorkload: number;
};

export const greenhouseRows: GreenhouseRow[] = [
  { id: "A", label: "Rinda A", capacity: 26, standard: true },
  { id: "B", label: "Rinda B", capacity: 26, standard: true },
  { id: "C", label: "Rinda C", capacity: 26, standard: true },
  { id: "D", label: "Papildu D", capacity: 13, standard: false },
];

export const workTypeMeta: Record<WorkType, { title: string; color: string }> = {
  sowing: { title: "Sēšana", color: "mint" },
  thinning: { title: "Retināšana", color: "teal" },
  previcure: { title: "Previcure", color: "amber" },
  sideShoots: { title: "Pazares", color: "amber" },
  sticks: { title: "Kociņi", color: "violet" },
  rings: { title: "Gredzeni", color: "blue" },
  harvest: { title: "Izvākšana", color: "green" },
};

export function addDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00`);
  value.setDate(value.getDate() + days);
  return toIsoDate(value);
}

export function toIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function dateLabel(date: string): string {
  return new Intl.DateTimeFormat("lv-LV", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(`${date}T12:00:00`));
}

export function daysBetween(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T12:00:00`).getTime();
  const end = new Date(`${endDate}T12:00:00`).getTime();
  return Math.round((end - start) / 86_400_000) + 1;
}

export function cycleDayDate(row: Pick<SowingPlanRow, "sowingDate">, cycleDay: number): string {
  return addDays(row.sowingDate, cycleDay - 1);
}

export function getCycleDay(row: Pick<SowingPlanRow, "sowingDate">, date: string): number {
  return daysBetween(row.sowingDate, date);
}

export function eachDate(startDate: string, endDate: string): string[] {
  const length = daysBetween(startDate, endDate);
  return Array.from({ length }, (_, index) => addDays(startDate, index));
}

export function getTotalSow(row: Pick<SowingPlanRow, "requiredPlants" | "extraPlants">): number {
  return Math.max(0, row.requiredPlants + row.extraPlants);
}

export function calculateSowingPlan(plantCount: number): SowingPlan {
  const fullTables = Math.floor(plantCount / FULL_TABLE_PLANTS);
  const remainder = plantCount % FULL_TABLE_PLANTS;
  const partialRows = remainder > 0 ? Math.ceil(remainder / 16) : 0;
  const partialRowsWithReserve = partialRows > 0 ? Math.min(partialRows + 5, 92) : 0;
  const hasPartialTable = partialRowsWithReserve > 0;
  const fullPart = fullTables === 1 ? "1 pilns galds" : `${fullTables} pilni galdi`;
  const partialPart = hasPartialTable ? ` + nepilns galds 16x${partialRowsWithReserve}` : "";

  return {
    fullTables,
    partialRows,
    partialRowsWithReserve,
    hasPartialTable,
    label: `${fullPart}${partialPart}`,
  };
}

export function calculateThinningPlan(plantCount: number, sectorType: SectorType): ThinningPlan {
  const candidates = Array.from({ length: sectorType }, (_, index) => {
    const tables = index + 1;
    const gutterCount = tables * GUTTERS_PER_TABLE;
    const average = plantCount / gutterCount;
    const min = Math.floor(average);
    const max = Math.ceil(average);
    const withinTargetRange = min >= TARGET_MIN && max <= TARGET_MAX;

    return {
      tables,
      rowsPerTable: GUTTERS_PER_TABLE,
      plantsPerGutterMin: min,
      plantsPerGutterMax: max,
      averagePlantsPerGutter: average,
      withinTargetRange,
      label: formatThinningLabel(tables, min, max),
    };
  });

  const preferred = candidates
    .filter((candidate) => candidate.withinTargetRange)
    .sort(
      (a, b) =>
        Math.abs(a.averagePlantsPerGutter - TARGET_IDEAL) -
          Math.abs(b.averagePlantsPerGutter - TARGET_IDEAL) ||
        a.tables - b.tables,
    )[0];

  return (
    preferred ??
    candidates.sort(
      (a, b) =>
        Math.abs(a.averagePlantsPerGutter - TARGET_IDEAL) -
          Math.abs(b.averagePlantsPerGutter - TARGET_IDEAL) ||
        b.tables - a.tables,
    )[0]
  );
}

export function calculateRecommendedTables(plantCount: number): number {
  if (plantCount <= 26 * GUTTERS_PER_TABLE * TARGET_MAX) {
    return Math.min(26, Math.max(1, Math.round(plantCount / (GUTTERS_PER_TABLE * TARGET_IDEAL))));
  }

  return Math.min(39, Math.max(27, Math.ceil(plantCount / (GUTTERS_PER_TABLE * TARGET_MAX))));
}

function formatThinningLabel(tables: number, min: number, max: number): string {
  const plants = min === max ? `${min}` : `${min}/${max}`;
  return `${tables} galdi - ${plants} stādi renē`;
}

export function calculateBoxesNeeded(plantCount: number, plantsPerBox: number): number {
  return Math.ceil(plantCount / plantsPerBox);
}

export function calculateBoxPlan(row: SowingPlanRow): BoxPlan {
  const planned = getTotalSow(row);
  const plants = row.correction === 0 ? planned : Math.max(0, planned + row.correction);
  const totalBoxes = Math.ceil(plants / BOX_SIZE);
  const lastBoxPlants = plants % BOX_SIZE;

  if (lastBoxPlants === 0) {
    return {
      totalBoxes,
      fullBoxes: totalBoxes,
      lastBoxPlants: BOX_SIZE,
      label: `${totalBoxes} pilnas kastītes`,
    };
  }

  return {
    totalBoxes,
    fullBoxes: totalBoxes - 1,
    lastBoxPlants,
    label: `${totalBoxes - 1} pilnas kastītes + 1 nepilna kastīte ar ${lastBoxPlants} stādiem`,
  };
}

export function calculateAvailability(row: SowingPlanRow): AvailabilityStatus {
  const availablePlants = getTotalSow(row) + row.correction;
  const difference = availablePlants - row.requiredPlants;

  if (difference >= 0) {
    return {
      availablePlants,
      difference,
      label: `🟢 +${difference} extra`,
      tone: "ok",
    };
  }

  return {
    availablePlants,
    difference,
    label: `🔴 Trūkst ${Math.abs(difference)}`,
    tone: "short",
  };
}

export function isAllowedMove(row: SowingPlanRow, type: WorkType, date: string): boolean {
  const cycleDay = getCycleDay(row, date);
  const ringsDate = addDays(row.harvestDate, -1);

  if (type === "thinning") {
    return cycleDay >= 8 && cycleDay <= 10;
  }

  if (type === "sideShoots") {
    return cycleDay >= 17 && date < ringsDate;
  }

  if (type === "sticks") {
    return cycleDay >= Math.max(17, row.cycleLength - 5) && date < ringsDate;
  }

  return false;
}

export function hasManualWorkMoves(row: SowingPlanRow): boolean {
  return Object.keys(row.adjustments ?? {}).length > 0;
}

export function getThinningDate(row: SowingPlanRow): string {
  return firstAdjustmentDate(row.adjustments?.thinning) ?? cycleDayDate(row, 9);
}

export function isPlacementActive(row: SowingPlanRow, date: string): boolean {
  const thinningDate = getThinningDate(row);
  return date >= thinningDate && date < row.harvestDate;
}

export function createPlacementPlan(
  row: SowingPlanRow,
  rows: SowingPlanRow[] = [row],
): PlacementPlan {
  const totalSow = getTotalSow(row);
  const tables = row.placement?.tables ?? calculateRecommendedTables(totalSow);
  const primaryRow = row.placement?.primaryRow ?? findAvailablePrimaryRow(row, rows, tables);
  const standardTables = Math.min(tables, 26);
  const extraTables = Math.max(0, tables - 26);
  const gutters = tables * GUTTERS_PER_TABLE;
  const averagePlantsPerGutter = totalSow / gutters;
  const thinningDate = getThinningDate(row);
  const conflict = getCapacityConflict(rows, thinningDate, row.id, tables);
  const denseWarning =
    averagePlantsPerGutter > 32
      ? "Ļoti blīvs izvietojums - pārbaudi, vai galdu skaits nav par mazu."
      : averagePlantsPerGutter > 28
        ? "Blīvāks izvietojums nekā ideālais diapazons, bet praksē var būt pieņemams."
        : undefined;
  const conflictWarning = conflict?.deficit && conflict.deficit > 0
    ? `Kapacitātes konflikts: trūkst ${conflict.deficit} galdi.`
    : undefined;

  return {
    planRowId: row.id,
    sectorName: row.sectorName,
    thinningDate,
    harvestDate: row.harvestDate,
    primaryRow,
    usesExtraRow: extraTables > 0,
    tables,
    standardTables,
    extraTables,
    gutters,
    averagePlantsPerGutter,
    label: `${primaryRow ? `Rinda ${primaryRow}` : "Nav brīvas rindas"} — ${tables} galdi — ${averagePlantsPerGutter.toFixed(1)} stādi/renē`,
    warning: conflictWarning ?? denseWarning,
    conflict,
  };
}

export function buildGreenhouseSnapshot(rows: SowingPlanRow[], date: string): GreenhouseSnapshot {
  const activeRows = rows.filter((row) => isPlacementActive(row, date));
  const placements = activeRows.map((row) => createPlacementPlan(row, rows));
  const rowSnapshots = greenhouseRows.map((greenhouseRow) => {
    const assignment = placements.find((placement) =>
      greenhouseRow.id === "D" ? placement.extraTables > 0 : placement.primaryRow === greenhouseRow.id,
    );
    const usedTables = assignment
      ? greenhouseRow.id === "D"
        ? assignment.extraTables
        : assignment.standardTables
      : 0;

    return {
      rowId: greenhouseRow.id,
      label: greenhouseRow.label,
      capacity: greenhouseRow.capacity,
      usedTables,
      assignment,
    };
  });

  return {
    date,
    rows: rowSnapshots,
    standardUsed: rowSnapshots
      .filter((row) => row.rowId !== "D")
      .reduce((sum, row) => sum + row.usedTables, 0),
    extraUsed: rowSnapshots.find((row) => row.rowId === "D")?.usedTables ?? 0,
    conflicts: getAllCapacityConflicts(rows, date),
  };
}

export function getAllCapacityConflicts(rows: SowingPlanRow[], date: string): CapacityConflict[] {
  const activeRows = rows.filter((row) => isPlacementActive(row, date));
  const totalTables = activeRows.reduce((sum, row) => {
    return sum + (row.placement?.tables ?? calculateRecommendedTables(getTotalSow(row)));
  }, 0);

  if (activeRows.length <= 3 && totalTables <= 78) {
    return [];
  }

  const deficit = Math.max(0, totalTables - 91);
  return [
    {
      date,
      overlapping: activeRows.map((row) => ({
        planRowId: row.id,
        sectorName: row.sectorName,
        tables: row.placement?.tables ?? calculateRecommendedTables(getTotalSow(row)),
      })),
      totalTables,
      standardCapacity: 78,
      totalCapacity: 91,
      extraCanCover: totalTables <= 91,
      deficit,
    },
  ];
}

function getCapacityConflict(
  rows: SowingPlanRow[],
  date: string,
  planRowId: string,
  plannedTables: number,
): CapacityConflict | undefined {
  const active = rows.filter((row) => row.id !== planRowId && isPlacementActive(row, date));
  const totalTables = active.reduce(
    (sum, row) => sum + (row.placement?.tables ?? calculateRecommendedTables(getTotalSow(row))),
    plannedTables,
  );
  const needsFourthStandardRow = active.length >= 3 && plannedTables <= 26;

  if (!needsFourthStandardRow && totalTables <= 78) {
    return undefined;
  }

  return {
    date,
    overlapping: [
      ...active.map((row) => ({
        planRowId: row.id,
        sectorName: row.sectorName,
        tables: row.placement?.tables ?? calculateRecommendedTables(getTotalSow(row)),
      })),
      {
        planRowId,
        sectorName: rows.find((row) => row.id === planRowId)?.sectorName ?? "Jauna partija",
        tables: plannedTables,
      },
    ],
    totalTables,
    standardCapacity: 78,
    totalCapacity: 91,
    extraCanCover: totalTables <= 91,
    deficit: Math.max(0, totalTables - 91),
  };
}

function findAvailablePrimaryRow(
  row: SowingPlanRow,
  rows: SowingPlanRow[],
  tables: number,
): GreenhouseRowId | undefined {
  if (row.placement?.primaryRow) {
    return row.placement.primaryRow;
  }

  const thinningDate = getThinningDate(row);
  const occupied = new Set(
    rows
      .filter((candidate) => candidate.id !== row.id && isPlacementActive(candidate, thinningDate))
      .map((candidate) => candidate.placement?.primaryRow)
      .filter(Boolean),
  );
  const preferredRows: GreenhouseRowId[] = ["A", "B", "C"];
  const available = preferredRows.find((rowId) => !occupied.has(rowId));

  if (available) {
    return available;
  }

  return tables <= 13 ? "D" : undefined;
}

export function generateWorkItems(row: SowingPlanRow, config: PlannerConfig): WorkItem[] {
  return generateWorkItemsForRows([row], config);
}

export function generateWorkItemsForRows(rows: SowingPlanRow[], config: PlannerConfig): WorkItem[] {
  void config;

  return scheduleProductionWork(rows).items.map((scheduled) => workItemFromSchedule(scheduled, rows));
}

function workItemFromSchedule(scheduled: ScheduledWorkItem, rows: SowingPlanRow[]): WorkItem {
  const row = rows.find((candidate) => candidate.id === scheduled.planRowId);

  if (!row) {
    throw new Error(`Missing plan row for scheduled work ${scheduled.planRowId}`);
  }

  const totalSow = getTotalSow(row);
  const details: string[] = [];
  let placement: PlacementPlan | undefined;
  let capacityWarning: string | undefined;

  if (scheduled.type === "sowing") {
    const sowing = calculateSowingPlan(totalSow);
    details.push(sowing.label, `${totalSow.toLocaleString("lv-LV")} stādi kopā sēt`, `Šķirne: ${row.variety}`);
  }

  if (scheduled.type === "thinning") {
    const thinning = calculateThinningPlan(totalSow, row.sectorType);
    placement = createPlacementPlan(row, rows);
    capacityWarning = placement.warning;
    details.push(
      thinning.label,
      `${placement.primaryRow ? `Rinda ${placement.primaryRow}` : "Nav brīvas rindas"} — ${placement.tables} galdi`,
      `Atļauts pārcelt tikai ${dateLabel(cycleDayDate(row, 8))} - ${dateLabel(cycleDayDate(row, 10))}`,
    );
  }

  if (scheduled.type === "previcure") {
    details.push("Aizpildīt uz papīra, ja vajadzīgas devas vai piezīmes");
  }

  if (scheduled.type === "sideShoots") {
    details.push("Ne agrāk par 17. cikla dienu", `Slodze: ${formatWorkload(scheduled.workloadWeight)}`);
  }

  if (scheduled.type === "sticks") {
    details.push("Elastīgs darbs cikla beigu daļā", `Slodze: ${formatWorkload(scheduled.workloadWeight)}`);
  }

  if (scheduled.type === "rings") {
    details.push("Automātiski vienu dienu pirms izvākšanas");
  }

  if (scheduled.type === "harvest") {
    const boxPlan = calculateBoxPlan(row);
    details.push(`${boxPlan.totalBoxes} kastītes pa 12 stādiem`, boxPlan.label);
  }

  const warnings = scheduled.warnings ?? [];

  return {
    ...item(
      row,
      scheduled.type,
      scheduled.date,
      scheduled.cycleDay,
      scheduled.fixed,
      scheduled.scheduleKind,
      scheduled.workloadWeight,
      [...details, ...warnings],
      scheduled.allowedDateRange,
    ),
    placement,
    capacityWarning,
    portion: scheduled.portion,
    source: scheduled.source,
    locked: scheduled.locked,
    warnings,
  };
}

export function generateLegacyWorkItems(row: SowingPlanRow, config: PlannerConfig): WorkItem[] {
  void config;
  const totalSow = getTotalSow(row);
  const sowing = calculateSowingPlan(totalSow);
  const thinning = calculateThinningPlan(totalSow, row.sectorType);
  const boxPlan = calculateBoxPlan(row);
  const placement = createPlacementPlan(row);

  const thinningDefault = getThinningDate(row);
  const sideShootsDefault = cycleDayDate(row, 17);
  const sticksDefault = cycleDayDate(row, Math.max(18, row.cycleLength - 3));
  const ringsDate = addDays(row.harvestDate, -1);

  const thinningDate = firstAdjustmentDate(row.adjustments?.thinning) ?? thinningDefault;
  const sideShootsDates = adjustmentDates(row.adjustments?.sideShoots, sideShootsDefault);
  const sticksDates = adjustmentDates(row.adjustments?.sticks, sticksDefault);

  const items = [
    item(row, "sowing", row.sowingDate, 1, true, "fixed", 0, [
      sowing.label,
      `${totalSow.toLocaleString("lv-LV")} stādi kopā sēt`,
      `Šķirne: ${row.variety}`,
    ]),
    item(row, "thinning", thinningDate, getCycleDay(row, thinningDate), false, "window", 1, [
      thinning.label,
      `${placement.primaryRow ? `Rinda ${placement.primaryRow}` : "Nav brīvas rindas"} — ${placement.tables} galdi`,
      `Atļauts pārcelt tikai ${dateLabel(cycleDayDate(row, 8))} - ${dateLabel(cycleDayDate(row, 10))}`,
    ], {
      start: cycleDayDate(row, 8),
      end: cycleDayDate(row, 10),
    }),
    ...(row.previcureDate
      ? [
          item(row, "previcure", row.previcureDate, getCycleDay(row, row.previcureDate), true, "fixed", 1, [
            "Aizpildīt uz papīra, ja vajadzīgas devas vai piezīmes",
          ]),
        ]
      : []),
    ...sideShootsDates.map((date) =>
      item(row, "sideShoots", date, getCycleDay(row, date), false, "flexible", workloadPerFlexibleDate("sideShoots", sideShootsDates), [
        "Ne agrāk par 17. cikla dienu",
        `Slodze: ${formatWorkload(workloadPerFlexibleDate("sideShoots", sideShootsDates))}`,
      ], {
        start: cycleDayDate(row, 17),
        end: addDays(ringsDate, -1),
      }),
    ),
    ...sticksDates.map((date) =>
      item(row, "sticks", date, getCycleDay(row, date), false, "flexible", workloadPerFlexibleDate("sticks", sticksDates), [
        "Elastīgs darbs cikla beigu daļā",
        `Slodze: ${formatWorkload(workloadPerFlexibleDate("sticks", sticksDates))}`,
      ], {
        start: cycleDayDate(row, Math.max(17, row.cycleLength - 5)),
        end: addDays(ringsDate, -1),
      }),
    ),
    item(row, "rings", ringsDate, getCycleDay(row, ringsDate), true, "fixed", 1, [
      "Automātiski vienu dienu pirms izvākšanas",
    ]),
    item(row, "harvest", row.harvestDate, getCycleDay(row, row.harvestDate), true, "fixed", 1, [
      `${boxPlan.totalBoxes} kastītes pa 12 stādiem`,
      boxPlan.label,
    ]),
  ];

  return items.map((workItem) =>
    workItem.type === "thinning"
      ? {
          ...workItem,
          placement,
          capacityWarning: placement.warning,
        }
      : workItem,
  );
}

export function countMainWork(items: WorkItem[], date: string): number {
  return effectiveOperationalLoad(
    items
      .filter((item) => item.date === date)
      .map((item) => ({
        date: item.date,
        planRowId: item.planRowId,
        type: item.type,
        workload: item.workloadWeight,
      })),
  );
}

export function balanceWorkload(rows: SowingPlanRow[], config: PlannerConfig): WorkloadBalanceProposal[] {
  const baselineMetrics = calculateWorkloadMetrics(
    rows.flatMap((row) =>
      generateWorkItems(row, config).map((item) => ({
        date: item.date,
        planRowId: item.planRowId,
        type: item.type,
        workload: item.workloadWeight,
      })),
    ),
  );
  const proposals: WorkloadBalanceProposal[] = [];
  const scheduled: ScheduledWorkEntry[] = [];
  const scheduledThinningDates = new Map<string, string>();

  rows.forEach((row) => {
    const ringsDate = addDays(row.harvestDate, -1);

    scheduled.push(
      { date: row.sowingDate, planRowId: row.id, type: "sowing", workload: 0 },
      { date: ringsDate, planRowId: row.id, type: "rings", workload: 1 },
      { date: row.harvestDate, planRowId: row.id, type: "harvest", workload: 1 },
    );

    if (row.previcureDate) {
      scheduled.push({ date: row.previcureDate, planRowId: row.id, type: "previcure", workload: 1 });
    }

    if (row.adjustments?.thinning) {
      const date = firstAdjustmentDate(row.adjustments.thinning);
      if (date) {
        scheduledThinningDates.set(row.id, date);
        scheduled.push({ date, planRowId: row.id, type: "thinning", workload: 1 });
      }
    }

    addManualFlexibleWork(row, "sideShoots", scheduled);
    addManualFlexibleWork(row, "sticks", scheduled);
  });

  const loadFor = (date: string) =>
    scheduled.filter((item) => item.date === date).reduce((sum, item) => sum + item.workload, 0);
  const entriesForDate = (date: string) => scheduled.filter((item) => item.date === date);

  const reserve = (
    row: SowingPlanRow,
    type: WorkloadBalanceProposal["type"],
    fromDates: string[],
    toDates: string[],
    warning?: string,
  ) => {
    if (toDates.length === 0 && !warning) {
      return;
    }

    const changed = !sameDates(fromDates, toDates);

    if (changed || warning) {
      proposals.push({
        planRowId: row.id,
        sectorName: row.sectorName,
        type,
        title: workTypeMeta[type].title,
        fromDates,
        toDates,
        warning,
      });
    }

    if (!changed) {
      return;
    }

    scheduled.push(
      ...toDates.map((date) => ({
        date,
        planRowId: row.id,
        type,
        workload: workloadForPlannedDate(type, toDates.length),
      })),
    );

    if (type === "thinning") {
      scheduledThinningDates.set(row.id, toDates[0]);
    }
  };

  const jobs = rows.flatMap((row) => deadlineJobsForRow(row));

  jobs
    .sort(
      (a, b) =>
        a.deadline.localeCompare(b.deadline) ||
        b.workload - a.workload ||
        a.earliest.localeCompare(b.earliest),
    )
    .forEach((job) => {
      if (job.type === "thinning") {
        const choice = chooseThinningDate(job, rows, scheduledThinningDates, loadFor, entriesForDate);
        reserve(job.row, job.type, job.fromDates, choice.dates, choice.warning);
        return;
      }

      const choice = chooseFlexibleDates(job, loadFor, entriesForDate);
      reserve(job.row, job.type, job.fromDates, choice.dates, choice.warning);
    });

  const optimizedMetrics = calculateWorkloadMetrics(scheduled);
  const hasWarnings = proposals.some((proposal) => proposal.warning);

  return isNotWorseSchedule(optimizedMetrics, baselineMetrics) || hasWarnings ? proposals : [];
}

export function generateWorksheetDays(row: SowingPlanRow, config: PlannerConfig): WorksheetDay[] {
  const works = generateWorkItems(row, config);

  return Array.from({ length: row.cycleLength }, (_, index) => {
    const day = index + 1;
    const date = cycleDayDate(row, day);
    return {
      day,
      date,
      works: works.filter((work) => work.date === date),
    };
  });
}

export function generateMonthlyWorkPlan(
  rows: SowingPlanRow[],
  config: PlannerConfig,
  monthDate: string,
): WorkItem[] {
  const anchor = new Date(`${monthDate}T12:00:00`);
  const month = anchor.getMonth();
  const year = anchor.getFullYear();

  return generateWorkItemsForRows(rows, config)
    .filter((item) => {
      const date = new Date(`${item.date}T12:00:00`);
      return date.getFullYear() === year && date.getMonth() === month;
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.sectorName.localeCompare(b.sectorName, "lv"));
}

function item(
  row: SowingPlanRow,
  type: WorkType,
  date: string,
  cycleDay: number,
  fixed: boolean,
  scheduleKind: WorkScheduleKind,
  workloadWeight: number,
  details: string[],
  allowedDateRange?: WorkItem["allowedDateRange"],
): WorkItem {
  const meta = workTypeMeta[type];
  const plantCount = getTotalSow(row);

  return {
    id: `${row.id}-${type}-${date}`,
    planRowId: row.id,
    sectorName: row.sectorName,
    variety: row.variety,
    type,
    title: meta.title,
    date,
    cycleDay,
    plantCount,
    fixed,
    scheduleKind,
    workloadWeight,
    color: meta.color,
    details,
    allowedDateRange,
  };
}

type DeadlineJob = {
  row: SowingPlanRow;
  type: WorkloadBalanceProposal["type"];
  earliest: string;
  deadline: string;
  fromDates: string[];
  workload: number;
  splittable: boolean;
};

function deadlineJobsForRow(row: SowingPlanRow): DeadlineJob[] {
  const ringsDate = addDays(row.harvestDate, -1);
  const sideShootsDeadline = addDays(ringsDate, -1);
  const jobs: DeadlineJob[] = [];

  if (!row.adjustments?.thinning) {
    jobs.push({
      row,
      type: "thinning",
      earliest: cycleDayDate(row, 8),
      deadline: cycleDayDate(row, 10),
      fromDates: [cycleDayDate(row, 9)],
      workload: 1,
      splittable: false,
    });
  }

  if (!row.adjustments?.sideShoots) {
    jobs.push({
      row,
      type: "sideShoots",
      earliest: cycleDayDate(row, 17),
      deadline: sideShootsDeadline,
      fromDates: [cycleDayDate(row, 17)],
      workload: 1,
      splittable: true,
    });
  }

  if (!row.adjustments?.sticks) {
    const earliest = cycleDayDate(row, Math.max(17, row.cycleLength - 5));
    jobs.push({
      row,
      type: "sticks",
      earliest,
      deadline: sideShootsDeadline,
      fromDates: [cycleDayDate(row, Math.max(18, row.cycleLength - 3))],
      workload: 0.5,
      splittable: false,
    });
  }

  return jobs.filter((job) => job.earliest <= job.deadline);
}

function chooseThinningDate(
  job: DeadlineJob,
  rows: SowingPlanRow[],
  scheduledThinningDates: Map<string, string>,
  loadFor: (date: string) => number,
  entriesForDate: (date: string) => ScheduledWorkEntry[],
): { dates: string[]; warning?: string } {
  const candidates = eachDate(job.earliest, job.deadline);
  const ranked = candidates
    .map((date) => {
      const rowsWithScheduledThinning = rows.map((row) => {
        const scheduledDate = row.id === job.row.id ? date : scheduledThinningDates.get(row.id);
        return scheduledDate
          ? {
              ...row,
              adjustments: {
                ...row.adjustments,
                thinning: scheduledDate,
              },
            }
          : row;
      });
      const conflict = createPlacementPlan(
        { ...job.row, adjustments: { ...job.row.adjustments, thinning: date } },
        rowsWithScheduledThinning,
      ).conflict;

      return {
        date,
        conflict,
        load: loadFor(date),
        projected: projectedOperationalLoad(entriesForDate(date), job, date),
        isCurrent: job.fromDates.includes(date),
      };
    })
    .sort((a, b) => {
      const aAvailable = a.conflict ? 1 : 0;
      const bAvailable = b.conflict ? 1 : 0;
      return (
        aAvailable - bAvailable ||
        overloadAmount(a.projected) - overloadAmount(b.projected) ||
        a.projected - b.projected ||
        thinningWeekdayPreference(a.date) - thinningWeekdayPreference(b.date) ||
        a.load - b.load ||
        Number(b.isCurrent) - Number(a.isCurrent) ||
        b.date.localeCompare(a.date)
      );
    });
  const best = ranked[0];

  if (!best) {
    return { dates: job.fromDates };
  }

  return {
    dates: [best.date],
    warning: best.conflict
      ? `⚠ ${job.row.sectorName} retināšanai līdz ${dateLabel(job.deadline)} nepietiek brīvu galdu.`
      : undefined,
  };
}

function chooseFlexibleDates(
  job: DeadlineJob,
  loadFor: (date: string) => number,
  entriesForDate: (date: string) => ScheduledWorkEntry[],
): { dates: string[]; warning?: string } {
  const candidates = eachDate(job.earliest, job.deadline);

  if (job.type === "sticks") {
    return chooseSingleFlexibleDay(job, candidates, loadFor, entriesForDate);
  }

  const fullDay = candidates
    .map((date) => ({
      date,
      load: loadFor(date),
      projected: projectedOperationalLoad(entriesForDate(date), job, date),
      isCurrent: job.fromDates.includes(date),
    }))
    .filter((candidate) => candidate.projected <= DAILY_WORKLOAD_TARGET)
    .sort(
      (a, b) =>
        overloadAmount(a.projected) - overloadAmount(b.projected) ||
        a.projected - b.projected ||
        a.load - b.load ||
        flexibleWeekdayPreference(a.date) - flexibleWeekdayPreference(b.date) ||
        Number(b.isCurrent) - Number(a.isCurrent) ||
        b.date.localeCompare(a.date),
    )[0];

  if (fullDay) {
    return { dates: [fullDay.date] };
  }

  if (job.splittable) {
    const split = candidates
      .map((date) => ({
        date,
        load: loadFor(date),
        projected: projectedOperationalLoad(entriesForDate(date), { ...job, workload: 0.5 }, date),
      }))
      .filter((candidate) => candidate.projected <= DAILY_WORKLOAD_TARGET)
      .sort(
        (a, b) =>
          overloadAmount(a.projected) - overloadAmount(b.projected) ||
          a.projected - b.projected ||
          a.load - b.load ||
          flexibleWeekdayPreference(a.date) - flexibleWeekdayPreference(b.date) ||
          b.date.localeCompare(a.date),
      )
      .slice(0, 2)
      .map((candidate) => candidate.date)
      .sort();

    if (split.length === 2) {
      return { dates: split };
    }
  }

  const overloaded = candidates
    .map((date) => ({
      date,
      projected: projectedOperationalLoad(entriesForDate(date), job, date),
    }))
    .sort(
      (a, b) =>
        overloadAmount(a.projected) - overloadAmount(b.projected) ||
        a.projected - b.projected ||
        flexibleWeekdayPreference(a.date) - flexibleWeekdayPreference(b.date) ||
        b.date.localeCompare(a.date),
    )[0];

  return {
    dates: overloaded ? [overloaded.date] : job.fromDates,
    warning: `⚠ ${job.row.sectorName} ${workTypeMeta[job.type].title.toLowerCase()} jāpabeidz līdz ${dateLabel(job.deadline)}, bet pieejamā darba kapacitāte nav pietiekama.`,
  };
}

function chooseSingleFlexibleDay(
  job: DeadlineJob,
  candidates: string[],
  loadFor: (date: string) => number,
  entriesForDate: (date: string) => ScheduledWorkEntry[],
): { dates: string[]; warning?: string } {
  const best = candidates
    .map((date) => ({
      date,
      load: loadFor(date),
      projected: projectedOperationalLoad(entriesForDate(date), job, date),
      isCurrent: job.fromDates.includes(date),
    }))
    .sort((a, b) => {
      const aFits = a.projected <= DAILY_WORKLOAD_TARGET ? 0 : 1;
      const bFits = b.projected <= DAILY_WORKLOAD_TARGET ? 0 : 1;
      return (
        aFits - bFits ||
        overloadAmount(a.projected) - overloadAmount(b.projected) ||
        a.load - b.load ||
        a.projected - b.projected ||
        flexibleWeekdayPreference(a.date) - flexibleWeekdayPreference(b.date) ||
        Number(b.isCurrent) - Number(a.isCurrent) ||
        b.date.localeCompare(a.date)
      );
    })[0];

  if (!best) {
    return { dates: job.fromDates };
  }

  return {
    dates: [best.date],
    warning:
      best.projected > DAILY_WORKLOAD_TARGET
        ? `⚠ ${job.row.sectorName} ${workTypeMeta[job.type].title.toLowerCase()} jāpabeidz līdz ${dateLabel(job.deadline)}, bet pieejamā darba kapacitāte nav pietiekama.`
        : undefined,
  };
}

function addManualFlexibleWork(
  row: SowingPlanRow,
  type: "sideShoots" | "sticks",
  scheduled: ScheduledWorkEntry[],
) {
  const value = row.adjustments?.[type];

  if (!value) {
    return;
  }

  const dates = adjustmentDates(value, firstAdjustmentDate(value) ?? row.sowingDate);
  const workload = workloadPerFlexibleDate(type, dates);
  scheduled.push(...dates.map((date) => ({ date, planRowId: row.id, type, workload })));
}

function workloadPerFlexibleDate(type: "sideShoots" | "sticks", dates: string[]): number {
  const total = type === "sideShoots" ? 1 : 0.5;
  return Number((total / Math.max(1, dates.length)).toFixed(2));
}

function workloadForPlannedDate(type: WorkloadBalanceProposal["type"], datesLength: number): number {
  if (type === "thinning") {
    return 1;
  }

  return workloadPerFlexibleDate(type, Array.from({ length: Math.max(1, datesLength) }, (_, index) => String(index)));
}

function formatWorkload(workload: number): string {
  return workload.toLocaleString("lv-LV", { maximumFractionDigits: 2 });
}

function overloadAmount(workload: number): number {
  return Math.max(0, workload - DAILY_WORKLOAD_TARGET);
}

function projectedOperationalLoad(entries: ScheduledWorkEntry[], job: DeadlineJob, date: string): number {
  return effectiveOperationalLoad([
    ...entries,
    {
      date,
      planRowId: job.row.id,
      type: job.type,
      workload: job.workload,
    },
  ]);
}

function effectiveOperationalLoad(entries: ScheduledWorkEntry[]): number {
  const sowingWorkload = entries
    .filter((entry) => entry.type === "sowing")
    .reduce((sum, entry) => sum + entry.workload, 0);
  const rawWorkload = entries.reduce((sum, entry) => sum + entry.workload, 0);
  const compatibleWorkload = compatibleSharedWorkload(entries);

  return Number(Math.max(0, rawWorkload - sowingWorkload - compatibleWorkload).toFixed(2));
}

function compatibleSharedWorkload(entries: ScheduledWorkEntry[]): number {
  const usedIndexes = new Set<number>();

  return entries.reduce((shared, entry, index) => {
    if (entry.type === "sowing") {
      return shared;
    }

    if (usedIndexes.has(index)) {
      return shared;
    }

    const pairIndex = entries.findIndex(
      (candidate, candidateIndex) =>
        candidateIndex > index &&
        !usedIndexes.has(candidateIndex) &&
        candidate.type !== "sowing" &&
        canShareDay(entry.type, candidate.type),
    );

    if (pairIndex === -1) {
      return shared;
    }

    usedIndexes.add(index);
    usedIndexes.add(pairIndex);
    return shared + Math.min(entry.workload, entries[pairIndex].workload);
  }, 0);
}

function canShareDay(first: WorkType, second: WorkType): boolean {
  const pair = new Set([first, second]);

  return pair.has("rings") && pair.has("thinning");
}

function calculateWorkloadMetrics(entries: ScheduledWorkEntry[]): WorkloadMetrics {
  const entriesByDate = new Map<string, ScheduledWorkEntry[]>();

  entries.forEach((entry) => {
    entriesByDate.set(entry.date, [...(entriesByDate.get(entry.date) ?? []), entry]);
  });

  return Array.from(entriesByDate.values()).reduce<WorkloadMetrics>(
    (metrics, workload) => ({
      overloadDays: metrics.overloadDays + (effectiveOperationalLoad(workload) > DAILY_WORKLOAD_TARGET ? 1 : 0),
      totalOverload: metrics.totalOverload + overloadAmount(effectiveOperationalLoad(workload)),
      maxDailyWorkload: Math.max(metrics.maxDailyWorkload, effectiveOperationalLoad(workload)),
    }),
    { overloadDays: 0, totalOverload: 0, maxDailyWorkload: 0 },
  );
}

function isNotWorseSchedule(next: WorkloadMetrics, previous: WorkloadMetrics): boolean {
  return (
    next.overloadDays < previous.overloadDays ||
    (next.overloadDays === previous.overloadDays && next.totalOverload < previous.totalOverload) ||
    (next.overloadDays === previous.overloadDays &&
      next.totalOverload === previous.totalOverload &&
      next.maxDailyWorkload <= previous.maxDailyWorkload)
  );
}

function weekday(date: string): number {
  return new Date(`${date}T12:00:00`).getDay();
}

function thinningWeekdayPreference(date: string): number {
  const day = weekday(date);

  if (day === 4) {
    return 0;
  }

  if (day === 6) {
    return 1;
  }

  return 2;
}

function flexibleWeekdayPreference(date: string): number {
  const day = weekday(date);

  if (day === 5 || day === 6) {
    return 0;
  }

  if (day === 0 || day === 4) {
    return 1;
  }

  return 2;
}

function adjustmentDates(value: string | string[] | undefined, fallback: string): string[] {
  if (Array.isArray(value)) {
    return value.length > 0 ? value : [fallback];
  }

  return [value ?? fallback];
}

function firstAdjustmentDate(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function sameDates(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((date, index) => date === right[index]);
}

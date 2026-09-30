import type { SowingPlanRow, WorkScheduleKind, WorkSource, WorkType } from "./types";

const DAILY_TARGET = 1;

export type ScheduledWorkItem = {
  id: string;
  planRowId: string;
  sectorName: string;
  type: WorkType;
  date: string;
  cycleDay: number;
  scheduleKind: WorkScheduleKind;
  fixed: boolean;
  workloadWeight: number;
  portion: number;
  source: WorkSource;
  locked: boolean;
  allowedDateRange?: {
    start: string;
    end?: string;
  };
  warnings?: string[];
};

export type ScheduleWarning = {
  planRowId: string;
  sectorName: string;
  type: WorkType;
  code:
    | "invalid_manual_adjustment"
    | "no_valid_window"
    | "deadline_capacity_shortage";
  message: string;
};

export type ScheduleResult = {
  items: ScheduledWorkItem[];
  warnings: ScheduleWarning[];
};

type ScheduledEntry = Pick<ScheduledWorkItem, "date" | "planRowId" | "type" | "workloadWeight">;

type DeadlineJob = {
  row: SowingPlanRow;
  type: "thinning" | "sideShoots" | "sticks";
  earliest: string;
  deadline: string;
  scheduleKind: WorkScheduleKind;
  workload: number;
  splittable: boolean;
  preferredDates: string[];
  source: WorkSource;
  locked: boolean;
};

type Candidate = {
  date: string;
  projectedLoad: number;
  rawLoad: number;
  moveOutCollision: boolean;
  weekdayScore: number;
};

export function scheduleProductionWork(rows: SowingPlanRow[]): ScheduleResult {
  const items: ScheduledWorkItem[] = [];
  const warnings: ScheduleWarning[] = [];
  const scheduled: ScheduledEntry[] = [];
  const jobs: DeadlineJob[] = [];

  const addItem = (item: ScheduledWorkItem) => {
    items.push(item);
    scheduled.push({
      date: item.date,
      planRowId: item.planRowId,
      type: item.type,
      workloadWeight: item.workloadWeight,
    });
  };

  rows.forEach((row) => {
    const ringsDate = addDays(row.harvestDate, -1);

    addItem(workItem(row, "sowing", row.sowingDate, "fixed", true, 0, 0.5, "automatic", true));

    if (row.previcureDate) {
      addItem(workItem(row, "previcure", row.previcureDate, "fixed", true, 1, 1, "manual", true));
    }

    addItem(workItem(row, "rings", ringsDate, "fixed", true, 1, 1, "automatic", true));
    addItem(workItem(row, "harvest", row.harvestDate, "fixed", true, 1, 1, "automatic", true));

    jobs.push(...deadlineJobsForRow(row, warnings));
  });

  jobs
    .sort(
      (left, right) =>
        left.deadline.localeCompare(right.deadline) ||
        right.workload - left.workload ||
        left.earliest.localeCompare(right.earliest),
    )
    .forEach((job) => {
      const chosen = chooseDates(job, scheduled);

      if (chosen.warning) {
        warnings.push({
          planRowId: job.row.id,
          sectorName: job.row.sectorName,
          type: job.type,
          code: "deadline_capacity_shortage",
          message: chosen.warning,
        });
      }

      chosen.dates.forEach((date) => {
        const workload = workloadForDate(job.type, chosen.dates.length);
        addItem(
          workItem(
            job.row,
            job.type,
            date,
            job.scheduleKind,
            false,
            workload,
            workload,
            job.source,
            job.locked,
            { start: job.earliest, end: job.deadline },
            chosen.warning ? [chosen.warning] : undefined,
          ),
        );
      });
    });

  return {
    items: items.sort((left, right) => left.date.localeCompare(right.date) || workTypeOrder(left.type) - workTypeOrder(right.type)),
    warnings,
  };
}

function deadlineJobsForRow(row: SowingPlanRow, warnings: ScheduleWarning[]): DeadlineJob[] {
  const ringsDate = addDays(row.harvestDate, -1);
  const beforeRings = addDays(ringsDate, -1);
  const candidates: DeadlineJob[] = [
    {
      row,
      type: "thinning",
      earliest: cycleDayDate(row, 8),
      deadline: cycleDayDate(row, 10),
      scheduleKind: "window",
      workload: 1,
      splittable: false,
      preferredDates: [cycleDayDate(row, 9)],
      source: "automatic",
      locked: false,
    },
    {
      row,
      type: "sideShoots",
      earliest: cycleDayDate(row, 17),
      deadline: beforeRings,
      scheduleKind: "flexible",
      workload: 1,
      splittable: true,
      preferredDates: [cycleDayDate(row, 17)],
      source: "automatic",
      locked: false,
    },
    {
      row,
      type: "sticks",
      earliest: cycleDayDate(row, Math.max(17, row.cycleLength - 5)),
      deadline: beforeRings,
      scheduleKind: "flexible",
      workload: 0.5,
      splittable: false,
      preferredDates: [cycleDayDate(row, Math.max(18, row.cycleLength - 3))],
      source: "automatic",
      locked: false,
    },
  ];

  return candidates.flatMap((job) => {
    if (job.earliest > job.deadline) {
      warnings.push({
        planRowId: row.id,
        sectorName: row.sectorName,
        type: job.type,
        code: "no_valid_window",
        message: `${row.sectorName} ${job.type} nevar ieplānot: atļautais periods beidzas pirms sākuma.`,
      });
      return [];
    }

    const manualDates = adjustmentDates(row.adjustments?.[job.type]);
    if (!manualDates) {
      return [job];
    }

    const invalid = manualDates.filter((date) => date < job.earliest || date > job.deadline);
    if (invalid.length > 0) {
      warnings.push({
        planRowId: row.id,
        sectorName: row.sectorName,
        type: job.type,
        code: "invalid_manual_adjustment",
        message: `${row.sectorName} ${job.type} manuālais datums ir ārpus atļautā perioda: ${invalid.join(", ")}.`,
      });
      return [job];
    }

    return manualDates.map((date) => ({
      ...job,
      earliest: date,
      deadline: date,
      workload: workloadForDate(job.type, manualDates.length),
      splittable: false,
      preferredDates: [date],
      source: "manual",
      locked: true,
    }));
  });
}

function chooseDates(job: DeadlineJob, scheduled: ScheduledEntry[]): { dates: string[]; warning?: string } {
  const dates = eachDate(job.earliest, job.deadline);

  if (job.type === "sideShoots") {
    const full = bestSingleDate(job, dates, scheduled, 1, true);
    if (full && full.projectedLoad <= DAILY_TARGET) {
      return { dates: [full.date] };
    }

    const split = dates
      .map((date) => candidateFor(job, date, scheduled, 0.5))
      .filter((candidate) => candidate.projectedLoad <= DAILY_TARGET)
      .sort(compareCandidates(job, false))
      .slice(0, 2)
      .map((candidate) => candidate.date)
      .sort();

    if (split.length === 2) {
      return { dates: split };
    }

    if (full) {
      return { dates: [full.date], warning: capacityWarning(job) };
    }

    return { dates: [], warning: capacityWarning(job) };
  }

  const best = bestSingleDate(job, dates, scheduled, job.workload, false);
  if (!best) {
    return { dates: [], warning: capacityWarning(job) };
  }

  return {
    dates: [best.date],
    warning: best.projectedLoad > DAILY_TARGET ? capacityWarning(job) : undefined,
  };
}

function bestSingleDate(
  job: DeadlineJob,
  dates: string[],
  scheduled: ScheduledEntry[],
  workload: number,
  preferWholeDay: boolean,
): Candidate | undefined {
  return dates
    .map((date) => candidateFor(job, date, scheduled, workload))
    .sort(compareCandidates(job, preferWholeDay))[0];
}

function candidateFor(job: DeadlineJob, date: string, scheduled: ScheduledEntry[], workload: number): Candidate {
  const entries = scheduled.filter((entry) => entry.date === date);

  return {
    date,
    projectedLoad: effectiveOperationalLoad([
      ...entries,
      { date, planRowId: job.row.id, type: job.type, workloadWeight: workload },
    ]),
    rawLoad: entries.reduce((sum, entry) => sum + entry.workloadWeight, 0),
    moveOutCollision: entries.some((entry) => entry.type === "harvest"),
    weekdayScore: weekdayPreference(job.type, date),
  };
}

function compareCandidates(job: DeadlineJob, preferWholeDay: boolean) {
  return (left: Candidate, right: Candidate) => {
    const leftFits = left.projectedLoad <= DAILY_TARGET ? 0 : 1;
    const rightFits = right.projectedLoad <= DAILY_TARGET ? 0 : 1;
    const leftMoveOut = left.moveOutCollision ? 1 : 0;
    const rightMoveOut = right.moveOutCollision ? 1 : 0;

    return (
      leftFits - rightFits ||
      leftMoveOut - rightMoveOut ||
      overloadAmount(left.projectedLoad) - overloadAmount(right.projectedLoad) ||
      left.projectedLoad - right.projectedLoad ||
      left.rawLoad - right.rawLoad ||
      left.weekdayScore - right.weekdayScore ||
      Number(!job.preferredDates.includes(left.date)) - Number(!job.preferredDates.includes(right.date)) ||
      (preferWholeDay ? right.date.localeCompare(left.date) : right.date.localeCompare(left.date))
    );
  };
}

export function effectiveOperationalLoad(entries: ScheduledEntry[]): number {
  const rawWorkload = entries.reduce((sum, entry) => sum + entry.workloadWeight, 0);
  const sowingWorkload = entries
    .filter((entry) => entry.type === "sowing")
    .reduce((sum, entry) => sum + entry.workloadWeight, 0);
  const compatibleWorkload = compatibleSharedWorkload(entries);

  return Number(Math.max(0, rawWorkload - sowingWorkload - compatibleWorkload).toFixed(2));
}

function compatibleSharedWorkload(entries: ScheduledEntry[]): number {
  const usedIndexes = new Set<number>();

  return entries.reduce((shared, entry, index) => {
    if (entry.type === "sowing" || usedIndexes.has(index)) {
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
    return shared + Math.min(entry.workloadWeight, entries[pairIndex].workloadWeight);
  }, 0);
}

function canShareDay(first: WorkType, second: WorkType): boolean {
  const pair = new Set([first, second]);

  return pair.has("rings") && pair.has("thinning");
}

function workItem(
  row: SowingPlanRow,
  type: WorkType,
  date: string,
  scheduleKind: WorkScheduleKind,
  fixed: boolean,
  workloadWeight: number,
  portion: number,
  source: WorkSource,
  locked: boolean,
  allowedDateRange?: ScheduledWorkItem["allowedDateRange"],
  warnings?: string[],
): ScheduledWorkItem {
  return {
    id: `${row.id}-${type}-${date}`,
    planRowId: row.id,
    sectorName: row.sectorName,
    type,
    date,
    cycleDay: getCycleDay(row, date),
    scheduleKind,
    fixed,
    workloadWeight,
    portion,
    source,
    locked,
    allowedDateRange,
    warnings,
  };
}

function workloadForDate(type: WorkType, dateCount: number): number {
  if (type === "sideShoots") {
    return Number((1 / Math.max(1, dateCount)).toFixed(2));
  }

  if (type === "sticks") {
    return 0.5;
  }

  return 1;
}

function capacityWarning(job: DeadlineJob): string {
  return `${job.row.sectorName} ${job.type} jāpabeidz līdz ${job.deadline}, bet pieejamā darba kapacitāte nav pietiekama.`;
}

function adjustmentDates(value: string | string[] | undefined): string[] | undefined {
  if (!value) {
    return undefined;
  }

  return Array.isArray(value) ? value : [value];
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00`);
  value.setDate(value.getDate() + days);
  return toIsoDate(value);
}

function toIsoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function daysBetween(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T12:00:00`).getTime();
  const end = new Date(`${endDate}T12:00:00`).getTime();
  return Math.round((end - start) / 86_400_000) + 1;
}

function cycleDayDate(row: Pick<SowingPlanRow, "sowingDate">, cycleDay: number): string {
  return addDays(row.sowingDate, cycleDay - 1);
}

function getCycleDay(row: Pick<SowingPlanRow, "sowingDate">, date: string): number {
  return daysBetween(row.sowingDate, date);
}

function eachDate(startDate: string, endDate: string): string[] {
  return Array.from({ length: daysBetween(startDate, endDate) }, (_, index) => addDays(startDate, index));
}

function weekday(date: string): number {
  return new Date(`${date}T12:00:00`).getDay();
}

function weekdayPreference(type: WorkType, date: string): number {
  const day = weekday(date);

  if (type === "thinning") {
    if (day === 4) {
      return 0;
    }

    if (day === 6) {
      return 1;
    }

    return 2;
  }

  if (type === "sideShoots" || type === "sticks") {
    if (day === 5 || day === 6) {
      return 0;
    }

    if (day === 0 || day === 4) {
      return 1;
    }
  }

  return 2;
}

function overloadAmount(workload: number): number {
  return Math.max(0, workload - DAILY_TARGET);
}

function workTypeOrder(type: WorkType): number {
  return ["sowing", "thinning", "previcure", "sideShoots", "sticks", "rings", "harvest"].indexOf(type);
}

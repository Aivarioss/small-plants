import { parseHusEventMovementRows } from "./planning";
import type { HusEventEntry, HusPhotoEntry, SowingPlanRow } from "./types";

export type StatisticsPeriod = { start?: string; end: string };
export type RootObservation = {
  id: string; rowId: string; hus: string; archived: boolean; date: string;
  kind: "event" | "correction"; location?: string; tables: string[]; note?: string;
  loss?: number; sources: string[]; origin: "known" | "ambiguous" | "unknown";
  photos: HusPhotoEntry[];
};
export type TableRootStatistics = {
  table: string; zone: "seeding" | "growing"; observations: RootObservation[];
  possibleObservations: RootObservation[]; usageCycles: number; affectedCycles: number;
  loss: number; unallocatedLossRecords: number; lastDate?: string;
};
export type GreenhouseRootStatistics = {
  observations: RootObservation[]; tables: TableRootStatistics[];
  observationCount: number; loss: number; unknownLossRecords: number;
  affectedGrowingTables: number; recurringGrowingTables: number;
  unknownLocationRecords: number; rangeLocationRecords: number; uncertainOriginRecords: number; legacyRecords: number;
};

export const seedingStatisticsTables = Array.from({ length: 13 }, (_, i) => `A${i + 1}`);
export const growingStatisticsRows = [
  { row: "B", tables: Array.from({ length: 26 }, (_, i) => `B${i + 1}`) },
  { row: "C", tables: Array.from({ length: 26 }, (_, i) => `C${i + 1}`) },
  { row: "D", tables: Array.from({ length: 26 }, (_, i) => `D${i + 1}`) },
  { row: "A14–A26", tables: Array.from({ length: 13 }, (_, i) => `A${i + 14}`) },
];
const allTables = [...seedingStatisticsTables, ...growingStatisticsRows.flatMap((row) => row.tables)];
const tableSet = new Set(allTables);
const seedSet = new Set(seedingStatisticsTables);
const sorted = (values: Iterable<string>) => [...new Set(values)].sort((a, b) => a.localeCompare(b, "en", { numeric: true }));

/** Strict addresses only: prose and incomplete/invalid ranges never imply a location. */
export function statisticsTableIds(value?: string): string[] {
  const parts = (value ?? "").trim().replace(/\s*[-–—]\s*/g, "-").split(/[,;\s]+/).filter(Boolean);
  if (!parts.length) return [];
  const result: string[] = [];
  for (const part of parts) {
    const match = /^([ABCD])(\d{1,2})(?:-([ABCD])?(\d{1,2}))?$/i.exec(part);
    if (!match) return [];
    const row = match[1].toUpperCase();
    const endRow = (match[3] ?? row).toUpperCase();
    const start = Number(match[2]);
    const end = Number(match[4] ?? match[2]);
    if (row !== endRow || !tableSet.has(`${row}${start}`) || !tableSet.has(`${row}${end}`)) return [];
    for (let n = Math.min(start, end); n <= Math.max(start, end); n++) result.push(`${row}${n}`);
  }
  return sorted(result);
}

type Provenance = { sources: Set<string>; unknown: boolean };
type MovingDay = { date: string; events: HusEventEntry[] };
const unknown = (): Provenance => ({ sources: new Set(), unknown: true });
function merge(values: Provenance[]): Provenance {
  return { sources: new Set(values.flatMap((value) => [...value.sources])), unknown: !values.length || values.some((value) => value.unknown) };
}
function movingDays(events: HusEventEntry[], end: string): MovingDay[] {
  const days = new Map<string, HusEventEntry[]>();
  for (const event of events) {
    if (!["move", "thinning"].includes(event.eventType) || !validStatisticsDate(event.eventDate) || event.eventDate > end) continue;
    days.set(event.eventDate, [...(days.get(event.eventDate) ?? []), event]);
  }
  return [...days].sort(([a], [b]) => a.localeCompare(b)).map(([date, entries]) => ({ date, events: entries }));
}

/** One day's movements read the same preceding state. UUID/entry order is not a work-order timestamp. */
function applyMovingDay(state: Map<string, Provenance>, day: MovingDay): Map<string, Provenance> {
  const removed = new Set<string>();
  const arrivals = new Map<string, Provenance[]>();
  for (const event of day.events) for (const movement of parseHusEventMovementRows(event)) {
    const from = statisticsTableIds(movement.from);
    const destinations = statisticsTableIds(movement.to).filter((table) => !seedSet.has(table));
    if (!destinations.length) continue;
    const provenance = merge(from.map((table) => seedSet.has(table)
      ? { sources: new Set([table]), unknown: false } : state.get(table) ?? unknown()));
    from.filter((table) => !seedSet.has(table)).forEach((table) => removed.add(table));
    for (const table of destinations) arrivals.set(table, [...(arrivals.get(table) ?? []), provenance]);
  }
  const next = new Map(state);
  removed.forEach((table) => next.delete(table));
  for (const [table, values] of arrivals) {
    const existing = next.get(table);
    next.set(table, merge(existing ? [existing, ...values] : values));
  }
  return next;
}

function observationOrigin(tables: string[], days: MovingDay[], date: string): Provenance {
  let state = new Map<string, Provenance>();
  let beforeSameDay: Map<string, Provenance> | undefined;
  for (const day of days) {
    if (day.date > date) break;
    if (day.date === date) beforeSameDay = state;
    state = applyMovingDay(state, day);
  }
  return merge(tables.map((table) => {
    if (seedSet.has(table)) return { sources: new Set([table]), unknown: false };
    const current = state.get(table);
    const before = beforeSameDay?.get(table);
    // A same-day observation may precede or follow Moving. Keep both known possibilities.
    return current && before ? merge([current, before]) : current ?? before ?? unknown();
  }));
}

export function validStatisticsDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

/** Read-only aggregation. Cycle IDs, rather than HUS names, distinguish repeated production batches. */
export function buildGreenhouseRootStatistics(
  activeRows: SowingPlanRow[], archivedRows: SowingPlanRow[], period: StatisticsPeriod,
): GreenhouseRootStatistics {
  if (!validStatisticsDate(period.end) || period.start && (!validStatisticsDate(period.start) || period.start > period.end)) {
    throw new Error("Invalid statistics period.");
  }
  const inPeriod = (date: string) => validStatisticsDate(date) && date <= period.end && (!period.start || date >= period.start);
  const overlaps = (start: string, endInclusive: string) => start <= period.end && (!period.start || endInclusive >= period.start);
  // Active data wins if a restored row is still in the archive response.
  const rows = new Map<string, SowingPlanRow>();
  for (const row of [...activeRows, ...archivedRows]) if (!rows.has(row.id)) rows.set(row.id, row);
  const usage = new Map(allTables.map((id) => [id, new Set<string>()]));
  const observations: RootObservation[] = [];
  for (const row of rows.values()) {
    const snapshot = row.archivedAt ? row.archiveSnapshot : undefined;
    const events = [...new Map((snapshot?.events ?? row.husEvents ?? []).map((event) => [event.id, event])).values()];
    const corrections = [...new Map((snapshot?.plantCorrections ?? row.plantCorrections ?? []).map((entry) => [entry.id, entry])).values()];
    const days = movingDays(events, period.end);
    const sowing = snapshot?.hus.sowingDate ?? row.sowingDate;
    const planting = snapshot?.hus.harvestDate ?? row.harvestDate;
    let state = new Map<string, Provenance>();
    for (let i = 0; i < days.length; i++) {
      const day = days[i];
      const next = applyMovingDay(state, day);
      const nextDate = days[i + 1]?.date ?? period.end;
      // Confirmed use for at least part of Moving day counts, including source tables released that day.
      if (inPeriod(day.date) && day.date < planting) for (const table of state.keys()) usage.get(table)!.add(row.id);
      if (day.date < planting && overlaps(day.date, nextDate < planting ? nextDate : planting)) {
        // Planting frees growing tables on that day: a period beginning there has no carried occupancy.
        if (!period.start || period.start < planting) for (const [table, provenance] of next) {
          usage.get(table)!.add(row.id);
          for (const source of provenance.sources) usage.get(source)!.add(row.id);
        }
      }
      for (const event of day.events) for (const movement of parseHusEventMovementRows(event)) {
        if (!statisticsTableIds(movement.to).some((table) => !seedSet.has(table))) continue;
        if (overlaps(sowing, day.date)) for (const table of statisticsTableIds(movement.from).filter((table) => seedSet.has(table))) usage.get(table)!.add(row.id);
      }
      state = next;
    }
    const linkedCorrections = new Set(events.map((entry) => entry.plantCorrectionId).filter(Boolean));
    for (const event of events) {
      if (event.eventType !== "brownRoots" || !inPeriod(event.eventDate)) continue;
      const correction = corrections.find((entry) => entry.id === event.plantCorrectionId);
      const amount = Number.isFinite(event.plantChange) ? event.plantChange : correction?.amount;
      const tables = statisticsTableIds(event.location);
      const provenance = observationOrigin(tables, days, event.eventDate);
      observations.push({ id: `${row.id}:event:${event.id}`, rowId: row.id,
        hus: snapshot?.hus.sectorName ?? row.sectorName, archived: Boolean(row.archivedAt),
        kind: "event", date: event.eventDate, location: event.location, tables, note: event.note,
        loss: typeof amount === "number" && amount <= 0 ? Math.abs(amount) : undefined,
        sources: sorted(provenance.sources), origin: !provenance.unknown && provenance.sources.size === 1 ? "known"
          : provenance.sources.size ? "ambiguous" : "unknown",
        // Live photo relations are authoritative; snapshots must not resurrect deleted files.
        photos: (row.husPhotos ?? []).filter((photo) => photo.sowingPlanRowId === row.id && photo.husEventId === event.id),
      });
    }
    for (const correction of corrections) {
      if (correction.reason !== "brownRoots" || linkedCorrections.has(correction.id) || !inPeriod(correction.date)) continue;
      observations.push({ id: `${row.id}:correction:${correction.id}`, rowId: row.id,
        hus: snapshot?.hus.sectorName ?? row.sectorName, archived: Boolean(row.archivedAt), kind: "correction",
        date: correction.date, tables: [], note: correction.note,
        loss: correction.amount <= 0 ? Math.abs(correction.amount) : undefined,
        sources: [], origin: "unknown", photos: [] });
    }
  }
  observations.sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id));
  // An addressed observation itself also confirms that the table was used, even without usable Moving.
  for (const observation of observations) {
    for (const table of [...observation.tables, ...observation.sources]) usage.get(table)!.add(observation.rowId);
  }
  const tables: TableRootStatistics[] = allTables.map((table) => {
    const seeding = seedSet.has(table);
    const entries = observations.filter((entry) => seeding
      ? entry.origin === "known" && entry.sources[0] === table : entry.tables.length === 1 && entry.tables[0] === table);
    const possible = observations.filter((entry) => seeding
      ? entry.origin !== "known" && entry.sources.includes(table) : entry.tables.length > 1 && entry.tables.includes(table));
    return { table, zone: seeding ? "seeding" : "growing", observations: entries, possibleObservations: possible,
      usageCycles: usage.get(table)!.size, affectedCycles: new Set(entries.map((entry) => entry.rowId)).size,
      loss: entries.reduce((sum, entry) => sum + (seeding || entry.tables.length === 1 ? entry.loss ?? 0 : 0), 0),
      unallocatedLossRecords: seeding ? 0 : possible.filter((entry) => entry.loss !== undefined).length,
      lastDate: entries[0]?.date };
  });
  return { observations, tables, observationCount: observations.length,
    loss: observations.reduce((sum, entry) => sum + (entry.loss ?? 0), 0),
    unknownLossRecords: observations.filter((entry) => entry.loss === undefined).length,
    affectedGrowingTables: tables.filter((table) => table.zone === "growing" && table.observations.length).length,
    recurringGrowingTables: tables.filter((table) => table.zone === "growing" && table.affectedCycles >= 2).length,
    unknownLocationRecords: observations.filter((entry) => !entry.tables.length).length,
    rangeLocationRecords: observations.filter((entry) => entry.tables.length > 1).length,
    uncertainOriginRecords: observations.filter((entry) => entry.origin !== "known").length,
    legacyRecords: observations.filter((entry) => entry.kind === "correction").length };
}

export function rankedRootTables(tables: TableRootStatistics[], zone: TableRootStatistics["zone"]): TableRootStatistics[] {
  return tables.filter((table) => table.zone === zone && table.observations.length)
    .sort((a, b) => b.affectedCycles - a.affectedCycles || b.observations.length - a.observations.length || a.table.localeCompare(b.table, "en", { numeric: true }));
}

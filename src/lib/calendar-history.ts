import type { SowingPlanRow, WorkItem } from "./types";

/** Display metadata only: archived work must never enter the live scheduler. */
export type CalendarWorkItem = WorkItem & {
  calendarKey: string;
  calendarArchived: boolean;
  calendarReadOnly: boolean;
};

export function buildCalendarHistory(
  activeItems: WorkItem[],
  activeRows: SowingPlanRow[],
  archivedRows: SowingPlanRow[],
  today: string,
): { items: CalendarWorkItem[]; rows: SowingPlanRow[]; missingHistoryRows: SowingPlanRow[] } {
  const rows = activeRows.filter((row) => !row.archivedAt);
  const activeIds = new Set(rows.map((row) => row.id));
  const missingHistoryRows: SowingPlanRow[] = [];
  const items: CalendarWorkItem[] = activeItems
    .filter((item) => activeIds.has(item.planRowId))
    .map((item) => ({
      ...item,
      calendarKey: `active:${item.planRowId}:${item.id}`,
      calendarArchived: false,
      calendarReadOnly: item.date < today,
    }));
  const seenArchives = new Set<string>();

  for (const row of archivedRows) {
    // A restored cycle can briefly remain in the archive response. Never show it twice.
    if (activeIds.has(row.id) || seenArchives.has(row.id)) continue;
    seenArchives.add(row.id);
    const snapshot = row.archiveSnapshot;
    if (!snapshot || snapshot.hus.id !== row.id || !Array.isArray(snapshot.workItems)) {
      missingHistoryRows.push(row);
      continue;
    }
    rows.push({
      ...row,
      ...snapshot.hus,
      archivedAt: row.archivedAt ?? snapshot.archivedAt,
      adjustments: snapshot.workAdjustments,
      adjustmentSources: snapshot.workAdjustmentSources,
      husEvents: snapshot.events,
      placement: snapshot.tablePlacement,
      plantCorrections: snapshot.plantCorrections,
    });
    const ownItems = snapshot.workItems.filter((item) => item.planRowId === row.id);
    if (ownItems.length !== snapshot.workItems.length) missingHistoryRows.push(row);
    for (const item of ownItems) {
      items.push({
        ...item,
        calendarKey: `archive:${row.id}:${item.id}`,
        calendarArchived: true,
        calendarReadOnly: true,
      });
    }
  }

  items.sort((a, b) =>
    a.date.localeCompare(b.date) ||
    a.sectorName.localeCompare(b.sectorName, "lv", { numeric: true }) ||
    a.calendarKey.localeCompare(b.calendarKey),
  );
  return { items, rows, missingHistoryRows };
}

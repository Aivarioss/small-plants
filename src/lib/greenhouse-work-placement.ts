import { buildGreenhouseOccupancyDay } from "./greenhouse-simulation";
import { createPlacementPlan, generateWorkItemsForRows, getThinningDate, getTotalSow } from "./planning";
import type { GreenhouseRowId, PlannerConfig, SowingPlanRow, WorkItem } from "./types";

/** Display adapter for the existing house model; does not schedule or save. */
export function describeHusPlacement(row: SowingPlanRow, rows: SowingPlanRow[], config: PlannerConfig,
  workItems?: WorkItem[]) {
  const movingDate = row.husEvents?.filter((event) => event.eventType === "move" || event.eventType === "thinning")
    .map((event) => event.eventDate).sort().at(-1);
  const date = movingDate ?? (workItems ?? generateWorkItemsForRows(rows, config))
    .find((item) => item.planRowId === row.id && item.type === "thinning")?.date ?? getThinningDate(row);
  const occupancy = buildGreenhouseOccupancyDay(rows, config, date).growing.rows.find((entry) => entry.planRowId === row.id);
  const actual = Boolean(movingDate);
  const rowIds: GreenhouseRowId[] = actual
    ? [...new Set(occupancy?.actualTableIds?.map((table) => table[0] as GreenhouseRowId) ?? [])].sort()
    : occupancy?.primaryRow ? [...(occupancy.usesExtraBlock && occupancy.primaryRow !== "A" ? ["A" as const] : []), occupancy.primaryRow] : [];
  return { date, actual, occupancy, rowIds };
}

export function withHouseThinningPlacement(items: WorkItem[], rows: SowingPlanRow[], config: PlannerConfig): WorkItem[] {
  return items.map((item) => {
    const row = rows.find((candidate) => candidate.id === item.planRowId);
    if (item.type !== "thinning" || !row) return item;
    const { date, actual, occupancy, rowIds } = describeHusPlacement(row, rows, config, items);
    const tables = occupancy?.tables ?? 0;
    const extraTables = actual ? occupancy?.actualTableIds?.filter((table) => table.startsWith("A")).length ?? 0
      : occupancy?.primaryRow === "A" ? tables : Math.max(0, tables - 26);
    const original = createPlacementPlan(row, rows);
    const rowLabel = rowIds.length ? `Rinda ${rowIds.join(", ")}` : actual ? "Vieta nav zināma" : "Nav brīvas rindas";
    const placement = { ...original, primaryRow: occupancy?.primaryRow, rowIds, tables,
      thinningDate: date, gutters: tables * 6, averagePlantsPerGutter: tables ? getTotalSow(row) / (tables * 6) : 0,
      usesExtraRow: rowIds.includes("A"), extraTables, standardTables: tables - extraTables,
      label: `${rowLabel} — ${tables || "—"} galdi`,
      warning: occupancy?.warnings?.join(" ") || (!actual ? original.warning : undefined) };
    return { ...item, placement, capacityWarning: placement.warning,
      details: [...item.details.filter((detail) => !/^(Rinda |Nav brīvas rindas|Vieta nav zināma)/.test(detail.trim())), placement.label] };
  });
}

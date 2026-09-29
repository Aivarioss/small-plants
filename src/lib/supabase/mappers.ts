import { plannerConfig } from "@/lib/demo-data";
import type { ChangeHistoryEntry, SowingPlanRow, WorkAdjustments } from "@/lib/types";
import type {
  ChangeHistoryRecord,
  SowingPlanRowRecord,
  SowingPlanRowWithRelations,
  TablePlacementRecord,
  WorkAdjustmentRecord,
} from "./database";

export function recordToSowingPlanRow(record: SowingPlanRowWithRelations): SowingPlanRow {
  return {
    id: record.id,
    sectorName: record.hus,
    requiredPlants: record.required_plants,
    extraPlants: record.extra_plants,
    variety: record.variety,
    weekNumber: record.week_number ?? undefined,
    sowingDate: record.sowing_date,
    harvestDate: record.move_out_date,
    previcureDate: record.previcure_date ?? undefined,
    cycleLength: record.cycle_length,
    sectorType: record.sector_type,
    plantsPerBox: plannerConfig.defaultPlantsPerBox,
    correction: record.correction,
    status: record.status,
    source: record.source,
    adjustments: recordsToAdjustments(record.work_adjustments ?? []),
    placement: record.table_placements?.[0]
      ? {
          primaryRow: record.table_placements[0].primary_row ?? undefined,
          tables: record.table_placements[0].tables ?? undefined,
          manual: record.table_placements[0].manual,
        }
      : undefined,
    changeHistory: (record.change_history ?? []).map(recordToChangeHistory),
  };
}

export function sowingPlanRowToRecord(row: SowingPlanRow): SowingPlanRowRecord | null {
  if (row.source === "demo") {
    return null;
  }

  return {
    id: row.id,
    hus: row.sectorName,
    required_plants: row.requiredPlants,
    extra_plants: row.extraPlants,
    variety: row.variety,
    week_number: row.weekNumber ?? null,
    sowing_date: row.sowingDate,
    move_out_date: row.harvestDate,
    previcure_date: row.previcureDate ?? null,
    cycle_length: row.cycleLength,
    sector_type: row.sectorType,
    correction: row.correction,
    status: row.status ?? "planned",
    source: row.source === "import" ? "import" : "user",
  };
}

export function rowAdjustmentsToRecords(row: SowingPlanRow, source: WorkAdjustmentRecord["source"]): WorkAdjustmentRecord[] {
  return Object.entries(row.adjustments ?? {}).map(([workType, value]) => ({
    id: crypto.randomUUID(),
    sowing_plan_row_id: row.id,
    work_type: workType as WorkAdjustmentRecord["work_type"],
    dates: Array.isArray(value) ? value : [value],
    source,
    locked: true,
  }));
}

export function rowPlacementToRecord(row: SowingPlanRow): TablePlacementRecord | null {
  if (!row.placement) {
    return null;
  }

  return {
    id: crypto.randomUUID(),
    sowing_plan_row_id: row.id,
    primary_row: row.placement.primaryRow ?? null,
    tables: row.placement.tables ?? null,
    manual: row.placement.manual ?? true,
  };
}

export function rowChangeHistoryToRecords(row: SowingPlanRow): ChangeHistoryRecord[] {
  return (row.changeHistory ?? []).map((entry) => ({
    id: entry.id,
    sowing_plan_row_id: row.id,
    field: entry.field,
    from_value: entry.from,
    to_value: entry.to,
    note: entry.note,
    created_at: entry.timestamp,
  }));
}

function recordsToAdjustments(records: WorkAdjustmentRecord[]): WorkAdjustments | undefined {
  const adjustments = Object.fromEntries(
    records.map((record) => [
      record.work_type,
      record.dates.length === 1 ? record.dates[0] : record.dates,
    ]),
  ) as WorkAdjustments;

  return Object.keys(adjustments).length > 0 ? adjustments : undefined;
}

function recordToChangeHistory(record: ChangeHistoryRecord): ChangeHistoryEntry {
  return {
    id: record.id,
    timestamp: record.created_at,
    field: record.field,
    from: record.from_value,
    to: record.to_value,
    note: record.note,
  };
}

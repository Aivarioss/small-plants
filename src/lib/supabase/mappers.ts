import { plannerConfig } from "@/lib/demo-data";
import type { ArchiveSnapshot, ChangeHistoryEntry, HusEventEntry, HusEventType, PlantCorrectionEntry, SowingPlanRow, WorkAdjustmentSources, WorkAdjustments } from "@/lib/types";
import type {
  ChangeHistoryRecord,
  HusEventRecord,
  PlantCorrectionRecord,
  SowingPlanRowRecord,
  SowingPlanRowWithRelations,
  TablePlacementRecord,
  WorkAdjustmentRecord,
} from "./database";

export function recordToSowingPlanRow(record: SowingPlanRowWithRelations): SowingPlanRow {
  const placement = relationOne(record.table_placements);

  return {
    id: record.id,
    updatedAt: record.updated_at,
    archivedAt: record.archived_at ?? undefined,
    archivedNote: record.archived_note ?? undefined,
    archiveSnapshot: parseArchiveSnapshot(record.archive_snapshot),
    sectorName: record.hus,
    greenhouseRequiredPlants: record.greenhouse_required_plants ?? undefined,
    requiredPlants: record.required_plants,
    extraPlants: record.extra_plants,
    variety: record.variety,
    weekNumber: record.week_number ?? undefined,
    sowingTables: record.sowing_tables ?? undefined,
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
    adjustmentSources: recordsToAdjustmentSources(record.work_adjustments ?? []),
    placement: placement
      ? {
          primaryRow: placement.primary_row ?? undefined,
          tables: placement.tables ?? undefined,
          manual: placement.manual,
        }
      : undefined,
    changeHistory: (record.change_history ?? []).map(recordToChangeHistory),
    plantCorrections: (record.plant_corrections ?? [])
      .map(recordToPlantCorrection)
      .sort((left, right) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id)),
    husEvents: (record.hus_events ?? [])
      .map(recordToHusEvent)
      .sort(
        (left, right) =>
          left.eventDate.localeCompare(right.eventDate) ||
          (left.createdAt ?? "").localeCompare(right.createdAt ?? "") ||
          left.id.localeCompare(right.id),
      ),
  };
}

function relationOne<T>(value: T[] | T | undefined): T | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function sowingPlanRowToRecord(row: SowingPlanRow): SowingPlanRowRecord | null {
  if (row.source === "demo") {
    return null;
  }

  return {
    id: row.id,
    hus: row.sectorName,
    greenhouse_required_plants: row.greenhouseRequiredPlants ?? null,
    required_plants: row.requiredPlants,
    extra_plants: row.extraPlants,
    variety: row.variety,
    week_number: row.weekNumber ?? null,
    sowing_tables: row.sowingTables ?? null,
    sowing_date: row.sowingDate,
    move_out_date: row.harvestDate,
    previcure_date: row.previcureDate ?? null,
    cycle_length: row.cycleLength,
    sector_type: row.sectorType,
    correction: row.correction,
    status: row.status ?? "planned",
    source: row.source === "import" ? "import" : "user",
    archived_at: row.archivedAt ?? null,
    archived_note: row.archivedNote ?? null,
    archive_snapshot: row.archiveSnapshot ?? null,
  };
}

function parseArchiveSnapshot(value: unknown): ArchiveSnapshot | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  return value as ArchiveSnapshot;
}

export function rowAdjustmentsToRecords(row: SowingPlanRow, source: WorkAdjustmentRecord["source"]): WorkAdjustmentRecord[] {
  return Object.entries(row.adjustments ?? {}).map(([workType, value]) => ({
    id: crypto.randomUUID(),
    sowing_plan_row_id: row.id,
    work_type: workType as WorkAdjustmentRecord["work_type"],
    dates: Array.isArray(value) ? value : [value],
    source: row.adjustmentSources?.[workType as keyof WorkAdjustments] ?? source,
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

export function rowPlantCorrectionsToRecords(row: SowingPlanRow): PlantCorrectionRecord[] {
  return (row.plantCorrections ?? []).map((entry) => ({
    id: entry.id,
    sowing_plan_row_id: row.id,
    correction_date: entry.date,
    amount: entry.amount,
    reason: entry.reason,
    note: entry.note ?? null,
  }));
}

export function rowHusEventsToRecords(row: SowingPlanRow): HusEventRecord[] {
  return (row.husEvents ?? []).map((entry) => ({
    id: entry.id,
    sowing_plan_row_id: row.id,
    event_date: entry.eventDate,
    event_type: entry.eventType,
    location: entry.location?.trim() || null,
    destination_location: entry.destinationLocation?.trim() || null,
    plant_change: typeof entry.plantChange === "number" && entry.plantChange !== 0 ? entry.plantChange : null,
    plant_correction_id: entry.plantCorrectionId ?? null,
    note: entry.note?.trim() || null,
    created_at: entry.createdAt,
    updated_at: entry.updatedAt,
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

function recordsToAdjustmentSources(records: WorkAdjustmentRecord[]): WorkAdjustmentSources | undefined {
  const sources = Object.fromEntries(
    records.map((record) => [record.work_type, record.source]),
  ) as WorkAdjustmentSources;

  return Object.keys(sources).length > 0 ? sources : undefined;
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

function recordToPlantCorrection(record: PlantCorrectionRecord): PlantCorrectionEntry {
  return {
    id: record.id,
    date: record.correction_date,
    amount: record.amount,
    reason: record.reason,
    note: record.note ?? undefined,
  };
}

function recordToHusEvent(record: HusEventRecord): HusEventEntry {
  return {
    id: record.id,
    eventDate: record.event_date,
    eventType: record.event_type as HusEventType,
    location: record.location ?? undefined,
    destinationLocation: record.destination_location ?? undefined,
    plantChange: record.plant_change ?? undefined,
    plantCorrectionId: record.plant_correction_id ?? undefined,
    note: record.note ?? undefined,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}

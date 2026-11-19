import { withHouseThinningPlacement } from "./greenhouse-work-placement";
import { calculatePlantBalance, calculateWorkMaterialSummary, generateWorkItemsForRows, generateWorksheetDaysFromWorkItems } from "./planning";
import type { ArchiveSnapshot, PlannerConfig, SowingPlanRow } from "./types";

/** Freeze new archive worksheets from the same placement view as active HUS cards.
 * Existing snapshots are historical records, never a request to recalculate them. */
export function buildArchiveSnapshot(
  row: SowingPlanRow,
  activeRows: SowingPlanRow[],
  config: PlannerConfig,
  archivedAt: string,
  archivedNote?: string,
): ArchiveSnapshot {
  if (row.archivedAt && row.archiveSnapshot) return cloneArchiveValue(row.archiveSnapshot);
  const workItems = withHouseThinningPlacement(generateWorkItemsForRows(activeRows, config), activeRows, config)
    .filter((item) => item.planRowId === row.id);
  const worksheetDays = generateWorksheetDaysFromWorkItems(row, workItems);
  const plantBalance = calculatePlantBalance(row);
  const materials = calculateWorkMaterialSummary(row);
  const thinningPlacement = workItems.find((item) => item.type === "thinning")?.placement;
  if (thinningPlacement) materials.thinning = thinningPlacement.label;

  return {
    version: 1,
    archivedAt,
    archivedNote: archivedNote || undefined,
    hus: {
      id: row.id,
      sectorName: row.sectorName,
      greenhouseRequiredPlants: row.greenhouseRequiredPlants,
      requiredPlants: row.requiredPlants,
      extraPlants: row.extraPlants,
      variety: row.variety,
      weekNumber: row.weekNumber,
      sowingTables: row.sowingTables,
      sowingDate: row.sowingDate,
      harvestDate: row.harvestDate,
      cycleLength: row.cycleLength,
      sectorType: row.sectorType,
      status: row.status,
    },
    workItems: cloneArchiveValue(workItems),
    worksheetDays: cloneArchiveValue(worksheetDays),
    events: cloneArchiveValue(row.husEvents ?? []),
    plantCorrections: cloneArchiveValue(row.plantCorrections ?? []),
    tablePlacement: cloneArchiveValue(row.placement),
    workAdjustments: cloneArchiveValue(row.adjustments),
    workAdjustmentSources: cloneArchiveValue(row.adjustmentSources),
    plantBalance,
    materials,
  };
}

function cloneArchiveValue<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

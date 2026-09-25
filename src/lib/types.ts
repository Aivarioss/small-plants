export type CycleLength = number;
export type SectorType = 26 | 39;

export type WorkType =
  | "sowing"
  | "thinning"
  | "previcure"
  | "sideShoots"
  | "sticks"
  | "rings"
  | "harvest";

export type ViewMode = "month" | "tenDays" | "today";
export type MainView = "sowingPlan" | "calendar" | "hus" | "batches" | "greenhouse" | "batch" | "worksheet" | "monthPlan";
export type GreenhouseRowId = "A" | "B" | "C" | "D";

export type WorkScheduleKind = "fixed" | "window" | "flexible";
export type WorkAdjustmentValue = string | string[];
export type WorkAdjustments = Partial<Record<"thinning" | "sideShoots" | "sticks", WorkAdjustmentValue>>;

export type TablePlacement = {
  primaryRow?: GreenhouseRowId;
  tables?: number;
  manual?: boolean;
};

export type ChangeHistoryEntry = {
  id: string;
  timestamp: string;
  field: string;
  from: string;
  to: string;
  note: string;
};

export type SowingPlanRow = {
  id: string;
  sectorName: string;
  requiredPlants: number;
  extraPlants: number;
  variety: string;
  weekNumber?: number;
  sowingDate: string;
  harvestDate: string;
  previcureDate?: string;
  cycleLength: CycleLength;
  sectorType: SectorType;
  plantsPerBox: number;
  correction: number;
  status?: "planned" | "imported" | "active" | "done";
  changeHistory?: ChangeHistoryEntry[];
  placement?: TablePlacement;
  adjustments?: WorkAdjustments;
  source?: "demo" | "user" | "import";
};

export type WorksheetDay = {
  day: number;
  date: string;
  works: WorkItem[];
};

export type SowingPlanDraft = {
  sectorName: string;
  requiredPlants: string;
  extraPlants: string;
  variety: string;
  sowingDate: string;
  harvestDate: string;
  cycleLength: string;
  sectorType: SectorType;
  plantsPerBox: string;
};

export type ImportFieldKey =
  | "sectorName"
  | "requiredPlants"
  | "variety"
  | "weekNumber"
  | "harvestDate"
  | "sowingDate";

export type ImportField<T> = {
  value: T;
  confidence: number;
  needsReview: boolean;
};

export type PlanImportCandidate = {
  id: string;
  fields: {
    sectorName: ImportField<string>;
    requiredPlants: ImportField<number>;
    variety: ImportField<string>;
    weekNumber: ImportField<number>;
    harvestDate: ImportField<string>;
    sowingDate: ImportField<string>;
  };
  duplicateOf?: string;
  duplicateAction?: "keepExisting" | "replace" | "createNew";
};

export type PlanImportResult = {
  mode: "mock" | "vision";
  fileName: string;
  importedAt: string;
  candidates: PlanImportCandidate[];
};

export type PlannerConfig = {
  defaultPlantsPerBox: number;
};

export type SowingPlan = {
  fullTables: number;
  partialRows: number;
  partialRowsWithReserve: number;
  hasPartialTable: boolean;
  label: string;
};

export type ThinningPlan = {
  tables: number;
  rowsPerTable: number;
  plantsPerGutterMin: number;
  plantsPerGutterMax: number;
  averagePlantsPerGutter: number;
  withinTargetRange: boolean;
  label: string;
};

export type GreenhouseRow = {
  id: GreenhouseRowId;
  label: string;
  capacity: number;
  standard: boolean;
};

export type PlacementPlan = {
  planRowId: string;
  sectorName: string;
  thinningDate: string;
  harvestDate: string;
  primaryRow?: GreenhouseRowId;
  usesExtraRow: boolean;
  tables: number;
  standardTables: number;
  extraTables: number;
  gutters: number;
  averagePlantsPerGutter: number;
  label: string;
  warning?: string;
  conflict?: CapacityConflict;
};

export type CapacityConflict = {
  date: string;
  overlapping: Array<{
    planRowId: string;
    sectorName: string;
    tables: number;
  }>;
  totalTables: number;
  standardCapacity: number;
  totalCapacity: number;
  extraCanCover: boolean;
  deficit: number;
};

export type GreenhouseSnapshot = {
  date: string;
  rows: Array<{
    rowId: GreenhouseRowId;
    label: string;
    capacity: number;
    usedTables: number;
    assignment?: PlacementPlan;
  }>;
  standardUsed: number;
  extraUsed: number;
  conflicts: CapacityConflict[];
};

export type BoxPlan = {
  totalBoxes: number;
  fullBoxes: number;
  lastBoxPlants: number;
  label: string;
};

export type AvailabilityStatus = {
  availablePlants: number;
  difference: number;
  label: string;
  tone: "ok" | "short";
};

export type WorkItem = {
  id: string;
  planRowId: string;
  sectorName: string;
  variety: string;
  type: WorkType;
  title: string;
  date: string;
  cycleDay: number;
  plantCount: number;
  placement?: PlacementPlan;
  capacityWarning?: string;
  fixed: boolean;
  scheduleKind: WorkScheduleKind;
  workloadWeight: number;
  color: string;
  details: string[];
  allowedDateRange?: {
    start: string;
    end?: string;
  };
};

export type WorkloadBalanceProposal = {
  planRowId: string;
  sectorName: string;
  type: "thinning" | "sideShoots" | "sticks";
  title: string;
  fromDates: string[];
  toDates: string[];
  warning?: string;
};

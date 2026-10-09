export type CycleLength = number;
export type SectorType = 26 | 39;

export type WorkType =
  | "sowing"
  | "removeFilm"
  | "addAgrofilm"
  | "removeAgrofilm"
  | "animals"
  | "thinning"
  | "previcur"
  | "disinfectTables"
  | "previcure"
  | "sideShoots"
  | "sticks"
  | "rings"
  | "harvest"
  | "sprayTables";

export type ViewMode = "month" | "tenDays" | "today";
export type MainView = "sowingPlan" | "calendar" | "hus" | "batches" | "greenhouse" | "batch" | "worksheet" | "monthPlan";
export type GreenhouseRowId = "A" | "B" | "C" | "D";

export type WorkScheduleKind = "fixed" | "window" | "flexible";
export type WorkSource = "automatic" | "manual" | "optimizer";
export type WorkAdjustmentValue = string | string[];
export type WorkAdjustments = Partial<Record<"thinning" | "sideShoots" | "sticks", WorkAdjustmentValue>>;
export type WorkAdjustmentSources = Partial<Record<keyof WorkAdjustments, Exclude<WorkSource, "automatic">>>;

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

export type PlantCorrectionReason = "thinning" | "brownRoots" | "damaged" | "other";

export type PlantCorrectionEntry = {
  id: string;
  date: string;
  amount: number;
  reason: PlantCorrectionReason;
  note?: string;
};

export type HusEventType =
  | "thinning"
  | "move"
  | "brownRoots"
  | "watering"
  | "extraWatering"
  | "treatment"
  | "observation"
  | "other";

export type HusEventEntry = {
  id: string;
  eventDate: string;
  eventType: HusEventType;
  location?: string;
  destinationLocation?: string;
  plantChange?: number;
  plantCorrectionId?: string;
  note?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type HusPhotoEntry = {
  id: string;
  sowingPlanRowId: string;
  husEventId?: string;
  husNoteId?: string;
  storageBucket: string;
  storagePath: string;
  originalFileName: string;
  contentType: "image/jpeg" | "image/png";
  fileSizeBytes: number;
  createdAt?: string;
};

export type HusNoteEntry = {
  id: string;
  sowingPlanRowId: string;
  observationDate?: string;
  note?: string;
  author?: string;
  createdAt?: string;
  updatedAt?: string;
  photos?: HusPhotoEntry[];
};

export type ArchiveSnapshot = {
  version: 1;
  archivedAt: string;
  archivedNote?: string;
  hus: {
    id: string;
    sectorName: string;
    greenhouseRequiredPlants?: number;
    requiredPlants: number;
    extraPlants: number;
    variety: string;
    weekNumber?: number;
    sowingTables?: string;
    sowingDate: string;
    harvestDate: string;
    cycleLength: CycleLength;
    sectorType: SectorType;
    status?: SowingPlanRow["status"];
  };
  workItems: WorkItem[];
  worksheetDays: WorksheetDay[];
  events: HusEventEntry[];
  notes?: HusNoteEntry[];
  photos?: HusPhotoEntry[];
  plantCorrections: PlantCorrectionEntry[];
  tablePlacement?: TablePlacement;
  workAdjustments?: WorkAdjustments;
  workAdjustmentSources?: WorkAdjustmentSources;
  plantBalance: {
    requiredPlants: number | null;
    initialPlants: number;
    correctionTotal: number;
    actualPlants: number;
    difference: number | null;
    label: string;
    tone: "ok" | "short" | "unknown";
  };
  materials: {
    sowing: string;
    sowingTables: string;
    thinning: string;
    harvest: string;
  };
};

export type SowingPlanRow = {
  id: string;
  updatedAt?: string;
  archivedAt?: string;
  archivedNote?: string;
  archiveSnapshot?: ArchiveSnapshot;
  sectorName: string;
  greenhouseRequiredPlants?: number;
  requiredPlants: number;
  extraPlants: number;
  variety: string;
  weekNumber?: number;
  sowingTables?: string;
  sowingDate: string;
  harvestDate: string;
  previcureDate?: string;
  cycleLength: CycleLength;
  sectorType: SectorType;
  plantsPerBox: number;
  correction: number;
  status?: "planned" | "imported" | "active" | "done";
  changeHistory?: ChangeHistoryEntry[];
  husNotes?: HusNoteEntry[];
  husPhotos?: HusPhotoEntry[];
  plantCorrections?: PlantCorrectionEntry[];
  husEvents?: HusEventEntry[];
  placement?: TablePlacement;
  adjustments?: WorkAdjustments;
  adjustmentSources?: WorkAdjustmentSources;
  source?: "demo" | "user" | "import";
};

export type WorksheetDay = {
  day: number;
  date: string;
  works: WorkItem[];
};

export type SowingPlanDraft = {
  sectorName: string;
  greenhouseRequiredPlants: string;
  requiredPlants: string;
  extraPlants: string;
  variety: string;
  sowingTables: string;
  sowingDate: string;
  harvestDate: string;
  cycleLength: string;
  cycleMode: "length" | "moveOut";
  sectorType: SectorType;
  plantsPerBox: string;
};

export type ImportFieldKey =
  | "sectorName"
  | "greenhouseRequiredPlants"
  | "requiredPlants"
  | "extraPlants"
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
  selected: boolean;
  warnings: string[];
  fields: {
    sectorName: ImportField<string>;
    greenhouseRequiredPlants: ImportField<number | null>;
    requiredPlants: ImportField<number>;
    extraPlants: ImportField<number>;
    variety: ImportField<string>;
    weekNumber: ImportField<number | null>;
    harvestDate: ImportField<string>;
    sowingDate: ImportField<string>;
  };
  cycleLength: number | null;
  operationalTotal: number;
  duplicateOf?: string;
  duplicateAction?: "keepExisting" | "replace" | "createNew";
};

export type PlanImportResult = {
  mode: "mock" | "vision" | "unconfigured";
  fileName: string;
  importedAt: string;
  provider: string;
  providerConfigured: boolean;
  message?: string;
  candidates: PlanImportCandidate[];
};

export type SowingPlanDocument = {
  id: string;
  originalFileName: string;
  contentType: "image/jpeg" | "image/png" | "application/pdf";
  fileSizeBytes: number;
  storageBucket: string;
  storagePath: string;
  isCurrent: boolean;
  createdAt?: string;
  updatedAt?: string;
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
  difference: number | null;
  label: string;
  tone: "ok" | "short" | "unknown";
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
  portion?: number;
  source?: WorkSource;
  locked?: boolean;
  warnings?: string[];
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

export type SowingPlanRowRecord = {
  id: string;
  hus: string;
  required_plants: number;
  extra_plants: number;
  variety: string;
  week_number: number | null;
  sowing_tables: string | null;
  sowing_date: string;
  move_out_date: string;
  previcure_date: string | null;
  cycle_length: number;
  sector_type: 26 | 39;
  correction: number;
  status: "planned" | "imported" | "active" | "done";
  source: "user" | "import";
  created_at?: string;
  updated_at?: string;
};

export type WorkAdjustmentRecord = {
  id: string;
  sowing_plan_row_id: string;
  work_type: "thinning" | "sideShoots" | "sticks";
  dates: string[];
  source: "manual" | "optimizer";
  locked: boolean;
  created_at?: string;
  updated_at?: string;
};

export type TablePlacementRecord = {
  id: string;
  sowing_plan_row_id: string;
  primary_row: "A" | "B" | "C" | "D" | null;
  tables: number | null;
  manual: boolean;
  created_at?: string;
  updated_at?: string;
};

export type ChangeHistoryRecord = {
  id: string;
  sowing_plan_row_id: string;
  field: string;
  from_value: string;
  to_value: string;
  note: string;
  created_at: string;
};

export type SowingPlanRowWithRelations = SowingPlanRowRecord & {
  work_adjustments?: WorkAdjustmentRecord[];
  table_placements?: TablePlacementRecord[] | TablePlacementRecord;
  change_history?: ChangeHistoryRecord[];
};

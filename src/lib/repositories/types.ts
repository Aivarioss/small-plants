import type { SowingPlanRow } from "@/lib/types";

export type SowingPlanRepository = {
  load: () => SowingPlanRow[];
  save: (rows: SowingPlanRow[]) => void;
};

export type RemoteSowingPlanRepository = {
  load: () => Promise<SowingPlanRow[]>;
  save: (rows: SowingPlanRow[]) => Promise<void>;
};

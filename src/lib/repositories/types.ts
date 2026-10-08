import type { SowingPlanRow } from "@/lib/types";

export type SowingPlanRepository = {
  load: () => Promise<SowingPlanRow[]>;
  create: (row: SowingPlanRow) => Promise<SowingPlanRow>;
  update: (row: SowingPlanRow) => Promise<SowingPlanRow>;
  delete: (row: SowingPlanRow) => Promise<void>;
};

export type RemoteSowingPlanRepository = {
  load: () => Promise<SowingPlanRow[]>;
  loadArchived: () => Promise<SowingPlanRow[]>;
  create: (row: SowingPlanRow) => Promise<SowingPlanRow>;
  update: (row: SowingPlanRow, expectedUpdatedAt?: string) => Promise<SowingPlanRow>;
  delete: (id: string, expectedUpdatedAt?: string) => Promise<void>;
  archive: (id: string, note?: string) => Promise<SowingPlanRow>;
  restore: (id: string) => Promise<SowingPlanRow>;
};

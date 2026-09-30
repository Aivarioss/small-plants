import { loadPlanRowsFromStorage, savePlanRowsToStorage } from "@/lib/storage";
import type { SowingPlanRepository } from "./types";

export const localStorageSowingPlanRepository: SowingPlanRepository = {
  load: async () => loadPlanRowsFromStorage(),
  create: async (row) => {
    const rows = [row, ...loadPlanRowsFromStorage()];
    savePlanRowsToStorage(rows);
    return row;
  },
  update: async (row) => {
    const rows = loadPlanRowsFromStorage().map((candidate) => (candidate.id === row.id ? row : candidate));
    savePlanRowsToStorage(rows);
    return row;
  },
  delete: async (row) => {
    savePlanRowsToStorage(loadPlanRowsFromStorage().filter((candidate) => candidate.id !== row.id));
  },
};

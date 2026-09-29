import { loadPlanRowsFromStorage, savePlanRowsToStorage } from "@/lib/storage";
import type { SowingPlanRepository } from "./types";

export const localStorageSowingPlanRepository: SowingPlanRepository = {
  load: loadPlanRowsFromStorage,
  save: savePlanRowsToStorage,
};

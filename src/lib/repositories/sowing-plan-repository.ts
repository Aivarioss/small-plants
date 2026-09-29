import { localStorageSowingPlanRepository } from "./local-storage-sowing-plan-repository";
import type { SowingPlanRepository } from "./types";

// Transition point: the app keeps localStorage behavior until Supabase sync is enabled explicitly.
export const sowingPlanRepository: SowingPlanRepository = localStorageSowingPlanRepository;

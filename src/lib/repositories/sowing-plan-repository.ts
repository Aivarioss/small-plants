import { apiSowingPlanRepository } from "./api-sowing-plan-repository";
import type { SowingPlanRepository } from "./types";

// Supabase is the active source of truth. localStorage remains only as a manual backup/recovery path.
export const sowingPlanRepository: SowingPlanRepository = apiSowingPlanRepository;

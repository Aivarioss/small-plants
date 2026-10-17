import { addDays, calculateSowingPlan, clearOptimizerWorkAdjustments, eachDate, generateWorkItemsForRows, getTotalSow, parseSowingTableSelection } from "./planning";
import { calculateGreenhouseTablePlacement, evaluateGreenhouseDensity } from "./greenhouse-placement";
import { evaluateThinningWorkload, scheduleProductionWork } from "./scheduler";
import {
  greenhouseSimulationModel as model,
  type GreenhouseOccupancyDay, type GreenhouseOccupancyStatus, type GrowingPlacementKind,
  type SimulationGrowingReservation as Reservation, type SimulationNotice,
  type SimulationPlacementOption as PlacementOption,
} from "./greenhouse-simulation";
import type { GreenhouseRowId, PlannerConfig, SowingPlanRow, WorkItem } from "./types";

export type JointSimulationRequest = {
  rows: SowingPlanRow[];
  config: PlannerConfig;
  /** Required, so past work never depends on the machine's current date. */
  asOfDate: string;
  sowingChanges: Array<{ planRowId: string; sowingDate: string }>;
  /** Actual completions that cannot be inferred from planned adjustments. */
  completedWork?: Array<Pick<WorkItem, "planRowId" | "type" | "date">>;
  lockedPlanRowIds?: string[];
  limits?: Partial<JointSearchLimits>;
};

export type JointSearchLimits = {
  maxNodes: number;
  beamWidth: number;
  maxMutableRows: number;
  maxSowingScenarios: number;
};
export type JointSearchStage = "normal" | "compromise" | "emergency" | "sowingCompromise";
export type JointSimulationConflict = {
  code: "input" | "immutableWork" | "workWindow" | "seedingCapacity" | "growingCapacity" | "missingData" | "searchLimit";
  date: string;
  planRowIds: string[];
  message: SimulationNotice;
};
export type JointPlanChange = {
  planRowId: string;
  field: "sowingDate" | "thinningDate" | "wateringZone" | "growingTables" | "workDates";
  workType?: WorkItem["type"];
  before?: string | number;
  after: string | number;
  requiresApproval: boolean;
  reason: SimulationNotice;
};
export type JointHusProposal = {
  planRowId: string;
  sectorName: string;
  sowingDate: string;
  thinningDate: string;
  plantingDate: string;
  cycleDay: number;
  seedingTableCount: number;
  fixedSeedingTables: string[];
  wateringZone: GreenhouseRowId;
  physicalTables: number;
  normalTables: number;
  placementKind: GrowingPlacementKind;
  densityClass: PlacementOption["densityClass"];
  plantsPerTrough: number;
  sharedWith: string[];
  plantingBeforeThinning: string[];
  workload: ReturnType<typeof evaluateThinningWorkload>;
  notices: SimulationNotice[];
};
export type JointSimulationPlan = {
  status: "can" | "conditional";
  proposals: JointHusProposal[];
  changes: JointPlanChange[];
  notices: SimulationNotice[];
  workItems: WorkItem[];
  occupancy: GreenhouseOccupancyDay[];
  score: {
    sowingCompromises: number;
    densityAndWateringCompromises: number;
    densitySeverity: number;
    compressedTables: number;
    changedThinningDates: number;
    thinningShiftDays: number;
    overloadOnThinningDays: number;
    emergencyDays: number;
    changedRows: number;
  };
};
export type JointSimulationResult = {
  status: GreenhouseOccupancyStatus | "searchLimited";
  plans: JointSimulationPlan[];
  conflicts: JointSimulationConflict[];
  originalRowsUnchanged: boolean;
  search: JointSearchLimits & {
    nodes: number;
    stages: JointSearchStage[];
    sowingScenarios: number;
    truncated: boolean;
    frozenByLimit: string[];
  };
};

type Choice = { row: SowingPlanRow; date: string; option: PlacementOption };
type State = { choices: Choice[]; reservations: Reservation[]; rank?: number[] };
type Context = {
  request: JointSimulationRequest;
  rows: SowingPlanRow[];
  baselineWork: WorkItem[];
  baselineThin: Map<string, string>;
  baselineReservations: Reservation[];
  mutableIds: Set<string>;
  requestedIds: Set<string>;
  end: string;
  result: JointSimulationResult;
};

const defaults: JointSearchLimits = { maxNodes: 12000, beamWidth: 48, maxMutableRows: 8, maxSowingScenarios: 12 };
const hardLimits: JointSearchLimits = { maxNodes: 50000, beamWidth: 128, maxMutableRows: 12, maxSowingScenarios: 24 };
const maxContextRows = 80;
const maxHorizonDays = 90;
const maxReturnedPlans = 3;

/** A bounded search over the existing scheduler's work and physical placement
 * candidates. No persistence, scheduler rules, or actual history are changed. */
export function simulateJointSowingPlan(request: JointSimulationRequest): JointSimulationResult {
  const snapshot = JSON.stringify(request.rows);
  const limits = Object.fromEntries(Object.entries(defaults).map(([key, value]) => {
    const name = key as keyof JointSearchLimits;
    const supplied = request.limits?.[name];
    return [key, Number.isFinite(supplied) ? Math.max(1, Math.min(hardLimits[name], Math.floor(supplied!))) : value];
  })) as JointSearchLimits;
  const result: JointSimulationResult = {
    status: "cannot", plans: [], conflicts: [], originalRowsUnchanged: true,
    search: { ...limits, nodes: 0, stages: [], sowingScenarios: 0, truncated: false, frozenByLimit: [] },
  };
  const fail = (code: JointSimulationConflict["code"], lv: string, en: string, ids: string[] = [], date = request.asOfDate) => {
    result.status = code === "searchLimit" ? "searchLimited" : "insufficientData";
    result.search.truncated ||= code === "searchLimit";
    result.conflicts = [{ code, date, planRowIds: ids, message: { lv, en } }];
    return result;
  };
  if (!validDate(request.asOfDate) || !request.sowingChanges.length) return fail("input",
    "Norādi derīgu simulācijas atskaites datumu un vismaz vienu HUS.", "Supply a valid simulation reference date and at least one HUS.");
  if (new Set(request.rows.map((row) => row.id)).size !== request.rows.length ||
    new Set(request.sowingChanges.map((change) => change.planRowId)).size !== request.sowingChanges.length) return fail("input",
    "HUS identifikatori un sēšanas izmaiņu HUS nedrīkst atkārtoties.", "HUS identifiers and sowing-change targets must be unique.");
  if (request.rows.some((row) => !validDate(row.sowingDate) || !validDate(row.harvestDate) ||
    row.harvestDate <= row.sowingDate || dateDistance(row.sowingDate, row.harvestDate) > maxHorizonDays)) return fail("input",
    "HUS datumus nevar droši pārbaudīt; katram ciklam jābūt derīgam un ne garākam par 90 dienām.",
    "HUS dates cannot be safely checked; every cycle must be valid and no longer than 90 days.");
  const locked = new Set(request.lockedPlanRowIds ?? []);
  const requestedIds = new Set(request.sowingChanges.map((change) => change.planRowId));
  for (const change of request.sowingChanges) {
    const row = request.rows.find((entry) => entry.id === change.planRowId);
    if (!row || row.archivedAt || row.harvestDate <= request.asOfDate || !validDate(change.sowingDate) || change.sowingDate >= row.harvestDate ||
      dateDistance(change.sowingDate, row.harvestDate) > maxHorizonDays) return fail("input",
      "Sēšanas izmaiņai nav atrasts derīgs aktīvs HUS vai datumu periods.", "A sowing change has no valid active HUS or date interval.", [change.planRowId]);
    if (change.sowingDate !== row.sowingDate && (locked.has(row.id) || row.sowingDate < request.asOfDate ||
      change.sowingDate < request.asOfDate || row.husEvents?.length || request.completedWork?.some((work) => work.planRowId === row.id))) return fail("immutableWork",
      row.sectorName + ": faktiski sāktu vai bloķētu HUS sēšanu nepārceļam.", row.sectorName + ": sowing of a started or locked HUS cannot be moved.", [row.id]);
  }
  const requestedEnd = request.rows.filter((row) => requestedIds.has(row.id)).map((row) => row.harvestDate).sort().at(-1)!;
  const related = request.rows.filter((row) => !row.archivedAt && row.harvestDate > request.asOfDate && row.sowingDate <= requestedEnd);
  const relatedIds = new Set(related.map((row) => row.id));
  // A related HUS may stay longer than the requested HUS. Include later frozen
  // reservations through its Planting too, rather than hiding a future collision.
  const end = related.map((row) => row.harvestDate).sort().at(-1)!;
  if (dateDistance(request.asOfDate, end) > maxHorizonDays) return fail("input",
    "Kopīgās simulācijas periods pārsniedz 90 dienas.", "The joint simulation horizon exceeds 90 days.");
  const rows = request.rows.filter((row) => !row.archivedAt && row.harvestDate > request.asOfDate && row.sowingDate <= end)
    .slice().sort((a, b) => a.sowingDate.localeCompare(b.sowingDate) || a.id.localeCompare(b.id));
  if (rows.length > maxContextRows) return fail("searchLimit",
    "Pārklājošajā periodā ir vairāk par 80 HUS; sašaurini simulācijas periodu.",
    "More than 80 HUS overlap this horizon; narrow the simulation period.");
  const baselineWork = generateWorkItemsForRows(rows, request.config);
  const completedIndices = new Set<number>();
  const completionKeys = new Set<string>();
  for (const work of request.completedWork ?? []) {
    const row = request.rows.find((entry) => entry.id === work.planRowId);
    if (!row || !validDate(work.date) || work.date > request.asOfDate || work.type === "harvest" && work.date !== row.harvestDate) return fail("input",
      "Izpildītā darba ieraksts nav savietojams ar atskaites datumu vai fiksēto Planting.",
      "A completed-work record conflicts with the reference date or fixed Planting date.", [work.planRowId]);
    if (work.type === "sowing" && work.date !== row.sowingDate) return fail("input",
      row.sectorName + ": izpildītās sēšanas datums " + work.date + " atšķiras no HUS sēšanas datuma " + row.sowingDate + ".",
      row.sectorName + ": completed sowing on " + work.date + " differs from the HUS sowing date " + row.sowingDate + ".", [row.id], work.date);
    if (!rows.some((entry) => entry.id === row.id)) continue;
    const completionKey = [work.planRowId, work.type, work.date].join("|");
    if (completionKeys.has(completionKey)) return fail("input", "Izpildīto darbu sarakstā ir dublikāts.", "The completed-work list contains a duplicate.", [row.id]);
    completionKeys.add(completionKey);
    const actualThin = row.husEvents?.filter((event) => event.eventType === "thinning" || event.eventType === "move").map((event) => event.eventDate).sort()[0];
    if (work.type === "thinning" && actualThin && actualThin !== work.date) return fail("input",
      "Izpildītās retināšanas un Moving datumi atšķiras; to galdu aprite jāprecizē.",
      "Completed thinning and Moving dates differ; their table handover needs clarification.", [row.id]);
    const index = baselineWork.findIndex((entry, i) => !completedIndices.has(i) && entry.planRowId === work.planRowId && entry.type === work.type && entry.date === work.date);
    const fallback = index >= 0 ? index : baselineWork.findIndex((entry, i) => !completedIndices.has(i) && entry.planRowId === work.planRowId && entry.type === work.type);
    if (fallback < 0) return fail("input", "Izpildītajam darbam nav zināms sākotnējais darba ieraksts.", "The completed work has no known baseline work item.", [row.id]);
    baselineWork[fallback] = { ...baselineWork[fallback], date: work.date, locked: true };
    completedIndices.add(fallback);
  }
  const baselineThin = new Map(rows.map((row) => [row.id,
    row.husEvents?.filter((event) => event.eventType === "thinning" || event.eventType === "move").map((event) => event.eventDate).sort()[0] ??
    request.completedWork?.find((work) => work.planRowId === row.id && work.type === "thinning")?.date ??
    baselineWork.find((item) => item.planRowId === row.id && item.type === "thinning")?.date ?? "",
  ]));
  for (let i = 0; i < baselineWork.length; i++) {
    const item = baselineWork[i];
    const row = rows.find((entry) => entry.id === item.planRowId)!;
    const actualThin = row.husEvents?.filter((event) => event.eventType === "move" || event.eventType === "thinning").map((event) => event.eventDate).sort()[0];
    if (actualThin && !validDate(actualThin)) return fail("input", "Moving vai retināšanas faktiskais datums nav derīgs.", "An actual Moving or thinning date is invalid.", [row.id]);
    if (actualThin && ["thinning", "previcur", "disinfectTables"].includes(item.type) &&
      !request.completedWork?.some((work) => work.planRowId === row.id && work.type === item.type)) {
      baselineWork[i] = { ...item, date: actualThin, cycleDay: dateDistance(row.sowingDate, actualThin) + 1 };
    }
  }
  const baselineReservations = model.growingPlacements(rows).map((entry) => {
    const row = rows.find((candidate) => candidate.id === entry.planRowId)!;
    const actual = model.actualMovements(row);
    const date = baselineThin.get(row.id);
    const primaryRow = row.placement?.primaryRow ?? entry.primaryRow;
    if (actual.length) return { ...entry, releaseKnown: true };
    const tables = row.placement?.tables ?? entry.tables;
    return { ...entry, startDate: date || entry.startDate, releaseKnown: Boolean(date), primaryRow, tables,
      reservedTables: primaryRow === "A" ? tables : tables > 26 ? 39 : 26,
      usesExtraBlock: primaryRow === "A" || tables > 26,
      placementKind: !primaryRow ? "unplaced" as const : primaryRow === "A" ? "aExtraOnly" as const : tables > 26 ? "largeWithExtra" as const : "standardRow" as const };
  });
  const canMove = (row: SowingPlanRow) => !locked.has(row.id) && baselineThin.get(row.id)! >= request.asOfDate &&
    !row.husEvents?.some((event) => event.eventType === "thinning" || event.eventType === "move") &&
    !request.completedWork?.some((work) => work.planRowId === row.id && ["thinning", "previcur", "disinfectTables", "sideShoots", "sticks", "rings", "harvest"].includes(work.type));
  const movable = rows.filter((row) => relatedIds.has(row.id) && canMove(row)).sort((a, b) => Number(requestedIds.has(b.id)) - Number(requestedIds.has(a.id)) ||
    a.sowingDate.localeCompare(b.sowingDate) || a.id.localeCompare(b.id));
  if (movable.filter((row) => requestedIds.has(row.id)).length > limits.maxMutableRows) return fail("searchLimit",
    "Pieprasīto maināmo HUS skaits pārsniedz meklēšanas robežu.", "The number of requested movable HUS exceeds the search limit.");
  const mutableIds = new Set(movable.slice(0, limits.maxMutableRows).map((row) => row.id));
  result.search.frozenByLimit = movable.filter((row) => !mutableIds.has(row.id)).map((row) => row.id);
  result.search.truncated = result.search.frozenByLimit.length > 0;
  const context: Context = { request, rows, baselineWork, baselineThin, baselineReservations, mutableIds, requestedIds, end, result };
  const invalidFrozen = baselineReservations.find((entry) => !mutableIds.has(entry.planRowId) && entry.releaseKnown &&
    (entry.startDate >= entry.endDate || entry.startDate < rows.find((row) => row.id === entry.planRowId)!.sowingDate));
  if (invalidFrozen) return fail("input", invalidFrozen.sectorName + ": fiksētā retināšanas/Moving diena nav starp sēšanu un Planting.",
    invalidFrozen.sectorName + ": the fixed thinning/Moving date is not between sowing and Planting.", [invalidFrozen.planRowId]);
  for (const change of request.sowingChanges) if (change.sowingDate !== rows.find((row) => row.id === change.planRowId)!.sowingDate && !mutableIds.has(change.planRowId)) {
    return fail("immutableWork", "Pieprasītajam HUS nav pārvietojama retināšanas datuma.", "The requested HUS has no movable thinning date.", [change.planRowId]);
  }
  const changedRows = applySowingChanges(rows, request.sowingChanges);
  if (!validWorkWindows(context, changedRows)) return result;
  for (const stage of ["normal", "compromise", "emergency"] as const) {
    result.search.stages.push(stage);
    result.plans = search(context, changedRows, stage);
    if (result.plans.length || result.search.nodes >= limits.maxNodes) break;
  }
  if (!result.plans.length && result.search.nodes < limits.maxNodes) {
    result.search.stages.push("sowingCompromise");
    const flexibleSowing = rows.filter((row) => mutableIds.has(row.id) && !requestedIds.has(row.id) &&
      row.sowingDate > request.asOfDate && !row.husEvents?.length && !request.completedWork?.some((work) => work.planRowId === row.id));
    outer: for (const row of flexibleSowing) for (const offset of [-1, 1, -2, 2, -3, 3]) {
      if (result.search.sowingScenarios >= limits.maxSowingScenarios || result.search.nodes >= limits.maxNodes) {
        result.search.truncated = true;
        break outer;
      }
      const sowingDate = addDays(row.sowingDate, offset);
      if (sowingDate < request.asOfDate || sowingDate >= row.harvestDate) continue;
      result.search.sowingScenarios++;
      const scenario = applySowingChanges(changedRows, [{ planRowId: row.id, sowingDate }]);
      if (!validWorkWindows(context, scenario, false)) continue;
      result.plans = bestPlans([...result.plans, ...search(context, scenario, "sowingCompromise")]);
    }
  }
  result.search.truncated ||= result.search.nodes >= limits.maxNodes;
  if (result.plans.length) {
    result.status = result.plans[0].status;
    result.conflicts = [];
  } else {
    result.status = result.search.truncated ? "searchLimited" : result.conflicts.some((entry) => entry.code === "missingData") ? "insufficientData" : "cannot";
    if (result.search.truncated) conflict(context, "searchLimit", request.asOfDate, [], {
      lv: "Ierobežotajā meklēšanā risinājums nav atrasts; tas nepierāda, ka visi iespējamie kopīgie plāni ir neiespējami.",
      en: "The bounded search found no solution; this does not prove that every possible joint plan is impossible.",
    });
  }
  result.originalRowsUnchanged = JSON.stringify(request.rows) === snapshot;
  return result;
}

function search(context: Context, rows: SowingPlanRow[], stage: JointSearchStage): JointSimulationPlan[] {
  const { result, request } = context;
  const mutable = rows.filter((row) => context.mutableIds.has(row.id)).sort((a, b) =>
    a.sowingDate.localeCompare(b.sowingDate) || a.id.localeCompare(b.id));
  const frozen = context.baselineReservations.filter((entry) => !context.mutableIds.has(entry.planRowId));
  let beam: State[] = [{ choices: [], reservations: frozen }];
  for (let index = 0; index < mutable.length; index++) {
    const row = mutable[index];
    const next: State[] = [];
    const dates = thinningDates(context, row, stage);
    if (!dates.length) {
      conflict(context, "workWindow", row.harvestDate, [row.id], {
        lv: row.sectorName + ": pirms Planting " + row.harvestDate + " nav atļautas retināšanas dienas.",
        en: row.sectorName + ": there is no permitted thinning day before Planting on " + row.harvestDate + ".",
      });
      return [];
    }
    expanding: for (const state of beam) {
      const optimistic = mutable.slice(index + 1).map((other) => ({
        planRowId: other.id, sectorName: other.sectorName, startDate: thinningDates(context, other, stage)[0] ?? other.harvestDate,
        endDate: other.harvestDate, tables: 0, releaseKnown: true,
      }));
      const plants = getTotalSow(row);
      if (!Number.isFinite(plants) || !Number.isInteger(plants) || plants <= 0) {
        conflict(context, "missingData", row.sowingDate, [row.id], { lv: row.sectorName + ": nav derīga stādu skaita.", en: row.sectorName + ": a valid plant count is missing." });
        continue;
      }
      const normal = row.placement?.tables ?? calculateGreenhouseTablePlacement(plants).totalTables;
      if (!Number.isInteger(normal) || normal < 1 || normal > 39) {
        conflict(context, "missingData", row.sowingDate, [row.id], { lv: row.sectorName + ": nav derīga augšanas galdu skaita.", en: row.sectorName + ": a valid growing-table count is missing." });
        continue;
      }
      const counts = stage === "normal" ? [normal] : Array.from({ length: normal }, (_, i) => normal - i);
      if (!counts.some((count) => evaluateGreenhouseDensity(plants, count).feasible)) {
        conflict(context, "growingCapacity", row.sowingDate, [row.id], {
          lv: row.sectorName + ": " + normal + " galdiem pārsniegts atļautais augšanas blīvums.",
          en: row.sectorName + ": the permitted growing density is exceeded on " + normal + " tables.",
        });
        continue;
      }
      for (const date of dates) {
        const seed = model.checkSeedingCapacity(row, rows.filter((other) => other.id !== row.id), [...state.reservations, ...optimistic], date, seedingCount(row), request.asOfDate,
          { step: () => tick(context), exhausted: false });
        if (seed.searchLimited) break expanding;
        if (!seed.feasible) {
          conflict(context, seed.incomplete ? "missingData" : "seedingCapacity", date, [row.id], seed.notices[0]);
          if (!tick(context)) break expanding;
          continue;
        }
        const interval = eachDate(date, addDays(row.harvestDate, -1)).map((day) => ({ date: day, active: model.reservationsOnDate(state.reservations, day) }));
        for (const count of counts) {
          if (!evaluateGreenhouseDensity(plants, count).feasible) continue;
          const freeRow = { ...row, placement: { ...row.placement, primaryRow: undefined } };
          const options = [...new Map([{ active: [] as Reservation[] }, ...interval].flatMap((day) =>
            model.placementOptions(freeRow, count, day.active, date, row.harvestDate)).map((option) =>
            [[option.kind, option.primaryRow, count].join("|"), option] as const)).values()];
          for (const option of options) {
            if (stage === "normal" && option.kind === "sharedRow") continue;
            if (!tick(context)) break expanding;
            const failed = interval.find((day) => !model.optionFits(option, day.active));
            if (failed) {
              conflict(context, "growingCapacity", failed.date, [row.id, ...failed.active.map((entry) => entry.planRowId)], model.growingConflict(option, failed.active, failed.date));
              continue;
            }
            const choice = { row, date, option };
            next.push({ choices: [...state.choices, choice], reservations: [...state.reservations, reservation(choice)] });
          }
        }
      }
    }
    if (!next.length) return [];
    const sorted = next.sort((a, b) => compareVectors(stateScore(context, a), stateScore(context, b)) || stateKey(a).localeCompare(stateKey(b)));
    result.search.truncated ||= sorted.length > result.search.beamWidth;
    beam = sorted.slice(0, result.search.beamWidth);
  }
  return bestPlans(beam.flatMap((state) => {
    const plan = completePlan(context, rows, state);
    return plan ? [plan] : [];
  }));
}

function completePlan(context: Context, rows: SowingPlanRow[], state: State): JointSimulationPlan | undefined {
  const { request } = context;
  const notices: SimulationNotice[] = [];
  for (const row of rows) {
    const entry = state.reservations.find((item) => item.planRowId === row.id);
    if (!entry || entry.startDate < request.asOfDate || row.sowingDate > context.end) continue;
    const count = seedingCount(row);
    if (!Number.isFinite(count) || count <= 0) {
      notices.push({ lv: row.sectorName + ": nav zināms sēšanas galdu skaits; kopīgā kapacitāte nav pilnībā apstiprināta.",
        en: row.sectorName + ": the seeding-table count is unknown; joint capacity is not fully confirmed." });
      continue;
    }
    const seed = model.checkSeedingCapacity(row, rows.filter((other) => other.id !== row.id), state.reservations,
      entry.startDate < context.end ? entry.startDate : context.end, count, request.asOfDate,
      { step: () => tick(context), exhausted: false });
    if (seed.searchLimited) return undefined;
    if (!seed.feasible) {
      conflict(context, seed.incomplete ? "missingData" : "seedingCapacity", entry.startDate, [row.id], seed.notices[0]);
      return undefined;
    }
    notices.push(...seed.notices);
  }
  const workItems = workFor(context, rows, state.choices);
  const proposals: JointHusProposal[] = state.choices.map((choice) => {
    const { row, date, option } = choice;
    const shared = new Set<string>();
    for (const day of eachDate(date, addDays(row.harvestDate, -1))) for (const entry of model.reservationsOnDate(state.reservations, day)) {
      if (entry.planRowId !== row.id && entry.primaryRow === option.primaryRow && option.primaryRow !== "A") shared.add(entry.planRowId);
    }
    const planting = state.reservations.filter((entry) => entry.planRowId !== row.id && entry.endDate === date &&
      (entry.primaryRow === option.primaryRow || option.usesExtraBlock && entry.usesExtraBlock)).map((entry) => entry.planRowId);
    const names = (ids: string[]) => ids.map((id) => rows.find((entry) => entry.id === id)?.sectorName ?? id).join(", ");
    const ownNotices: SimulationNotice[] = [];
    if (shared.size) ownNotices.push({ lv: row.sectorName + ": dalīta laistīšanas zona ar " + names([...shared]) + "; vajadzīga agronoma saskaņošana.", en: row.sectorName + ": a watering zone shared with " + names([...shared]) + " requires agronomist approval." });
    if (planting.length) ownNotices.push({ lv: date + ": vispirms Planting (" + names(planting) + "), pēc tam " + row.sectorName + " retināšana.", en: date + ": Planting first (" + names(planting) + "), then thin " + row.sectorName + "." });
    if (dateDistance(row.sowingDate, date) === 10) ownNotices.push({ lv: row.sectorName + ": retināšana 11. dienā ir ārkārtas variants ar saskaņošanu.", en: row.sectorName + ": day-11 thinning is an emergency option requiring approval." });
    const normal = row.placement?.tables ?? calculateGreenhouseTablePlacement(getTotalSow(row)).totalTables;
    if (option.physicalTables < normal || option.densityClass !== "normal") ownNotices.push({ lv: row.sectorName + ": sablīvējums " + option.plantsPerTrough + " stādi/renē; vajadzīga saskaņošana.", en: row.sectorName + ": compression to " + option.plantsPerTrough + " plants/trough requires approval." });
    if (option.usesExtraBlock) ownNotices.push({ lv: row.sectorName + ": izmantots A14–A26 papildu bloks.", en: row.sectorName + ": uses the A14–A26 extra block." });
    const workload = evaluateThinningWorkload(date, row.id, workItems);
    if (workload.overload) ownNotices.push({ lv: date + ": darba slodze " + workload.projectedLoad + ", pārsniegums " + workload.overload + "; jāsaskaņo darba kapacitāte.", en: date + ": workload " + workload.projectedLoad + ", overload " + workload.overload + "; confirm labour capacity." });
    notices.push(...ownNotices);
    return { planRowId: row.id, sectorName: row.sectorName, sowingDate: row.sowingDate, thinningDate: date, plantingDate: row.harvestDate,
      cycleDay: dateDistance(row.sowingDate, date) + 1, seedingTableCount: seedingCount(row), fixedSeedingTables: parseSowingTableSelection(row.sowingTables),
      wateringZone: option.primaryRow!, physicalTables: option.physicalTables, normalTables: normal,
      placementKind: shared.size ? "sharedRow" as const : option.kind, densityClass: option.densityClass, plantsPerTrough: option.plantsPerTrough,
      sharedWith: [...shared].sort(), plantingBeforeThinning: planting.sort(), workload, notices: ownNotices };
  });
  const notedUnknown = new Set<string>();
  const occupancy = eachDate(request.asOfDate, context.end).map((date) => {
    const active = model.reservationsOnDate(state.reservations, date);
    const growing = model.growingOccupancy(state.reservations, date);
    const physical = active.reduce((sum, entry) => sum + entry.tables, 0);
    const aUsed = active.reduce((sum, entry) => sum + (entry.primaryRow === "A" ? entry.tables : entry.placementKind === "largeWithExtra" ? 13 : 0), 0);
    const longUsed = (["B", "C", "D"] as const).map((id) => active.filter((entry) => entry.primaryRow === id).reduce((sum, entry) => sum + Math.min(26, entry.tables), 0));
    const known = new Map<string, string>();
    let actualCollision = false;
    for (const row of growing.rows) for (const table of row.actualTableIds ?? []) {
      if (known.has(table) && known.get(table) !== row.planRowId) actualCollision = true;
      known.set(table, row.planRowId);
    }
    const overCapacity = physical > 91 || aUsed > 13 || longUsed.some((value) => value > 26) || actualCollision;
    if (overCapacity) conflict(context, "growingCapacity", date, active.map((entry) => entry.planRowId), {
      lv: date + ": augšanas rezervācijas fiziski pārklājas vai pārsniedz rindas kapacitāti (" + active.map((entry) => entry.sectorName).join(", ") + ").",
      en: date + ": growing reservations overlap physically or exceed row capacity (" + active.map((entry) => entry.sectorName).join(", ") + ").",
    });
    for (const entry of state.reservations) {
      if (entry.startDate > date || date >= entry.endDate || notedUnknown.has(entry.planRowId)) continue;
      const unlocatedActual = !entry.actualMovements?.length && rows.find((row) => row.id === entry.planRowId)?.husEvents?.some((event) =>
        event.eventType === "move" || event.eventType === "thinning");
      const unknown = !entry.releaseKnown || !entry.actualMovements?.length && (!entry.primaryRow || unlocatedActual) ||
        entry.actualMovements?.some((movement) => movement.eventDate <= date && movement.warnings.length);
      if (!unknown) continue;
      notedUnknown.add(entry.planRowId);
      notices.push({ lv: date + ": " + entry.sectorName + " augšanas izvietojums nav pilnībā zināms; priekšlikums ir nosacīts.",
        en: date + ": " + entry.sectorName + " growing placement is not fully known; the proposal is conditional." });
    }
    const usedTables = longUsed.filter((value) => value > 0).length * 26 + aUsed;
    return { date, seeding: model.seedingOccupancy(rows, state.reservations, date),
      growing: { ...growing, usedTables, physicalUsedTables: physical, freeTables: Math.max(0, 91 - usedTables), overCapacity }, warnings: [] };
  });
  if (occupancy.some((day) => day.growing.overCapacity || day.seeding.overCapacity || day.seeding.conflicts.length)) return undefined;
  const changes = changesFor(context, proposals, state.reservations);
  for (const proposal of proposals) for (const type of ["sideShoots", "sticks"] as const) {
    const before = context.baselineWork.filter((item) => item.planRowId === proposal.planRowId && item.type === type).map((item) => item.date).sort().join(", ");
    const after = workItems.filter((item) => item.planRowId === proposal.planRowId && item.type === type).map((item) => item.date).sort().join(", ");
    if (before !== after) changes.push({ planRowId: proposal.planRowId, field: "workDates", workType: type, before, after, requiresApproval: true,
      reason: { lv: proposal.sectorName + ": jaunajai sēšanai pielāgots vēl neizpildīts automātisks darbs (" + type + "); vajadzīga saskaņošana.",
        en: proposal.sectorName + ": pending automatic work (" + type + ") is adjusted to the new sowing date; confirmation is required." } });
  }
  for (const change of changes.filter((entry) => entry.requiresApproval)) notices.push(change.reason);
  const score = {
    sowingCompromises: changes.filter((entry) => entry.field === "sowingDate" && entry.requiresApproval).length,
    densityAndWateringCompromises: proposals.filter((entry) => entry.physicalTables < entry.normalTables || entry.densityClass !== "normal" || entry.sharedWith.length || entry.placementKind === "aExtraOnly").length,
    densitySeverity: proposals.reduce((sum, entry) => sum + densitySeverity(entry.densityClass), 0),
    compressedTables: proposals.reduce((sum, entry) => sum + Math.max(0, entry.normalTables - entry.physicalTables), 0),
    changedThinningDates: proposals.filter((entry) => entry.thinningDate !== context.baselineThin.get(entry.planRowId)).length,
    thinningShiftDays: proposals.reduce((sum, entry) => sum + Math.abs(dateDistance(context.baselineThin.get(entry.planRowId)!, entry.thinningDate)), 0),
    overloadOnThinningDays: [...new Set(workItems.filter((item) => item.type === "thinning" && item.date >= request.asOfDate && item.date <= context.end).map((item) => item.date))]
      .reduce((sum, date) => sum + evaluateThinningWorkload(date, workItems.find((item) => item.type === "thinning" && item.date === date)!.planRowId, workItems).overload, 0),
    emergencyDays: proposals.filter((entry) => entry.cycleDay === 11).length,
    changedRows: changes.filter((entry) => entry.field === "wateringZone").length,
  };
  return { status: notices.length ? "conditional" : "can", proposals, changes, notices: uniqueNotices(notices), workItems, occupancy, score };
}

function workFor(context: Context, rows: SowingPlanRow[], choices: Choice[]): WorkItem[] {
  const seedLinked: WorkItem["type"][] = ["sowing", "removeFilm", "addAgrofilm", "removeAgrofilm", "animals"];
  let work = context.baselineWork.map((item) => ({ ...item }));
  for (const row of rows) {
    if (row.sowingDate === context.rows.find((entry) => entry.id === row.id)!.sowingDate) continue;
    const generated = generateWorkItemsForRows([clearOptimizerWorkAdjustments(row)], context.request.config);
    const adjustable: WorkItem["type"][] = ["sideShoots", "sticks"];
    const invalid = context.baselineWork.some((item) => {
      if (item.planRowId !== row.id || !adjustable.includes(item.type)) return false;
      const window = generated.find((other) => other.type === item.type)?.allowedDateRange;
      return window && (item.date < window.start || window.end && item.date > window.end);
    });
    const regenerated = invalid ? [...seedLinked, ...adjustable] : seedLinked;
    work = work.filter((item) => item.planRowId !== row.id || !regenerated.includes(item.type));
    work.push(...generated.filter((item) => regenerated.includes(item.type)));
  }
  return work.map((item) => {
    const choice = choices.find((entry) => entry.row.id === item.planRowId);
    if (choice && ["thinning", "previcur", "disinfectTables"].includes(item.type)) return { ...item, date: choice.date,
      cycleDay: dateDistance(choice.row.sowingDate, choice.date) + 1 };
    const row = rows.find((entry) => entry.id === item.planRowId)!;
    return { ...item, cycleDay: dateDistance(row.sowingDate, item.date) + 1 };
  }).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}

function changesFor(context: Context, proposals: JointHusProposal[], reservations: Reservation[]): JointPlanChange[] {
  return proposals.flatMap((proposal) => {
    const original = context.rows.find((row) => row.id === proposal.planRowId)!;
    const previous = context.baselineReservations.find((entry) => entry.planRowId === proposal.planRowId);
    const changes: JointPlanChange[] = [];
    const add = (field: JointPlanChange["field"], before: JointPlanChange["before"], after: JointPlanChange["after"], reason: SimulationNotice, requiresApproval = false) => {
      if (before !== after) changes.push({ planRowId: original.id, field, before, after, reason, requiresApproval });
    };
    add("sowingDate", original.sowingDate, proposal.sowingDate, context.requestedIds.has(original.id) ? {
      lv: "Lietotāja pieprasītais sēšanas scenārijs; Planting paliek " + original.harvestDate + ".",
      en: "User-requested sowing scenario; Planting remains " + original.harvestDate + ".",
    } : { lv: original.sectorName + ": sēšanu piedāvāts pārcelt uz " + proposal.sowingDate + " tikai kā pēdējo kompromisu; nepieciešams lietotāja apstiprinājums. Planting nemainās.",
      en: original.sectorName + ": sowing on " + proposal.sowingDate + " is a last-resort compromise requiring user approval. Planting is unchanged." }, !context.requestedIds.has(original.id));
    const oldThin = context.baselineThin.get(original.id)!;
    const freedFor = context.rows.filter((row) => row.id !== original.id && row.sowingDate > proposal.thinningDate && row.sowingDate <= oldThin).map((row) => row.sectorName);
    const handoff = reservations.filter((entry) => entry.planRowId !== original.id && entry.endDate === proposal.thinningDate &&
      (entry.primaryRow === proposal.wateringZone || proposal.wateringZone === "A" && entry.usesExtraBlock)).map((entry) => entry.sectorName);
    add("thinningDate", oldThin, proposal.thinningDate, proposal.thinningDate < oldThin ? {
      lv: "Sēšanas galdi atbrīvojas " + addDays(proposal.thinningDate, 1) + (freedFor.length ? " nākamajiem HUS: " + freedFor.join(", ") : " agrāk kopīgā plāna vajadzībām") + ".",
      en: "Seeding tables become free on " + addDays(proposal.thinningDate, 1) + (freedFor.length ? " for the next HUS: " + freedFor.join(", ") : " earlier for the joint plan") + ".",
    } : { lv: "Vēlāka retināšana ļauj sagaidīt augšanas vietu un saskaņot darba slodzi" + (handoff.length ? " pēc " + handoff.join(", ") + " Planting" : "") + ".",
      en: "Later thinning allows growing space to become available and coordinates workload" + (handoff.length ? " after Planting of " + handoff.join(", ") : "") + "." });
    add("wateringZone", previous?.primaryRow, proposal.wateringZone, { lv: "Izvēlēta kopīgi pieejama " + proposal.wateringZone + " rinda visam augšanas periodam.", en: "Row " + proposal.wateringZone + " is jointly available for the entire growing period." });
    add("growingTables", proposal.normalTables, proposal.physicalTables, { lv: "Sablīvējums ļauj fiziski ievietot HUS kopīgajā plānā; vajadzīga agronoma saskaņošana.", en: "Compression makes physical room for the HUS in the joint plan; agronomist approval is required." }, true);
    return changes;
  });
}

function thinningDates(context: Context, row: SowingPlanRow, stage: JointSearchStage): string[] {
  return (stage === "normal" || stage === "compromise" ? [8, 9, 10] : [8, 9, 10, 11])
    .map((day) => addDays(row.sowingDate, day - 1)).filter((date) => date >= context.request.asOfDate && date < row.harvestDate);
}
function reservation(choice: Choice): Reservation {
  const { row, date, option } = choice;
  return { planRowId: row.id, sectorName: row.sectorName, startDate: date, endDate: row.harvestDate,
    tables: option.physicalTables, reservedTables: option.reservedTables, primaryRow: option.primaryRow,
    releaseKnown: true, usesExtraBlock: option.usesExtraBlock, placementKind: option.kind, density: option.plantsPerTrough };
}
function seedingCount(row: SowingPlanRow): number {
  const plan = calculateSowingPlan(getTotalSow(row));
  return Math.max(plan.fullTables + Number(plan.hasPartialTable), parseSowingTableSelection(row.sowingTables).length);
}
function stateScore(context: Context, state: State): number[] {
  if (state.rank) return state.rank;
  const work = context.baselineWork.map((item) => {
    const choice = state.choices.find((entry) => entry.row.id === item.planRowId);
    return choice && item.type === "thinning" ? { ...item, date: choice.date } : item;
  });
  const overload = [...new Set(state.choices.map((choice) => choice.date))].reduce((sum, date) =>
    sum + evaluateThinningWorkload(date, state.choices.find((choice) => choice.date === date)!.row.id, work).overload, 0);
  state.rank = [state.choices.filter((choice) => choice.option.densityClass !== "normal" || choice.option.kind === "sharedRow" || choice.option.kind === "aExtraOnly").length,
    state.choices.reduce((sum, choice) => sum + densitySeverity(choice.option.densityClass), 0),
    state.choices.reduce((sum, choice) => sum + Math.max(0, (choice.row.placement?.tables ?? calculateGreenhouseTablePlacement(getTotalSow(choice.row)).totalTables) - choice.option.physicalTables), 0),
    state.choices.filter((choice) => choice.date !== context.baselineThin.get(choice.row.id)).length,
    state.choices.reduce((sum, choice) => sum + Math.abs(dateDistance(context.baselineThin.get(choice.row.id)!, choice.date)), 0),
    overload,
    state.choices.filter((choice) => dateDistance(choice.row.sowingDate, choice.date) === 10).length,
    state.choices.filter((choice) => context.baselineReservations.find((entry) => entry.planRowId === choice.row.id)?.primaryRow !== choice.option.primaryRow).length,
    state.choices.reduce((sum, choice) => sum + choice.option.score, 0)];
  return state.rank;
}
function bestPlans(plans: JointSimulationPlan[]): JointSimulationPlan[] {
  const sorted = plans.sort((a, b) => compareVectors(Object.values(a.score), Object.values(b.score)) || planKey(a).localeCompare(planKey(b)));
  const seen = new Set<string>();
  return sorted.filter((plan) => {
    const key = JSON.stringify(plan.proposals.map((proposal) => {
      const change = plan.changes.find((entry) => entry.planRowId === proposal.planRowId && entry.field === "thinningDate");
      const oldDate = change ? String(change.before) : proposal.thinningDate;
      return [proposal.planRowId, proposal.sowingDate, Math.sign(dateDistance(oldDate, proposal.thinningDate)), proposal.cycleDay === 11,
        proposal.densityClass, proposal.placementKind, proposal.sharedWith, proposal.plantingBeforeThinning,
        proposal.workload.projectedLoad, proposal.workload.sowingCount, proposal.workload.thinningCount, proposal.workload.plantingCount,
        plan.workItems.filter((item) => item.type === "sowing" && item.planRowId !== proposal.planRowId &&
          item.date > proposal.thinningDate && item.date <= oldDate).map((item) => item.planRowId).sort()];
    }));
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, maxReturnedPlans);
}
function tick(context: Context): boolean {
  if (context.result.search.nodes >= context.result.search.maxNodes) { context.result.search.truncated = true; return false; }
  context.result.search.nodes++;
  return true;
}
function conflict(context: Context, code: JointSimulationConflict["code"], date: string, ids: string[], message: SimulationNotice) {
  if (!message) return;
  if (context.result.conflicts.some((entry) => entry.message.lv === message.lv)) return;
  context.result.conflicts.push({ code, date: /^\d{4}-\d{2}-\d{2}/.exec(message.lv)?.[0] ?? date, planRowIds: [...new Set(ids)].sort(), message });
  if (context.result.conflicts.length > 40) context.result.conflicts.shift();
}
function validWorkWindows(context: Context, rows: SowingPlanRow[], report = true): boolean {
  for (const row of rows) {
    if (row.sowingDate === context.rows.find((entry) => entry.id === row.id)!.sowingDate) continue;
    // Non-thinning work stays on its existing dates. Reject a sowing scenario
    // that would require silently moving a fixed or already planned task.
    const invalid = scheduleProductionWork([clearOptimizerWorkAdjustments(row)]).warnings.find((warning) =>
      warning.type !== "thinning" && (warning.code === "invalid_manual_adjustment" || warning.code === "no_valid_window"));
    if (invalid) {
      if (report) {
        context.result.status = "insufficientData";
        conflict(context, "immutableWork", row.sowingDate, [row.id], {
          lv: row.sectorName + ": jaunā sēšana konfliktē ar saglabājamu pazaru vai kociņu darbu; vajadzīgs atsevišķs lēmums.",
          en: row.sectorName + ": the new sowing date conflicts with preserved side-shoot or stick work; a separate decision is required.",
        });
      }
      return false;
    }
  }
  return true;
}
function applySowingChanges(rows: SowingPlanRow[], changes: JointSimulationRequest["sowingChanges"]): SowingPlanRow[] {
  return rows.map((row) => {
    const change = changes.find((entry) => entry.planRowId === row.id);
    return change ? { ...row, sowingDate: change.sowingDate } : row;
  });
}
function compareVectors(a: number[], b: number[]): number {
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}
function stateKey(state: State): string { return state.choices.map((choice) => [choice.row.id, choice.date, choice.option.primaryRow, choice.option.physicalTables, choice.option.kind].join(":")).join("|"); }
function planKey(plan: JointSimulationPlan): string { return plan.proposals.map((entry) => [entry.planRowId, entry.sowingDate, entry.thinningDate, entry.wateringZone, entry.physicalTables].join(":")).join("|"); }
function uniqueNotices(notices: SimulationNotice[]): SimulationNotice[] { return [...new Map(notices.map((entry) => [entry.lv, entry])).values()]; }
function dateDistance(a: string, b: string): number { return Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 86400000); }
function densitySeverity(density: PlacementOption["densityClass"]): number { return density === "normal" ? 0 : density === "slightlyCompressed" ? 1 : 2; }
function validDate(date: string): boolean { return /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date + "T12:00:00Z").toISOString().slice(0, 10) === date; }

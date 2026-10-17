import { simulateSowingDateChange, type GreenhouseSimulationAlternative, type SimulationNotice, type SowingDateSimulationResult } from "./greenhouse-simulation";
import { simulateJointSowingPlan, type JointPlanChange, type JointSimulationPlan, type JointSimulationResult, type JointHusProposal } from "./joint-greenhouse-simulation";
import { generateWorkItemsForRows } from "./planning";
import { printWorkTitle } from "./localization";
import type { PlannerConfig, SowingPlanRow } from "./types";

/** Presentation adapter over the existing single-HUS and joint engines.
 * It chooses one preview and never persists it. Planting remains fixed. */
export function simulateGreenhouseSowing(
  rows: SowingPlanRow[], config: PlannerConfig, targetId: string, sowingDate: string, asOfDate: string,
): SowingDateSimulationResult {
  const direct = simulateSowingDateChange(rows, config, targetId, sowingDate);
  if (direct.status === "can" && direct.recommendation && direct.recommendation.cycleDay < 11 && direct.recommendation.densityClass !== "exceptional") return direct;
  if (rows.find((row) => row.id === targetId)?.husEvents?.some((event) => event.eventType === "move" || event.eventType === "thinning")) return direct;

  const joint = simulateJointSowingPlan({ rows, config, asOfDate,
    sowingChanges: [{ planRowId: targetId, sowingDate }], allowOtherSowingChanges: false, prioritizeRequestedHus: true });
  const plan = joint.plans[0];
  const target = plan?.proposals.find((entry) => entry.planRowId === targetId);
  const requiredChanges = plan ? describeJointOtherChanges(rows, plan, [targetId]) : [];
  if (plan && target && (!direct.recommendation || betterJointProposal(target, requiredChanges.length > 0, direct.recommendation))) {
    const notices = unique([...requiredChanges, ...plan.notices]);
    const status = requiredChanges.length || plan.status === "conditional" ? "conditional" : "can";
    const recommendation: GreenhouseSimulationAlternative = {
      ...target, status, seedingTables: target.fixedSeedingTables,
      wateringZone: target.wateringZone as GreenhouseSimulationAlternative["wateringZone"],
      reservedTables: target.placementKind === "sharedRow" || target.wateringZone === "A" ? target.physicalTables : target.physicalTables > 26 ? 39 : 26,
      tier: target.cycleDay === 11 || target.sharedWith.length || target.densityClass === "exceptional" ? "strained" : status === "conditional" ? "compromise" : "preferred",
      usesExtraBlock: target.wateringZone === "A" || target.physicalTables > 26,
      sharedWith: target.sharedWith.map((id) => ({ planRowId: id, sectorName: rows.find((row) => row.id === id)?.sectorName ?? id, overlapDays: 0 })),
      avoidsDay9Overload: false, upcomingSowingCount: 0, score: 0,
      explanation: "Pārbaudīts kopīgais plāns līdz Planting; norādītās izmaiņas jāapstiprina pirms darbu veikšanas.",
      explanationEn: "The joint plan was checked through Planting; confirm the listed changes before carrying out the work.",
      notices, risks: notices.map((notice) => notice.lv),
    };
    const baselineWork = generateWorkItemsForRows(rows, config);
    const changedOtherWork = [...new Map(plan.changes.filter((change) => change.planRowId !== targetId && (change.field === "thinningDate" || change.field === "workDates"))
      .map((change) => {
        const type = change.field === "thinningDate" ? "thinning" as const : change.workType!;
        return [change.planRowId + type, { planRowId: change.planRowId, sectorName: rows.find((row) => row.id === change.planRowId)!.sectorName, type,
          before: baselineWork.filter((item) => item.planRowId === change.planRowId && item.type === type).map((item) => item.date),
          after: plan.workItems.filter((item) => item.planRowId === change.planRowId && item.type === type).map((item) => item.date) }] as const;
      })).values()];
    return { ...direct, status, recommendation, alternatives: [recommendation], requiredChanges, changedOtherWork,
      notices, warnings: notices.map((notice) => notice.lv), occupancy: plan.occupancy, originalRowsUnchanged: joint.originalRowsUnchanged,
      scenarioRows: rows.map((row) => {
        const proposal = plan.proposals.find((entry) => entry.planRowId === row.id);
        return proposal ? { ...row, sowingDate: proposal.sowingDate, adjustments: { ...row.adjustments, thinning: proposal.thinningDate },
          placement: { ...row.placement, primaryRow: proposal.wateringZone, tables: proposal.physicalTables } } : row;
      }) };
  }
  if (direct.recommendation) return direct;
  const ordered = simulateSowingDateChange(rows, config, targetId, sowingDate, { allowSameDaySeedingRelease: true });
  if (ordered.recommendation) return ordered;
  // A bounded joint search is not proof of impossibility. Retain the concrete
  // single-HUS obstacles and say which part could not be fully searched.
  if (joint.status === "searchLimited") {
    const notices = unique([...joint.conflicts.filter((conflict) => conflict.code === "searchLimit").map((conflict) => conflict.message), ...direct.notices]);
    return { ...direct, status: "insufficientData", notices, warnings: notices.map((notice) => notice.lv) };
  }
  return direct;
}

export type TwoHusSowingResult = {
  status: JointSimulationResult["status"];
  plan?: JointSimulationPlan;
  proposals: JointHusProposal[];
  notices: SimulationNotice[];
  requiredChanges: SimulationNotice[];
  originalRowsUnchanged: boolean;
};

export function simulateTwoHusSowing(rows: SowingPlanRow[], config: PlannerConfig,
  changes: Array<{ planRowId: string; sowingDate: string }>, asOfDate: string): TwoHusSowingResult {
  const invalid = changes.length !== 2 || new Set(changes.map((change) => change.planRowId)).size !== 2;
  const actual = changes.map((change) => rows.find((row) => row.id === change.planRowId)).find((row) =>
    row?.husEvents?.some((event) => event.eventType === "move" || event.eventType === "thinning"));
  if (invalid || actual) return { status: "insufficientData", proposals: [], requiredChanges: [], originalRowsUnchanged: true,
    notices: [{ lv: invalid ? "Izvēlies divus dažādus HUS." : actual!.sectorName + ": faktiskais Moving/retināšana nav pārplānojama.",
      en: invalid ? "Choose two different HUS." : actual!.sectorName + ": actual Moving/thinning cannot be replanned." }] };
  const result = simulateJointSowingPlan({ rows, config, asOfDate, sowingChanges: changes,
    allowOtherSowingChanges: false, prioritizeRequestedHus: true });
  const plan = result.plans[0];
  const requiredChanges = plan ? describeJointOtherChanges(rows, plan, changes.map((change) => change.planRowId)) : [];
  const proposals = changes.flatMap((change) => plan?.proposals.filter((proposal) => proposal.planRowId === change.planRowId) ?? []);
  const incompleteSelection = Boolean(plan && proposals.length !== 2);
  const notices = incompleteSelection ? [{ lv: "Izvēlētajiem HUS nav divu pārvietojamu, vēl neizpildītu retināšanas darbu.",
    en: "The selected HUS do not both have movable, pending thinning work." }]
    : plan ? unique([...requiredChanges, ...plan.notices]) : result.conflicts.slice().sort((a, b) =>
      Number(b.code === "searchLimit") - Number(a.code === "searchLimit") || a.date.localeCompare(b.date)).map((conflict) => conflict.message);
  return { status: incompleteSelection ? "insufficientData" : plan ? requiredChanges.length || plan.status === "conditional" ? "conditional" : "can" : result.status,
    plan: incompleteSelection ? undefined : plan, proposals: incompleteSelection ? [] : proposals, notices, requiredChanges,
    originalRowsUnchanged: result.originalRowsUnchanged };
}

function describeJointOtherChanges(rows: SowingPlanRow[], plan: JointSimulationPlan, requestedIds: string[]): SimulationNotice[] {
  const labels: Record<JointPlanChange["field"], SimulationNotice> = {
    sowingDate: { lv: "sēšana", en: "sowing" }, thinningDate: { lv: "retināšana", en: "thinning" },
    wateringZone: { lv: "augšanas rinda", en: "growing row" }, growingTables: { lv: "augšanas galdi", en: "growing tables" }, workDates: { lv: "darbs", en: "work" },
  };
  return plan.changes.filter((change) => !requestedIds.includes(change.planRowId)).map((change) => {
    const name = rows.find((row) => row.id === change.planRowId)?.sectorName ?? change.planRowId;
    return { lv: `${name}: ${labels[change.field].lv}${change.workType ? " (" + printWorkTitle(change.workType, "lv") + ")" : ""} ${change.before ?? "nav norādīts"} → ${change.after}.`,
      en: `${name}: ${labels[change.field].en}${change.workType ? " (" + printWorkTitle(change.workType, "en") + ")" : ""} ${change.before ?? "unspecified"} → ${change.after}.` };
  });
}

function betterJointProposal(proposal: JointHusProposal, changesOthers: boolean, direct: GreenhouseSimulationAlternative): boolean {
  const rank = (day: number, other: boolean, density: string, shared: boolean, compressed: boolean, overload: number) =>
    [Number(day === 11), Number(other), Number(density === "exceptional"), Number(shared), Number(compressed), overload];
  const joint = rank(proposal.cycleDay, changesOthers, proposal.densityClass, proposal.sharedWith.length > 0,
    proposal.physicalTables < proposal.normalTables, proposal.workload.overload);
  const baseline = rank(direct.cycleDay, false, direct.densityClass, direct.sharedWith.length > 0,
    direct.physicalTables < direct.normalTables, direct.workload.overload);
  for (let i = 0; i < joint.length; i++) if (joint[i] !== baseline[i]) return joint[i] < baseline[i];
  return false;
}

function unique(notices: SimulationNotice[]): SimulationNotice[] {
  return [...new Map(notices.map((notice) => [notice.lv, notice])).values()];
}

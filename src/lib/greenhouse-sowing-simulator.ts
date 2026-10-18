import { type GreenhouseSimulationAlternative, type SimulationNotice, type SowingDateSimulationResult } from "./greenhouse-simulation";
import { applySimulationSowingChanges, simulateJointSowingPlan, type JointPlanChange, type JointSimulationPlan, type JointSimulationResult, type JointHusProposal, type JointSimulationRequest } from "./joint-greenhouse-simulation";
import { generateWorkItemsForRows } from "./planning";
import { printWorkTitle } from "./localization";
import type { PlannerConfig, SowingPlanRow } from "./types";

/** Presentation adapter over the house allocation and existing joint engine.
 * It chooses one preview and never persists it. Sowing changes preserve cycles. */
export function simulateGreenhouseSowing(
  rows: SowingPlanRow[], config: PlannerConfig, targetId: string, sowingDate: string, asOfDate: string,
): SowingDateSimulationResult {
  const original = rows.find((row) => row.id === targetId);
  if (!original) throw new Error("HUS nav atrasts simulācijai.");
  const joint = previewJoint({ rows, config, asOfDate, sowingChanges: [{ planRowId: targetId, sowingDate }] });
  const failureNotices = conflictNotices(joint);
  const scenarioRows = joint.conflicts.some((entry) => entry.code === "input" || entry.code === "immutableWork") ? rows.slice()
    : applySimulationSowingChanges(rows, [{ planRowId: targetId, sowingDate }]);
  const scenarioTarget = scenarioRows.find((row) => row.id === targetId)!;
  const direct: SowingDateSimulationResult = { targetPlanRowId: targetId, targetSectorName: original.sectorName,
    currentSowingDate: original.sowingDate, newSowingDate: sowingDate,
    currentMoveOutDate: original.harvestDate, newMoveOutDate: scenarioTarget.harvestDate,
    status: joint.status, notices: failureNotices, warnings: failureNotices.map((notice) => notice.lv),
    explanation: failureNotices[0]?.lv ?? "", alternatives: [], changedOtherWork: [], occupancy: [],
    scenarioRows, originalRowsUnchanged: joint.originalRowsUnchanged };
  const plan = joint.plans[0];
  const target = plan?.proposals.find((entry) => entry.planRowId === targetId);
  const requiredChanges = plan ? describeJointOtherChanges(rows, plan, [targetId]) : [];
  if (plan && target) {
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
    return { ...direct, status, newMoveOutDate: target.plantingDate, recommendation, alternatives: [recommendation], requiredChanges, changedOtherWork,
      notices, warnings: notices.map((notice) => notice.lv), occupancy: plan.occupancy, originalRowsUnchanged: joint.originalRowsUnchanged,
      scenarioRows: rows.map((row) => {
        const proposal = plan.proposals.find((entry) => entry.planRowId === row.id);
        return proposal ? { ...row, sowingDate: proposal.sowingDate, harvestDate: proposal.plantingDate, adjustments: { ...row.adjustments, thinning: proposal.thinningDate },
          placement: { ...row.placement, primaryRow: proposal.wateringZone, tables: proposal.physicalTables } } : row;
      }) };
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
  const result = previewJoint({ rows, config, asOfDate, sowingChanges: changes });
  const plan = result.plans[0];
  const requiredChanges = plan ? describeJointOtherChanges(rows, plan, changes.map((change) => change.planRowId)) : [];
  const proposals = changes.flatMap((change) => plan?.proposals.filter((proposal) => proposal.planRowId === change.planRowId) ?? []);
  const incompleteSelection = Boolean(plan && proposals.length !== 2);
  const notices = incompleteSelection ? [{ lv: "Izvēlētajiem HUS nav divu pārvietojamu, vēl neizpildītu retināšanas darbu.",
    en: "The selected HUS do not both have movable, pending thinning work." }]
    : plan ? unique([...requiredChanges, ...plan.notices]) : conflictNotices(result);
  return { status: incompleteSelection ? "insufficientData" : plan ? requiredChanges.length || plan.status === "conditional" ? "conditional" : "can" : result.status,
    plan: incompleteSelection ? undefined : plan, proposals: incompleteSelection ? [] : proposals, notices, requiredChanges,
    originalRowsUnchanged: result.originalRowsUnchanged };
}

function describeJointOtherChanges(rows: SowingPlanRow[], plan: JointSimulationPlan, requestedIds: string[]): SimulationNotice[] {
  const labels: Record<JointPlanChange["field"], SimulationNotice> = {
    sowingDate: { lv: "sēšana", en: "sowing" }, plantingDate: { lv: "Planting", en: "Planting" }, thinningDate: { lv: "retināšana", en: "thinning" },
    wateringZone: { lv: "augšanas rinda", en: "growing row" }, growingTables: { lv: "augšanas galdi", en: "growing tables" }, workDates: { lv: "darbs", en: "work" },
  };
  return plan.changes.filter((change) => !requestedIds.includes(change.planRowId)).map((change) => {
    const name = rows.find((row) => row.id === change.planRowId)?.sectorName ?? change.planRowId;
    return { lv: `${name}: ${labels[change.field].lv}${change.workType ? " (" + printWorkTitle(change.workType, "lv") + ")" : ""} ${change.before ?? "nav norādīts"} → ${change.after}.`,
      en: `${name}: ${labels[change.field].en}${change.workType ? " (" + printWorkTitle(change.workType, "en") + ")" : ""} ${change.before ?? "unspecified"} → ${change.after}.` };
  });
}

function previewJoint(request: JointSimulationRequest): JointSimulationResult {
  const options = { ...request, allowOtherSowingChanges: false, prioritizeRequestedHus: true, recalculateFuturePlacements: true };
  const result = simulateJointSowingPlan(options);
  if (result.status === "cannot" && result.conflicts.some((conflict) => conflict.code === "seedingCapacity")) {
    const ordered = simulateJointSowingPlan({ ...options, allowSameDaySeedingRelease: true });
    if (ordered.plans.length) return ordered;
  }
  return result;
}

function conflictNotices(result: JointSimulationResult): SimulationNotice[] {
  const seen = new Set<string>();
  return result.conflicts.slice().sort((a, b) => Number(b.code === "searchLimit") - Number(a.code === "searchLimit") || a.date.localeCompare(b.date))
    .filter((conflict) => {
      const key = JSON.stringify([conflict.code, conflict.date, conflict.planRowIds,
        conflict.message.lv.replace(/vēl \d+ galdiem/g, "vēl vajadzīgajiem galdiem")]);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).map((conflict) => conflict.message);
}

function unique(notices: SimulationNotice[]): SimulationNotice[] {
  return [...new Map(notices.map((notice) => [notice.lv, notice])).values()];
}

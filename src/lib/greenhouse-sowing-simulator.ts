import { simulateSowingDateChange, type GreenhouseSimulationAlternative, type SimulationNotice, type SowingDateSimulationResult } from "./greenhouse-simulation";
import { simulateJointSowingPlan, type JointPlanChange } from "./joint-greenhouse-simulation";
import { generateWorkItemsForRows } from "./planning";
import { printWorkTitle } from "./localization";
import type { PlannerConfig, SowingPlanRow } from "./types";

/** Presentation adapter over the existing single-HUS and joint engines.
 * It chooses one preview and never persists it. Planting remains fixed. */
export function simulateGreenhouseSowing(
  rows: SowingPlanRow[], config: PlannerConfig, targetId: string, sowingDate: string, asOfDate: string,
): SowingDateSimulationResult {
  const direct = simulateSowingDateChange(rows, config, targetId, sowingDate);
  if (direct.recommendation && direct.recommendation.cycleDay < 11 && direct.recommendation.densityClass !== "exceptional") return direct;
  if (rows.find((row) => row.id === targetId)?.husEvents?.some((event) => event.eventType === "move" || event.eventType === "thinning")) return direct;

  const joint = simulateJointSowingPlan({ rows, config, asOfDate,
    sowingChanges: [{ planRowId: targetId, sowingDate }], allowOtherSowingChanges: false });
  const plan = joint.plans[0];
  const target = plan?.proposals.find((entry) => entry.planRowId === targetId);
  if (plan && target && (!direct.recommendation || target.cycleDay < 11 && target.densityClass !== "exceptional")) {
    const labels: Record<JointPlanChange["field"], SimulationNotice> = {
      sowingDate: { lv: "sēšana", en: "sowing" }, thinningDate: { lv: "retināšana", en: "thinning" },
      wateringZone: { lv: "augšanas rinda", en: "growing row" }, growingTables: { lv: "augšanas galdi", en: "growing tables" },
      workDates: { lv: "darbs", en: "work" },
    };
    const requiredChanges = plan.changes.filter((change) => change.planRowId !== targetId).map((change): SimulationNotice => {
      const name = rows.find((row) => row.id === change.planRowId)?.sectorName ?? change.planRowId;
      return { lv: `${name}: ${labels[change.field].lv}${change.workType ? " (" + printWorkTitle(change.workType, "lv") + ")" : ""} ${change.before ?? "nav norādīts"} → ${change.after}.`,
        en: `${name}: ${labels[change.field].en}${change.workType ? " (" + printWorkTitle(change.workType, "en") + ")" : ""} ${change.before ?? "unspecified"} → ${change.after}.` };
    });
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

function unique(notices: SimulationNotice[]): SimulationNotice[] {
  return [...new Map(notices.map((notice) => [notice.lv, notice])).values()];
}

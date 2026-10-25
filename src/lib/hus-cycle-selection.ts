import type { SowingPlanRow } from "./types";

export function husCyclePhase(row: SowingPlanRow, today: string): "current" | "future" | "finished" {
  if (row.status === "done" || row.harvestDate < today) return "finished";
  return row.sowingDate > today ? "future" : "current";
}

/** Current cycles first, then nearest future, then most recently finished.
 * Overlapping current cycles remain visible; the latest started is primary.
 * ISO local dates keep the sowing and harvest day inclusive.
 */
export function orderHusCycles(rows: SowingPlanRow[], mode: "active" | "archive", today: string): SowingPlanRow[] {
  const rank = { current: 0, future: 1, finished: 2 };
  return rows.slice().sort((a, b) => {
    if (mode === "archive") return (b.archivedAt ?? "").localeCompare(a.archivedAt ?? "") || a.id.localeCompare(b.id);
    const phaseA = husCyclePhase(a, today), phaseB = husCyclePhase(b, today);
    return rank[phaseA] - rank[phaseB]
      || (phaseA === "future" ? a.sowingDate.localeCompare(b.sowingDate)
        : phaseA === "current" ? b.sowingDate.localeCompare(a.sowingDate)
        : b.harvestDate.localeCompare(a.harvestDate))
      || a.id.localeCompare(b.id);
  });
}

import { calculateMoveOutDate, DEFAULT_WORKER_EXTRA } from "./hus-templates";
import { localTodayIso } from "./planning";
import { PLANTS_PER_BOX } from "./production-defaults";
import type { SowingPlanDraft } from "./types";

export function createSowingDraft(today = localTodayIso()): SowingPlanDraft {
  return { sectorName: "", greenhouseRequiredPlants: "", requiredPlants: "3400",
    extraPlants: String(DEFAULT_WORKER_EXTRA), variety: "", sowingTables: "",
    sowingDate: today, harvestDate: calculateMoveOutDate(today, 22), cycleLength: "22",
    cycleMode: "length", sectorType: 26, plantsPerBox: String(PLANTS_PER_BOX) };
}

/** Midnight may refresh an untouched form, never dates or quantities the user has started editing. */
export function refreshUntouchedSowingDraft(draft: SowingPlanDraft, previousToday: string, today: string): SowingPlanDraft {
  const previous = createSowingDraft(previousToday);
  return Object.keys(previous).every(key => draft[key as keyof SowingPlanDraft] === previous[key as keyof SowingPlanDraft])
    ? createSowingDraft(today) : draft;
}

/** Recheck on return from a suspended/background tab as well as at local midnight (including DST). */
export function observeLocalDay(onChange: (today: string, previous: string) => void): () => void {
  let day = localTodayIso();
  let timer: ReturnType<typeof setTimeout>;
  function check() {
    const current = localTodayIso();
    if (current !== day) { const previous = day; day = current; onChange(current, previous); }
    clearTimeout(timer);
    const midnight = new Date();
    midnight.setHours(24, 0, 0, 20);
    timer = setTimeout(check, Math.max(1, midnight.getTime() - Date.now()));
  }
  window.addEventListener("focus", check);
  document.addEventListener("visibilitychange", check);
  check();
  return () => { clearTimeout(timer); window.removeEventListener("focus", check); document.removeEventListener("visibilitychange", check); };
}

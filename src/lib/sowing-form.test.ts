import { afterEach, describe, expect, it, vi } from "vitest";
import { createSowingDraft, observeLocalDay, refreshUntouchedSowingDraft } from "./sowing-form";
import { applyHusTemplateToDraft, updateDraftSowingDate } from "./hus-templates";
import { localTodayIso, calculateBoxPlan } from "./planning";
import { demoPlanRows, plannerConfig } from "./demo-data";
import { loadPlanRowsFromStorage } from "./storage";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("fresh form defaults", () => {
  it("creates each new form with today's local date and the same inclusive 22-day cycle", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 19, 23, 59));
    expect(createSowingDraft()).toMatchObject({ sowingDate: "2026-11-19", harvestDate: "2026-12-10", extraPlants: "100", plantsPerBox: "12" });
    vi.setSystemTime(new Date(2026, 10, 20, 0, 1));
    expect(createSowingDraft()).toMatchObject({ sowingDate: "2026-11-20", harvestDate: "2026-12-11" });
  });
  it("refreshes only an untouched form, retaining deliberately edited dates, counts, names and cycles", () => {
    const original=createSowingDraft("2026-11-19");
    expect(refreshUntouchedSowingDraft(original, "2026-11-19", "2026-11-20")).toEqual(createSowingDraft("2026-11-20"));
    const drafts = [applyHusTemplateToDraft(original, "Hus 8A"), updateDraftSowingDate(original,"2026-11-18"),
      { ...original, extraPlants: "144" }, { ...original, cycleLength: "23" }];
    drafts.forEach(draft => expect(refreshUntouchedSowingDraft(draft,"2026-11-19","2026-11-20")).toBe(draft));
    expect(original.sowingDate).toBe("2026-11-19");
  });
  it("updates at midnight and on waking a suspended tab, then removes its timer and listeners", () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026,10,19,23,59,59));
    const win=new EventTarget(), doc=new EventTarget(), changed=vi.fn();
    vi.stubGlobal("window",win); vi.stubGlobal("document",doc);
    const stop=observeLocalDay(changed);
    vi.advanceTimersByTime(1100);
    expect(changed).toHaveBeenLastCalledWith("2026-11-20","2026-11-19");
    vi.setSystemTime(new Date(2026,10,22,8));
    doc.dispatchEvent(new Event("visibilitychange"));
    expect(changed).toHaveBeenLastCalledWith("2026-11-22","2026-11-20");
    expect(localTodayIso()).toBe("2026-11-22");
    stop(); expect(vi.getTimerCount()).toBe(0);
    vi.setSystemTime(new Date(2026,10,23,8)); win.dispatchEvent(new Event("focus"));
    expect(changed).toHaveBeenCalledTimes(2);
  });
  it("uses 12 plants per box for new defaults and keeps existing 144-extra and archived values", () => {
    expect(plannerConfig.defaultPlantsPerBox).toBe(12);
    expect(demoPlanRows[0].extraPlants).toBe(100);
    const old={ ...demoPlanRows[0], id:"historical", extraPlants:144, plantsPerBox:30,
      archivedAt:"2026-11-01T00:00:00Z" };
    const json=JSON.stringify({ version:2, rows:[old] }); const setItem=vi.fn();
    vi.stubGlobal("window", { localStorage:{getItem:()=>json,setItem,removeItem:vi.fn()} });
    const [loaded]=loadPlanRowsFromStorage();
    expect(loaded).toMatchObject({ extraPlants:144, plantsPerBox:30 });
    expect(JSON.parse(json).rows[0]).toEqual(old);
    expect(setItem).toHaveBeenCalledExactlyOnceWith("cucumber-planner:storage-test","1");
    expect(calculateBoxPlan({ ...loaded, requiredPlants:120, extraPlants:0, correction:0 }).totalBoxes).toBe(10);
  });
});

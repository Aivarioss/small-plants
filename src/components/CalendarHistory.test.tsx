import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { buildCalendarHistory } from "@/lib/calendar-history";
import { plannerConfig } from "@/lib/demo-data";
import { buildArchiveSnapshot } from "@/lib/planning";
import type { SowingPlanRow, ViewMode } from "@/lib/types";
import { CalendarPanel, DayDetails, MonthlyPrintPlan } from "./PlannerApp";

const row: SowingPlanRow = {
  id: "old-cycle", sectorName: "Hus 4", requiredPlants: 3400, extraPlants: 144,
  variety: "Baltazsara", sowingDate: "2026-09-22", harvestDate: "2026-10-14",
  cycleLength: 23, sectorType: 26, plantsPerBox: 30, correction: 0,
};
const archivedAt = "2026-10-15T12:00:00Z";
const archived = { ...row, archivedAt, archiveSnapshot: buildArchiveSnapshot(row, [row], plannerConfig, archivedAt) };
const historicalThinning = archived.archiveSnapshot.workItems.find((item) => item.type === "thinning")!;
const selectedDate = historicalThinning.date;
const model = buildCalendarHistory([], [], [archived], "2026-10-18");
const noop = () => {};

describe("calendar history UI", () => {
  it.each(["lv", "en"] as const)("shows archived work read-only without move controls (%s)", (language) => {
    const onMove = vi.fn();
    const onMoveRange = vi.fn();
    const items = model.items.filter((item) => item.date === selectedDate);
    const html = renderToStaticMarkup(<DayDetails errors={{ [historicalThinning.id]: "Old error" }} items={items}
      onMove={onMove} onMoveRange={onMoveRange} rows={model.rows} selectedDate={selectedDate} language={language} />);
    expect(html).toContain(language === "lv" ? "Arhivēts HUS" : "Archived HUS");
    expect(html).toContain(language === "lv" ? "Tikai lasīšanai" : "Read-only");
    expect(html).toContain("22.09.–14.10.");
    expect(html).not.toContain("<input");
    expect(html).not.toContain("Old error");
    expect(html).not.toContain("overload-badge");
    expect(onMove).not.toHaveBeenCalled();
    expect(onMoveRange).not.toHaveBeenCalled();
  });

  it.each(["window", "flexible"] as const)("retains %s move controls for future active work, but not for past work", (scheduleKind) => {
    const activeItem = { ...historicalThinning, scheduleKind, fixed: false, date: "2026-10-20" };
    const activeModel = buildCalendarHistory([activeItem], [row], [], "2026-10-18");
    const render = (items: typeof activeModel.items) => renderToStaticMarkup(<DayDetails errors={{}} items={items}
      onMove={noop} onMoveRange={noop} rows={[row]} selectedDate={items[0].date} />);
    expect(render(activeModel.items)).toContain('type="date"');
    const past = buildCalendarHistory([{ ...activeItem, date: "2026-10-17" }], [row], [], "2026-10-18");
    expect(render(past.items)).not.toContain("<input");
  });

  it.each(["month", "tenDays"] as ViewMode[])("shows historical entries and a visible print button without old menu or warning outlines (%s)", (viewMode) => {
    const html = renderToStaticMarkup(<CalendarPanel anchorDate={selectedDate}
      calendarDays={[{ isoDate: selectedDate, dayNumber: Number(selectedDate.slice(-2)), inCurrentRange: true }]}
      onSelectDate={noop} onSetAnchorDate={noop} onSetViewMode={noop} selectedDate={selectedDate}
      viewMode={viewMode} workItems={model.items} />);
    expect(html).toContain('class="calendar-print-button"');
    expect(html).toContain("Printēt darba plānu");
    expect(html).toContain("Arhīvs · ");
    expect(html).toContain("calendar-history-item");
    expect(html).not.toContain("<details");
    expect(html).not.toContain("Plāna darbības");
    expect(html).not.toContain("capacity-alerts");
    expect(html).not.toContain("has-capacity-warning");
    expect(html).not.toContain("is-overloaded");
  });

  it("shows a localized explanation when an old archive has no stored work history", () => {
    const html = renderToStaticMarkup(<CalendarPanel anchorDate={selectedDate} calendarDays={[]} language="en"
      missingHistoryRows={[archived]} onSelectDate={noop} onSetAnchorDate={noop} onSetViewMode={noop}
      selectedDate={selectedDate} viewMode="month" workItems={[]} />);
    expect(html).toContain("Complete work history is unavailable for: ");
    expect(html).toContain("Hus 4");
    expect(html).toContain("Print work plan");
  });

  it.each(["lv", "en"] as const)("includes and labels the frozen archive work in the printed calendar (%s)", (language) => {
    const html = renderToStaticMarkup(<MonthlyPrintPlan onStartChange={noop} archivedRowIds={[row.id]}
      printLanguage={language} rows={model.rows} startDate="2026-09-01" workItems={model.items} />);
    expect(html).toContain(language === "lv" ? "Arhīvs · Vēsturiskais plāns" : "Archive · Historical plan");
    expect(html).toContain("Hus 4");
    expect(html).toContain("22.09.");
    expect(html).toContain("14.10.");
  });
});

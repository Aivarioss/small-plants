import { describe, expect, it } from "vitest";
import { husCyclePhase, orderHusCycles } from "./hus-cycle-selection";
import type { SowingPlanRow } from "./types";
const cycle = (id: string, sowingDate: string, harvestDate: string, extra: Partial<SowingPlanRow> = {}) =>
  ({ id, sowingDate, harvestDate, ...extra }) as SowingPlanRow;
const today = "2026-10-24";
describe("HUS primary cycle", () => {
  it("selects the current cycle ahead of later future cycles regardless of input order", () => {
    const current = cycle("current", "2026-10-10", "2026-11-01");
    const rows = [cycle("far", "2027-01-01", "2027-02-01"), current, cycle("next", "2026-11-02", "2026-11-24")];
    expect(orderHusCycles(rows, "active", today).map((row) => row.id)).toEqual(["current", "next", "far"]);
    expect(rows[0].id).toBe("far");
    expect(orderHusCycles(rows.toReversed(), "active", today)[0]).toBe(current);
  });
  it("uses nearest future if none is current and keeps past cycles last", () => {
    const rows = [cycle("far", "2027-01-01", "2027-02-01"), cycle("past", "2026-09-01", "2026-10-23"), cycle("next", "2026-11-01", "2026-11-23")];
    expect(orderHusCycles(rows, "active", today).map((row) => row.id)).toEqual(["next", "far", "past"]);
  });
  it("keeps both overlapping current cycles with the latest started primary", () => {
    const rows = [cycle("first", "2026-10-01", "2026-10-25"), cycle("second", "2026-10-10", "2026-11-01")];
    expect(orderHusCycles(rows, "active", today).map((row) => row.id)).toEqual(["second", "first"]);
    expect(rows.map((row) => husCyclePhase(row, today))).toEqual(["current", "current"]);
  });
  it("includes sowing and harvest day but excludes explicitly completed cycles", () => {
    expect(husCyclePhase(cycle("sow", today, "2026-11-01"), today)).toBe("current");
    expect(husCyclePhase(cycle("harvest", "2026-10-01", today), today)).toBe("current");
    expect(husCyclePhase(cycle("done", today, "2026-11-01", { status: "done" }), today)).toBe("finished");
  });
  it("uses most recently completed cycle when all are past", () => {
    expect(orderHusCycles([cycle("old", "2026-09-01", "2026-09-23"), cycle("recent", "2026-10-01", "2026-10-23")], "active", today)[0].id).toBe("recent");
  });
  it("keeps archive ordered by archive timestamp and breaks ties deterministically", () => {
    const a = cycle("a", "2026-01-01", "2026-02-01", { archivedAt: "2026-10-23T12:00:00Z" });
    const b = cycle("b", "2026-09-01", "2026-10-01", { archivedAt: "2026-10-22T12:00:00Z" });
    expect(orderHusCycles([b, a], "archive", today)).toEqual([a, b]);
    expect(orderHusCycles([{ ...a, id: "z" }, a], "archive", today)[0]).toBe(a);
    expect(orderHusCycles([], "active", today)).toEqual([]);
  });
});

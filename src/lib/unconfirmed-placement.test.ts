import { describe, expect, it, vi } from "vitest";
import { unconfirmedPlacementScenario } from "./__fixtures__/unconfirmed-placement-scenario";
import { plannerConfig } from "./demo-data";
import { buildGreenhouseOccupancyDay, growingTableSelectionRows, interpretHusMovingEventPlacement, resetFuturePlacementRows } from "./greenhouse-simulation";
import { simulateGreenhouseSowing } from "./greenhouse-sowing-simulator";
import { simulateJointSowingPlan } from "./joint-greenhouse-simulation";
import { applyHusEventDelete, applyHusEventSave, parseHusEventMovementRows, serializeHusEventMovementRows } from "./planning";
import { rowPlacementToRecord } from "./supabase/mappers";
import { withHouseThinningPlacement } from "./greenhouse-work-placement";
import { generateWorkItemsForRows } from "./planning";
import { localizedWorkDetails } from "./localization";

describe("only actual Moving fixes a greenhouse row", () => {
  it.each([true, false, undefined])("finds the full row rotation without editing a legacy C estimate (manual=%s)", (manual) => {
    const rows = unconfirmedPlacementScenario();
    rows[8].placement!.manual = manual;
    const before = structuredClone(rows);
    const result = simulateJointSowingPlan({ rows, config: plannerConfig, asOfDate: "2026-10-18",
      sowingChanges: [{ planRowId: "HUS 8A", sowingDate: "2026-10-18" }], recalculateFuturePlacements: true, allowOtherSowingChanges: false });
    const plan = result.plans[0];
    expect(plan, JSON.stringify(result.conflicts)).toBeDefined();
    expect(plan.proposals.slice(0, 6).map((p) => [p.planRowId, p.wateringZone, p.thinningDate])).toEqual([
      ["HUS 8A", "C", "2026-10-27"], ["HUS 8B", "B", "2026-10-29"], ["HUS 3", "D", "2026-11-05"],
      ["HUS 2N", "C", "2026-11-12"], ["HUS 2S", "B", "2026-11-14"], ["HUS 1", "D", "2026-11-19"],
    ]);
    expect(plan.proposals.find((p) => p.planRowId === "HUS 1")).toMatchObject({ physicalTables: 34, placementKind: "largeWithExtra" });
    expect(plan.score.emergencyDays).toBe(0);
    expect(result.search.truncated).toBe(false);
    expect(plan.occupancy.at(-1)?.date).toBe("2026-12-23");
    expect(plan.occupancy.every((d) => !d.growing.overCapacity && !d.seeding.overCapacity)).toBe(true);
    expect(rows).toEqual(before);
    expect(result.originalRowsUnchanged).toBe(true);
  });

  it("uses the same correction in the single-HUS UI facade without network or storage writes", () => {
    const rows = unconfirmedPlacementScenario();
    const write = vi.fn(() => { throw Error("No persistence"); });
    vi.stubGlobal("fetch", write);
    vi.stubGlobal("localStorage", { setItem: write, removeItem: write });
    try {
      const result = simulateGreenhouseSowing(rows, plannerConfig, "HUS 8A", "2026-10-18", "2026-10-18");
      expect(result.recommendation).toMatchObject({ wateringZone: "C", thinningDate: "2026-10-27", cycleDay: 10 });
      expect(result.scenarioRows.find((r) => r.id === "HUS 1")?.placement?.primaryRow).toBe("D");
      expect(write).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });

  it("ignores an unconfirmed row in house occupancy, but preserves actual and archived records", () => {
    const rows = unconfirmedPlacementScenario();
    const before = structuredClone(rows);
    const day = buildGreenhouseOccupancyDay(rows, plannerConfig, "2026-11-19");
    expect(day.growing.rows.find((r) => r.planRowId === "HUS 1")).toMatchObject({ primaryRow: "D", placementSource: "planned" });
    rows[0].archivedAt = "2026-10-22";
    rows[1].placement = { primaryRow: "C", manual: true }; // obsolete estimate; actual B+A wins
    const reset = resetFuturePlacementRows(rows, new Set(rows.map((r) => r.id)));
    expect(reset.slice(0, 3)).toEqual(rows.slice(0, 3));
    expect(reset[8].placement).toMatchObject({ primaryRow: undefined, manual: false });
    expect(before[8].placement).toEqual({ primaryRow: "C", manual: true });
    const actual = buildGreenhouseOccupancyDay(rows, plannerConfig, "2026-10-18").growing.rows.find((r) => r.planRowId === "HUS 7")!;
    expect(actual.actualTableIds).toHaveLength(39);
    expect(actual.actualTableIds?.every((t) => t.startsWith("A") || t.startsWith("B"))).toBe(true);
  });

  it.each([
    ["A14–A26", ["A"]], ["b1-b24", ["B"]], ["C1 - C26", ["C"]], ["D1–D24", ["D"]],
    ["D1–D26, A14–A21", ["A", "D"]], ["A1–A13", []], ["B1–B27", []], ["C1–D4", []],
    ["C1–C10 unknown", []], ["C", []], ["", []],
  ])("derives only known actual row letters from %s", (value, expected) => {
    expect(growingTableSelectionRows(value as string)).toEqual(expected);
  });

  it("round-trips Moving rows without creating a separate placement lock", () => {
    const row = unconfirmedPlacementScenario()[8];
    const movementRows = [{ from: "A1", to: "D1–D10" }, { from: "A2", to: "A14–A21" }];
    const event = { id: "moving", eventType: "move" as const, eventDate: "2026-11-19", ...serializeHusEventMovementRows(movementRows) };
    const saved = { ...row, ...applyHusEventSave(row, event) };
    expect(parseHusEventMovementRows(saved.husEvents![0])).toEqual(movementRows);
    expect(interpretHusMovingEventPlacement(saved.husEvents![0])?.tableIds).toHaveLength(18);
    expect(saved.placement).toEqual(row.placement);
    expect({ ...saved, ...applyHusEventDelete(saved, event.id) }.placement).toEqual(row.placement);
    expect(interpretHusMovingEventPlacement({ ...event, destinationLocation: "D1–D10 unknown" })?.warnings).not.toEqual([]);
    expect(rowPlacementToRecord({ ...row, placement: { primaryRow: "C" } })?.manual).toBe(false);
  });

  it("shows actual A/B rows and 39 tables in thinning work details in both languages", () => {
    const rows = unconfirmedPlacementScenario();
    rows[1].placement = { primaryRow: "C", tables: 26, manual: true };
    const before = structuredClone(rows);
    const work = withHouseThinningPlacement(generateWorkItemsForRows(rows, plannerConfig), rows, plannerConfig);
    const moving = work.find((item) => item.type === "thinning" && item.planRowId === "HUS 7")!;
    expect(moving.placement).toMatchObject({ rowIds: ["A", "B"], primaryRow: "B", tables: 39, thinningDate: "2026-10-15" });
    expect(localizedWorkDetails(moving, rows[1], "lv").some((line) => line.includes("Rinda A, B — 39 galdi"))).toBe(true);
    expect(localizedWorkDetails(moving, rows[1], "en").some((line) => line.includes("Row A, B · 39 tables"))).toBe(true);
    expect(rows).toEqual(before);
  });
});

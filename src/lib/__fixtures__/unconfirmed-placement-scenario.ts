import { calculateMoveOutDate } from "../hus-templates";
import type { SowingPlanRow } from "../types";

/** Reproduction of the October/November row handovers, without production IDs. */
export function unconfirmedPlacementScenario(): SowingPlanRow[] {
  const data: Array<[string, string, number]> = [
    ["HUS 6", "2026-09-29", 3556], ["HUS 7", "2026-10-06", 6057], ["HUS 9", "2026-10-08", 3707],
    ["HUS 8A", "2026-10-20", 3457], ["HUS 8B", "2026-10-22", 4155], ["HUS 3", "2026-10-27", 3744],
    ["HUS 2N", "2026-11-03", 3588], ["HUS 2S", "2026-11-05", 3551], ["HUS 1", "2026-11-10", 4947],
    ["HUS 10B", "2026-11-17", 3584], ["HUS 10A", "2026-11-19", 4195], ["HUS 11", "2026-11-24", 3603],
    ["HUS 4", "2026-12-01", 3819],
  ];
  const rows = data.map(([name, sowingDate, requiredPlants]): SowingPlanRow => ({
    id: name, sectorName: name, sowingDate, harvestDate: calculateMoveOutDate(sowingDate, 23), cycleLength: 23,
    requiredPlants, extraPlants: 100, variety: "Synthetic", sectorType: requiredPlants > 4500 ? 39 : 26,
    plantsPerBox: 30, correction: 0, status: "planned", source: "user", husEvents: [],
  }));
  const actual: Array<[number, string, string, string]> = [
    [0, "2026-10-08", "A5–A7", "C1–C24"],
    [1, "2026-10-15", "A9–A13", "B1–B26, A14–A26"],
    [2, "2026-10-17", "A3–A4, A8", "D1–D24"],
  ];
  for (const [index, eventDate, source, destination] of actual) {
    rows[index].sowingTables = source;
    rows[index].husEvents = [{ id: `moving-${index}`, eventType: "move", eventDate, location: source, destinationLocation: destination }];
  }
  const dates: Array<[number, string, string, string]> = [
    [0, "2026-10-08", "2026-10-18", "2026-10-19"], [1, "2026-10-15", "2026-10-22", "2026-10-23"],
    [2, "2026-10-17", "2026-10-24", "2026-10-25"], [5, "2026-11-05", "2026-11-15", "2026-11-16"],
    [6, "2026-11-12", "2026-11-20", "2026-11-21"], [7, "2026-11-14", "2026-11-22", "2026-11-23"],
    [9, "2026-11-26", "2026-12-04", "2026-12-05"], [10, "2026-11-28", "2026-12-06", "2026-12-07"],
    [11, "2026-12-03", "2026-12-12", "2026-12-13"], [12, "2026-12-10", "2026-12-17", "2026-12-18"],
  ];
  for (const [index, thinning, sideShoots, sticks] of dates) {
    rows[index].adjustments = { thinning, sideShoots, sticks };
    rows[index].adjustmentSources = { thinning: "optimizer", sideShoots: "optimizer", sticks: "optimizer" };
  }
  rows[8].placement = { primaryRow: "C", manual: true };
  return rows;
}

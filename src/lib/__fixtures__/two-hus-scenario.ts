import type { SowingPlanRow } from "../types";

/** Synthetic counts and Moving sources; these are not live Supabase records.
 * Release dates/rows and the requested dates follow the user's scenario. */
export function twoHusScenario(): SowingPlanRow[] {
  const hus = (id: string, sowingDate: string, harvestDate: string): SowingPlanRow => ({
    id, sectorName: id, sowingDate, harvestDate, cycleLength: 23, requiredPlants: 3900,
    extraPlants: 0, variety: "Synthetic", sectorType: 26, plantsPerBox: 12, correction: 0, source: "user",
  });
  const actual = (id: string, sow: string, move: string, planting: string, destinationLocation: string) => ({
    ...hus(id, sow, planting), sowingTables: "A1–A6",
    husEvents: [{ id: id + "-move", eventType: "move" as const, eventDate: move, location: "A1–A6", destinationLocation }],
  });
  return [
    { ...hus("HUS 8A", "2026-10-20", "2026-11-11"), adjustments: { thinning: "2026-10-28" }, placement: { primaryRow: "B", tables: 26, manual: true } },
    { ...hus("HUS 8B", "2026-10-20", "2026-11-13"), adjustments: { thinning: "2026-10-27" }, placement: { primaryRow: "C", tables: 26, manual: true } },
    actual("HUS 6", "2026-09-29", "2026-10-07", "2026-10-21", "C1–C24"),
    actual("HUS 7", "2026-10-06", "2026-10-14", "2026-10-28", "B1–B26\nA14–A26"),
    actual("HUS 9", "2026-10-07", "2026-10-15", "2026-10-30", "D1–D26"),
  ];
}

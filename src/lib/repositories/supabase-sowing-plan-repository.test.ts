import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseSowingPlanRepository } from "./supabase-sowing-plan-repository";
import { createSupabaseServerClient } from "@/lib/supabase/server";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

const baseRecord = {
  id: "11111111-1111-4111-8111-111111111111",
  hus: "Hus 4",
  greenhouse_required_plants: null,
  required_plants: 3700,
  extra_plants: 100,
  variety: "Baltazsara",
  week_number: null,
  sowing_tables: null,
  sowing_date: "2026-10-01",
  move_out_date: "2026-10-22",
  previcure_date: null,
  cycle_length: 22,
  sector_type: 26,
  correction: 0,
  status: "planned",
  source: "user",
  updated_at: "2026-10-01T00:00:00.000Z",
};

describe("supabase sowing plan repository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("loads existing rows when plant_corrections relation is not available yet", async () => {
    const client = {
      from: vi
        .fn()
        .mockReturnValueOnce(selectOrderResult({
          data: null,
          error: {
            code: "PGRST200",
            message: "Could not find a relationship between 'sowing_plan_rows' and 'plant_corrections' in the schema cache",
          },
        }))
        .mockReturnValueOnce(selectOrderResult({
          data: [{ ...baseRecord, work_adjustments: [], table_placements: [], change_history: [] }],
          error: null,
        })),
    };
    vi.mocked(createSupabaseServerClient).mockReturnValue(client as never);

    const rows = await createSupabaseSowingPlanRepository().load();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: baseRecord.id,
      plantCorrections: [],
      sectorName: "Hus 4",
    });
    expect(client.from).toHaveBeenCalledTimes(2);
  });

  it("does not turn non-relation load errors into an empty plan", async () => {
    const client = {
      from: vi.fn().mockReturnValueOnce(selectOrderResult({
        data: null,
        error: {
          code: "42501",
          message: "permission denied",
        },
      })),
    };
    vi.mocked(createSupabaseServerClient).mockReturnValue(client as never);

    await expect(createSupabaseSowingPlanRepository().load()).rejects.toMatchObject({
      message: "permission denied",
    });
    expect(client.from).toHaveBeenCalledTimes(1);
  });
});

function selectOrderResult(result: unknown) {
  return {
    select: vi.fn().mockReturnValue({
      order: vi.fn().mockResolvedValue(result),
    }),
  };
}

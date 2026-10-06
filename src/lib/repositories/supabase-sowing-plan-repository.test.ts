import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseSowingPlanRepository, SowingPlanConflictError } from "./supabase-sowing-plan-repository";
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

  it("round-trips plant corrections when updating a row", async () => {
    const plantCorrectionsUpsert = upsertResult();
    const client = {
      from: vi
        .fn()
        .mockReturnValueOnce(versionCheckResult(baseRecord.updated_at))
        .mockReturnValueOnce(updateResult({ id: baseRecord.id }))
        .mockReturnValueOnce(deleteResult())
        .mockReturnValueOnce(deleteResult())
        .mockReturnValueOnce(deleteResult())
        .mockReturnValueOnce(plantCorrectionsUpsert)
        .mockReturnValueOnce(selectSingleByIdResult({
          ...baseRecord,
          work_adjustments: [],
          table_placements: [],
          change_history: [],
          plant_corrections: [
            {
              id: "22222222-2222-4222-8222-222222222222",
              sowing_plan_row_id: baseRecord.id,
              correction_date: "2026-10-08",
              amount: -300,
              reason: "thinning",
              note: null,
            },
          ],
        })),
    };
    vi.mocked(createSupabaseServerClient).mockReturnValue(client as never);

    const row = await createSupabaseSowingPlanRepository().update({
      id: baseRecord.id,
      updatedAt: baseRecord.updated_at,
      sectorName: baseRecord.hus,
      requiredPlants: baseRecord.required_plants,
      extraPlants: baseRecord.extra_plants,
      variety: baseRecord.variety,
      sowingDate: baseRecord.sowing_date,
      harvestDate: baseRecord.move_out_date,
      cycleLength: baseRecord.cycle_length,
      sectorType: 26,
      plantsPerBox: 12,
      correction: 0,
      plantCorrections: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          amount: -300,
          date: "2026-10-08",
          reason: "thinning",
        },
      ],
    }, baseRecord.updated_at);

    expect(plantCorrectionsUpsert.upsert).toHaveBeenCalledWith(
      [
        {
          id: "22222222-2222-4222-8222-222222222222",
          sowing_plan_row_id: baseRecord.id,
          correction_date: "2026-10-08",
          amount: -300,
          reason: "thinning",
          note: null,
        },
      ],
      { onConflict: "id" },
    );
    expect(row.plantCorrections).toEqual([
      {
        id: "22222222-2222-4222-8222-222222222222",
        amount: -300,
        date: "2026-10-08",
        reason: "thinning",
      },
    ]);
  });

  it("accepts equivalent updated_at timestamps and uses the current database token for the update", async () => {
    const databaseUpdatedAt = "2026-10-01T00:00:00+00:00";
    const update = updateResult({ id: baseRecord.id });
    const client = {
      from: vi
        .fn()
        .mockReturnValueOnce(versionCheckResult(databaseUpdatedAt))
        .mockReturnValueOnce(update)
        .mockReturnValueOnce(deleteResult())
        .mockReturnValueOnce(deleteResult())
        .mockReturnValueOnce(deleteResult())
        .mockReturnValueOnce(upsertResult())
        .mockReturnValueOnce(selectSingleByIdResult({
          ...baseRecord,
          updated_at: "2026-10-01T00:00:01.000Z",
          work_adjustments: [],
          table_placements: [],
          change_history: [],
          plant_corrections: [
            {
              id: "22222222-2222-4222-8222-222222222222",
              sowing_plan_row_id: baseRecord.id,
              correction_date: "2026-10-08",
              amount: -100,
              reason: "thinning",
              note: null,
            },
          ],
        })),
    };
    vi.mocked(createSupabaseServerClient).mockReturnValue(client as never);

    const row = await createSupabaseSowingPlanRepository().update({
      id: baseRecord.id,
      updatedAt: baseRecord.updated_at,
      sectorName: baseRecord.hus,
      requiredPlants: baseRecord.required_plants,
      extraPlants: baseRecord.extra_plants,
      variety: baseRecord.variety,
      sowingDate: baseRecord.sowing_date,
      harvestDate: baseRecord.move_out_date,
      cycleLength: baseRecord.cycle_length,
      sectorType: 26,
      plantsPerBox: 12,
      correction: 0,
      plantCorrections: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          amount: -100,
          date: "2026-10-08",
          reason: "thinning",
        },
      ],
    }, baseRecord.updated_at);

    expect(update.builder.eq).toHaveBeenCalledWith("updated_at", databaseUpdatedAt);
    expect(row.updatedAt).toBe("2026-10-01T00:00:01.000Z");
    expect(row.plantCorrections?.[0]?.amount).toBe(-100);
  });

  it("allows a second correction edit when the client uses the server-returned updated_at", async () => {
    const firstUpdate = updateResult({ id: baseRecord.id });
    const secondUpdate = updateResult({ id: baseRecord.id });
    const firstSavedRecord = {
      ...baseRecord,
      updated_at: "2026-10-01T00:00:01.000Z",
      work_adjustments: [],
      table_placements: [],
      change_history: [],
      plant_corrections: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          sowing_plan_row_id: baseRecord.id,
          correction_date: "2026-10-08",
          amount: -100,
          reason: "thinning",
          note: null,
        },
      ],
    };
    const secondSavedRecord = {
      ...firstSavedRecord,
      updated_at: "2026-10-01T00:00:02.000Z",
      plant_corrections: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          sowing_plan_row_id: baseRecord.id,
          correction_date: "2026-10-08",
          amount: -150,
          reason: "thinning",
          note: null,
        },
      ],
    };
    const client = {
      from: vi
        .fn()
        .mockReturnValueOnce(versionCheckResult(baseRecord.updated_at))
        .mockReturnValueOnce(firstUpdate)
        .mockReturnValueOnce(deleteResult())
        .mockReturnValueOnce(deleteResult())
        .mockReturnValueOnce(deleteResult())
        .mockReturnValueOnce(upsertResult())
        .mockReturnValueOnce(selectSingleByIdResult(firstSavedRecord))
        .mockReturnValueOnce(versionCheckResult(firstSavedRecord.updated_at))
        .mockReturnValueOnce(secondUpdate)
        .mockReturnValueOnce(deleteResult())
        .mockReturnValueOnce(deleteResult())
        .mockReturnValueOnce(deleteResult())
        .mockReturnValueOnce(upsertResult())
        .mockReturnValueOnce(selectSingleByIdResult(secondSavedRecord)),
    };
    vi.mocked(createSupabaseServerClient).mockReturnValue(client as never);

    const repository = createSupabaseSowingPlanRepository();
    const firstSavedRow = await repository.update({
      id: baseRecord.id,
      updatedAt: baseRecord.updated_at,
      sectorName: baseRecord.hus,
      requiredPlants: baseRecord.required_plants,
      extraPlants: baseRecord.extra_plants,
      variety: baseRecord.variety,
      sowingDate: baseRecord.sowing_date,
      harvestDate: baseRecord.move_out_date,
      cycleLength: baseRecord.cycle_length,
      sectorType: 26,
      plantsPerBox: 12,
      correction: 0,
      plantCorrections: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          amount: -100,
          date: "2026-10-08",
          reason: "thinning",
        },
      ],
    }, baseRecord.updated_at);

    const secondSavedRow = await repository.update({
      ...firstSavedRow,
      plantCorrections: [
        {
          id: "22222222-2222-4222-8222-222222222222",
          amount: -150,
          date: "2026-10-08",
          reason: "thinning",
        },
      ],
    }, firstSavedRow.updatedAt);

    expect(firstSavedRow.updatedAt).toBe(firstSavedRecord.updated_at);
    expect(secondSavedRow.updatedAt).toBe(secondSavedRecord.updated_at);
    expect(secondSavedRow.plantCorrections?.[0]?.amount).toBe(-150);
  });

  it("still rejects a genuinely stale updated_at token", async () => {
    const client = {
      from: vi.fn().mockReturnValueOnce(versionCheckResult("2026-10-01T00:00:01.000Z")),
    };
    vi.mocked(createSupabaseServerClient).mockReturnValue(client as never);

    await expect(createSupabaseSowingPlanRepository().update({
      id: baseRecord.id,
      updatedAt: baseRecord.updated_at,
      sectorName: baseRecord.hus,
      requiredPlants: baseRecord.required_plants,
      extraPlants: baseRecord.extra_plants,
      variety: baseRecord.variety,
      sowingDate: baseRecord.sowing_date,
      harvestDate: baseRecord.move_out_date,
      cycleLength: baseRecord.cycle_length,
      sectorType: 26,
      plantsPerBox: 12,
      correction: 0,
      plantCorrections: [],
    }, baseRecord.updated_at)).rejects.toBeInstanceOf(SowingPlanConflictError);

    expect(client.from).toHaveBeenCalledTimes(1);
  });

  it("persists plant correction deletion by clearing child rows without inserting replacements", async () => {
    const plantCorrectionsDelete = deleteResult();
    const client = {
      from: vi
        .fn()
        .mockReturnValueOnce(versionCheckResult(baseRecord.updated_at))
        .mockReturnValueOnce(updateResult({ id: baseRecord.id }))
        .mockReturnValueOnce(deleteResult())
        .mockReturnValueOnce(deleteResult())
        .mockReturnValueOnce(plantCorrectionsDelete)
        .mockReturnValueOnce(selectSingleByIdResult({
          ...baseRecord,
          work_adjustments: [],
          table_placements: [],
          change_history: [],
          plant_corrections: [],
        })),
    };
    vi.mocked(createSupabaseServerClient).mockReturnValue(client as never);

    const row = await createSupabaseSowingPlanRepository().update({
      id: baseRecord.id,
      updatedAt: baseRecord.updated_at,
      sectorName: baseRecord.hus,
      requiredPlants: baseRecord.required_plants,
      extraPlants: baseRecord.extra_plants,
      variety: baseRecord.variety,
      sowingDate: baseRecord.sowing_date,
      harvestDate: baseRecord.move_out_date,
      cycleLength: baseRecord.cycle_length,
      sectorType: 26,
      plantsPerBox: 12,
      correction: 0,
      plantCorrections: [],
    }, baseRecord.updated_at);

    expect(plantCorrectionsDelete.delete).toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalledWith("plant_corrections", expect.objectContaining({ method: "upsert" }));
    expect(row.plantCorrections).toEqual([]);
  });
});

function selectOrderResult(result: unknown) {
  return {
    select: vi.fn().mockReturnValue({
      order: vi.fn().mockResolvedValue(result),
    }),
  };
}

function versionCheckResult(updatedAt: string) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({ data: { updated_at: updatedAt }, error: null }),
      }),
    }),
  };
}

function updateResult(data: unknown) {
  const builder = {
    eq: vi.fn(),
    select: vi.fn(),
  };
  builder.eq.mockReturnValue(builder);
  builder.select.mockReturnValue({
    maybeSingle: vi.fn().mockResolvedValue({ data, error: null }),
  });

  return {
    builder,
    update: vi.fn().mockReturnValue(builder),
  };
}

function deleteResult() {
  const eq = vi.fn().mockResolvedValue({ error: null });
  return {
    delete: vi.fn().mockReturnValue({ eq }),
  };
}

function upsertResult() {
  return {
    upsert: vi.fn().mockResolvedValue({ error: null }),
  };
}

function selectSingleByIdResult(data: unknown) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data, error: null }),
      }),
    }),
  };
}

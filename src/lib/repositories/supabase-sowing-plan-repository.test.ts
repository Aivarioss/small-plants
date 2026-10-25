import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseSowingPlanRepository, loadWorkspaceRowsFromSupabase, SowingPlanConflictError } from "./supabase-sowing-plan-repository";
import { recordToSowingPlanRow } from "@/lib/supabase/mappers";
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
  it("returns non-retryable PT409 field conflicts without reading or writing again", async () => {
    const client = { rpc: vi.fn().mockResolvedValue({ data: null, error: { code: "PT409" } }), from: vi.fn() };
    vi.mocked(createSupabaseServerClient).mockReturnValue(client as never);
    await expect(createSupabaseSowingPlanRepository().update(recordToSowingPlanRow({ ...baseRecord, sector_type: 26, status: "planned", source: "user" }))).rejects.toBeInstanceOf(SowingPlanConflictError);
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.from).not.toHaveBeenCalled();
  });

  it.each(["archive", "restore"] as const)("returns non-retryable PT409 %s conflicts without partial fallback", async operation => {
    const row = { ...baseRecord, archived_at: operation === "restore" ? "2026-10-01T10:00:00Z" : null };
    const client = { rpc: vi.fn().mockResolvedValue({ data: null, error: { code: "PT409" } }), from: vi.fn()
      .mockReturnValueOnce(selectSingleByIdResult(row))
      .mockReturnValueOnce(selectOrderResult({ data: operation === "restore" ? [] : [row], error: null })) };
    vi.mocked(createSupabaseServerClient).mockReturnValue(client as never);
    await expect(createSupabaseSowingPlanRepository()[operation](row.id)).rejects.toBeInstanceOf(SowingPlanConflictError);
    expect(client.rpc).toHaveBeenCalledTimes(1);
    expect(client.from).toHaveBeenCalledTimes(2);
  });
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each(["plant_corrections", "hus_events", "hus_notes", "hus_photos"])("refuses incomplete %s loads rather than exposing empty editable history", async (relation) => {
    const client = { from: vi.fn().mockReturnValue(selectOrderResult({
      data: null, error: { code: "PGRST200", message: `Missing relationship ${relation}` },
    })), rpc: vi.fn() };
    vi.mocked(createSupabaseServerClient).mockReturnValue(client as never);
    await expect(createSupabaseSowingPlanRepository().load()).rejects.toMatchObject({ code: "PGRST200" });
    await expect(createSupabaseSowingPlanRepository().loadArchived()).rejects.toMatchObject({ code: "PGRST200" });
    expect(client.from).toHaveBeenCalledTimes(2);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("does not turn non-relation errors into an empty plan", async () => {
    const client = { from: vi.fn().mockReturnValue(selectOrderResult({ data: null, error: { code: "42501" } })) };
    vi.mocked(createSupabaseServerClient).mockReturnValue(client as never);
    await expect(createSupabaseSowingPlanRepository().load()).rejects.toMatchObject({ code: "42501" });
  });

  it("saves parent, Moving, loss and work dates through one atomic RPC and reloads confirmed state", async () => {
    const stored = { ...baseRecord, updated_at: "2026-10-02T00:00:00Z",
      hus_events: [{ id: "event", event_date: "2026-10-08", event_type: "move", plant_change: -10, plant_correction_id: "loss" }],
      plant_corrections: [{ id: "loss", correction_date: "2026-10-08", amount: -10, reason: "thinning" }],
      work_adjustments: [{ work_type: "thinning", dates: ["2026-10-08"], source: "manual" }],
    };
    const client = { rpc: vi.fn().mockResolvedValue({ data: baseRecord.id, error: null }),
      from: vi.fn().mockReturnValue(selectSingleByIdResult(stored)) };
    vi.mocked(createSupabaseServerClient).mockReturnValue(client as never);
    const row = recordToSowingPlanRow(stored as never);
    const result = await createSupabaseSowingPlanRepository().update(row, baseRecord.updated_at);
    expect(result.updatedAt).toBe(stored.updated_at);
    expect(result.husEvents).toHaveLength(1);
    expect(result.plantCorrections?.[0].amount).toBe(-10);
    expect(client.rpc).toHaveBeenCalledExactlyOnceWith("save_sowing_plan_row", expect.objectContaining({
      p_operation: "update", p_expected_updated_at: baseRecord.updated_at,
      p_hus_events: [expect.objectContaining({ id: "event", plant_correction_id: "loss" })],
      p_plant_corrections: [expect.objectContaining({ id: "loss", amount: -10 })],
      p_work_adjustments: [expect.objectContaining({ work_type: "thinning", dates: ["2026-10-08"] })],
    }));
    expect(client.from).toHaveBeenCalledExactlyOnceWith("sowing_plan_rows");
  });

  it("creates a cycle in the same atomic operation without separate child writes", async () => {
    const client = { rpc: vi.fn().mockResolvedValue({ data: baseRecord.id, error: null }),
      from: vi.fn().mockReturnValue(selectSingleByIdResult(baseRecord)) };
    vi.mocked(createSupabaseServerClient).mockReturnValue(client as never);
    await createSupabaseSowingPlanRepository().create(recordToSowingPlanRow(baseRecord as never));
    expect(client.rpc).toHaveBeenCalledWith("save_sowing_plan_row", expect.objectContaining({ p_operation: "create", p_expected_updated_at: null }));
    expect(client.from).toHaveBeenCalledTimes(1);
  });

  it.each(["PGRST202", "42883", "23514", "40001", "55000", "P0002"])("never falls back to sequential writes on %s", async (code) => {
    const client = { rpc: vi.fn().mockResolvedValue({ data: null, error: { code, message: "failed" } }), from: vi.fn() };
    vi.mocked(createSupabaseServerClient).mockReturnValue(client as never);
    await expect(createSupabaseSowingPlanRepository().update(recordToSowingPlanRow(baseRecord as never), baseRecord.updated_at)).rejects.toThrow();
    expect(client.from).not.toHaveBeenCalled();
    expect(client.rpc).toHaveBeenCalledTimes(1);
  });

  it("requires a version before editing and refuses demo creation", async () => {
    const client = { from: vi.fn(), rpc: vi.fn() };
    vi.mocked(createSupabaseServerClient).mockReturnValue(client as never);
    const row = recordToSowingPlanRow(baseRecord as never);
    await expect(createSupabaseSowingPlanRepository().update({ ...row, updatedAt: undefined })).rejects.toBeInstanceOf(SowingPlanConflictError);
    await expect(createSupabaseSowingPlanRepository().create({ ...row, source: "demo" })).rejects.toThrow("Demo rows");
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each(["archive", "restore"] as const)("%s sends freezes, versions and archive change through one RPC", async (operation) => {
    const row = { ...baseRecord, archived_at: operation === "restore" ? "2026-10-01T10:00:00Z" : null };
    const other = { ...baseRecord, id: "22222222-2222-4222-8222-222222222222", hus: "Hus 5" };
    const active = operation === "restore" ? [other] : [row, other];
    const client = { rpc: vi.fn().mockResolvedValue({ data: row.id, error: null }), from: vi.fn()
      .mockReturnValueOnce(selectSingleByIdResult(row))
      .mockReturnValueOnce(selectOrderResult({ data: active, error: null }))
      .mockReturnValueOnce(selectSingleByIdResult(row)) };
    vi.mocked(createSupabaseServerClient).mockReturnValue(client as never);
    await createSupabaseSowingPlanRepository()[operation](row.id);
    expect(client.rpc).toHaveBeenCalledExactlyOnceWith("change_sowing_plan_archive", expect.objectContaining({
      p_operation: operation, p_id: row.id, p_expected_updated_at: row.updated_at,
      p_active_versions: active.map((item) => ({ id: item.id, updated_at: item.updated_at })),
      p_freeze: expect.arrayContaining([expect.objectContaining({ sowing_plan_row_id: other.id, source: "optimizer", locked: true })]),
      p_snapshot: operation === "restore" ? null : expect.objectContaining({ version: 1, hus: expect.objectContaining({ id: row.id }) }),
    }));
    expect(client.from.mock.calls.every(([table]) => table === "sowing_plan_rows")).toBe(true);
    expect(client.from).toHaveBeenCalledTimes(3);
  });

  it.each(["archive", "restore"] as const)("%s does not overwrite manual dates", async (operation) => {
    const row = { ...baseRecord, archived_at: operation === "restore" ? "2026-10-01T10:00:00Z" : null };
    const other = { ...baseRecord, id: "22222222-2222-4222-8222-222222222222", hus: "Hus 5",
      work_adjustments: [{ work_type: "thinning", dates: ["2026-10-10"], source: "manual", locked: true }] };
    const client = { rpc: vi.fn().mockResolvedValue({ data: row.id, error: null }), from: vi.fn()
      .mockReturnValueOnce(selectSingleByIdResult(row))
      .mockReturnValueOnce(selectOrderResult({ data: operation === "restore" ? [other] : [row, other], error: null }))
      .mockReturnValueOnce(selectSingleByIdResult(row)) };
    vi.mocked(createSupabaseServerClient).mockReturnValue(client as never);
    await createSupabaseSowingPlanRepository()[operation](row.id);
    const payload = client.rpc.mock.calls[0][1];
    expect(payload.p_freeze.some((item: { work_type: string }) => item.work_type === "thinning")).toBe(false);
  });

  it.each(["archive", "restore"] as const)("%s never falls back to partial writes on RPC errors", async (operation) => {
    for (const code of ["PGRST202", "40001", "23505", "23514"]) {
      const row = { ...baseRecord, archived_at: operation === "restore" ? "2026-10-01T10:00:00Z" : null };
      const client = { rpc: vi.fn().mockResolvedValue({ data: null, error: { code } }), from: vi.fn()
        .mockReturnValueOnce(selectSingleByIdResult(row))
        .mockReturnValueOnce(selectOrderResult({ data: operation === "restore" ? [] : [row], error: null })) };
      vi.mocked(createSupabaseServerClient).mockReturnValue(client as never);
      await expect(createSupabaseSowingPlanRepository()[operation](row.id)).rejects.toThrow();
      expect(client.from).toHaveBeenCalledTimes(2);
      expect(client.rpc).toHaveBeenCalledTimes(1);
    }
  });

  it("rejects an archive whose target changed between context reads", async () => {
    const client = { rpc: vi.fn(), from: vi.fn().mockReturnValueOnce(selectSingleByIdResult(baseRecord))
      .mockReturnValueOnce(selectOrderResult({ data: [{ ...baseRecord, updated_at: "2026-10-02T00:00:00Z" }], error: null })) };
    vi.mocked(createSupabaseServerClient).mockReturnValue(client as never);
    await expect(createSupabaseSowingPlanRepository().archive(baseRecord.id)).rejects.toBeInstanceOf(SowingPlanConflictError);
    expect(client.rpc).not.toHaveBeenCalled();
  });
  it.each(["create", "update", "archive", "restore"] as const)("reports %s as committed if its post-write read fails", async operation => {
    const stored = { ...baseRecord, archived_at: operation === "restore" ? "2026-10-01T00:00:00Z" : null };
    const readFailure = { select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: null, error: { message: "read offline" } }) }) }) };
    const client = { rpc: vi.fn().mockResolvedValue({ data: baseRecord.id, error: null }), from: vi.fn() };
    if (operation === "archive" || operation === "restore") {
      client.from.mockReturnValueOnce(selectSingleByIdResult(stored))
        .mockReturnValueOnce(selectOrderResult({ data: operation === "archive" ? [stored] : [], error: null }));
    }
    client.from.mockReturnValueOnce(readFailure);
    vi.mocked(createSupabaseServerClient).mockReturnValue(client as never);
    const repo = createSupabaseSowingPlanRepository();
    const write = operation === "create" || operation === "update"
      ? repo[operation](recordToSowingPlanRow(stored as never)) : repo[operation](stored.id);
    await expect(write).rejects.toMatchObject({ writeStatus: "committed", ids: [baseRecord.id] });
    expect(client.rpc).toHaveBeenCalledTimes(1);
  });

  it("does not turn an uncertain RPC transport result into a definitive failed write", async () => {
    const client = { rpc: vi.fn().mockResolvedValue({ data: null, error: { message: "fetch failed", code: "" } }), from: vi.fn() };
    vi.mocked(createSupabaseServerClient).mockReturnValue(client as never);
    await expect(createSupabaseSowingPlanRepository().create(recordToSowingPlanRow(baseRecord as never))).rejects.toMatchObject({ writeStatus: "unknown" });
    expect(client.from).not.toHaveBeenCalled();
  });

  it("loads active and archived rows together through one unfiltered SELECT", async () => {
    const archived = { ...baseRecord, id: "22222222-2222-4222-8222-222222222222", archived_at: "2026-10-24T12:00:00Z" };
    const order = vi.fn().mockResolvedValue({ data: [baseRecord, archived], error: null, count: 2 });
    const select = vi.fn().mockReturnValue({ order });
    const client = { from: vi.fn().mockReturnValue({ select }), rpc: vi.fn() };
    vi.mocked(createSupabaseServerClient).mockReturnValue(client as never);
    const rows = await loadWorkspaceRowsFromSupabase();
    expect(rows.map(row => row.id)).toEqual([baseRecord.id, archived.id]);
    expect(rows[1].archivedAt).toBe(archived.archived_at);
    expect(client.from).toHaveBeenCalledExactlyOnceWith("sowing_plan_rows");
    expect(select).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("hus_events(*)"), { count: "exact" });
    expect(order).toHaveBeenCalledTimes(1);
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each([3, null])("refuses a workspace truncated by server limits or missing its count (%s)", async count => {
    const client = { from: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ order: vi.fn().mockResolvedValue({ data: [baseRecord], error: null, count }) }) }) };
    vi.mocked(createSupabaseServerClient).mockReturnValue(client as never);
    await expect(loadWorkspaceRowsFromSupabase()).rejects.toThrow("nepilnīga");
    expect(client.from).toHaveBeenCalledTimes(1);
  });

  it("never falls back to empty relation history when workspace loading fails", async () => {
    const client = { from: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ order: vi.fn().mockResolvedValue({ data: null, error: { code: "PGRST200" }, count: null }) }) }) };
    vi.mocked(createSupabaseServerClient).mockReturnValue(client as never);
    await expect(loadWorkspaceRowsFromSupabase()).rejects.toMatchObject({ code: "PGRST200" });
    expect(client.from).toHaveBeenCalledTimes(1);
  });

});

function selectOrderResult(result: unknown) {
  const builder = { is: vi.fn(), not: vi.fn(), order: vi.fn().mockResolvedValue(result) };
  builder.is.mockReturnValue(builder); builder.not.mockReturnValue(builder);
  return { select: vi.fn().mockReturnValue(builder) };
}
function selectSingleByIdResult(data: unknown) {
  return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data, error: null }) }) }) };
}

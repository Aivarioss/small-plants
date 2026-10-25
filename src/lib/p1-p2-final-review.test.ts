import { describe, expect, it, vi } from "vitest";
import { demoPlanRows } from "./demo-data";
import type { SowingPlanRow } from "./types";
import { enqueueRowSave } from "./row-save-queue";
import { loadPlanWorkspace, WriteOutcomeError, writeAndRefresh } from "./write-outcome";
import { importPlanBatch } from "./repositories/supabase-sowing-plan-repository";
import { createSupabaseServerClient } from "./supabase/server";
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));

describe("combined review regressions", () => {
  it.each([
    ["create", "committed"], ["archive", "committed"],
    ["create", "unknown"], ["archive", "unknown"],
  ] as const)("keeps %s not_started when a prerequisite reports %s", async (action, status) => {
    const original = { ...demoPlanRows[0], source: "user" as const };
    const chains = new Map<string, Promise<SowingPlanRow>>();
    const field = enqueueRowSave(chains, original, async () => { throw new WriteOutcomeError(status, [original.id]); },
      { recover: vi.fn(), saved: vi.fn(), failed: vi.fn() });
    const write = vi.fn().mockResolvedValue(action === "create" ? { ...original, id: "new-row" } : original);
    const verify = vi.fn().mockReturnValue(true);
    const refresh = vi.fn().mockResolvedValue({ active: [original], archived: [] });
    let draft = "A new HUS that has not been sent";
    let view = "sowingPlan";
    const result = await writeAndRefresh(write, refresh, verify, () => Promise.all(chains.values()));
    await Promise.allSettled([field]);
    if (result.writeStatus === "committed") { draft = ""; view = "worksheet"; }
    expect(write).not.toHaveBeenCalled();
    expect(verify).not.toHaveBeenCalled();
    expect(result).toMatchObject({ writeStatus: "not_started", refreshed: true });
    expect(draft).toBe("A new HUS that has not been sent");
    expect(view).toBe("sowingPlan");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it.each(["archive", "restore"] as const)("publishes each HUS exactly once from one snapshot during %s", async action => {
    const row = { ...demoPlanRows[0], archivedAt: action === "archive" ? "2026-10-24T12:00:00Z" : undefined };
    const load = vi.fn().mockResolvedValue([row]);
    const result = await writeAndRefresh(async () => "acknowledged write", () => loadPlanWorkspace(load));
    expect(result).toMatchObject({ writeStatus: "committed", refreshed: true });
    expect([...result.snapshot!.active, ...result.snapshot!.archived].filter(candidate => candidate.id === row.id)).toHaveLength(1);
    expect(result.snapshot![action === "archive" ? "archived" : "active"]).toEqual([row]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("refuses a duplicate-ID snapshot instead of publishing an inconsistent workspace", async () => {
    const row = demoPlanRows[0];
    await expect(loadPlanWorkspace(async () => [row, { ...row, archivedAt: "2026-10-24T12:00:00Z" }])).rejects.toThrow("nav viennozīmīga");
  });

  it.each(["55P03", "40P01"])("retains the import attempt after transient receipt locking error %s", async code => {
    const row = { ...demoPlanRows[0], source: "user" as const, id: "11111111-1111-4111-8111-111111111111" };
    const client = { rpc: vi.fn().mockResolvedValueOnce({ data: null, error: { code, message: "receipt lock not acquired" } })
      .mockResolvedValueOnce({ data: [row.id], error: null }) };
    vi.mocked(createSupabaseServerClient).mockReturnValue(client as never);
    const batch = { id: crypto.randomUUID(), items: [{ operation: "create" as const, row }] };
    let pending: typeof batch | null = batch;
    const refresh = async () => ({ active: [], archived: [] });
    const result = await writeAndRefresh(() => importPlanBatch(pending!), refresh);
    if (result.writeStatus === "committed" || result.writeStatus === "failed") pending = null;
    expect(result.error).toBeInstanceOf(WriteOutcomeError);
    expect(result).toMatchObject({ writeStatus: "unknown", refreshed: true });
    expect(pending).toBe(batch);
    const retried = await writeAndRefresh(() => importPlanBatch(pending!), refresh);
    expect(retried.writeStatus).toBe("committed");
    expect(client.rpc.mock.calls.map(call => call[1].p_id)).toEqual([batch.id, batch.id]);
    expect(client.rpc.mock.calls[0][1].p_request).toEqual(client.rpc.mock.calls[1][1].p_request);
  });
});

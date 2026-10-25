import { beforeEach, describe, expect, it, vi } from "vitest";
import { importPlanBatch } from "./supabase-sowing-plan-repository";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { demoPlanRows } from "@/lib/demo-data";
vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));
const row = { ...demoPlanRows[0], source: "user" as const, id: "11111111-1111-4111-8111-111111111111", updatedAt: "2026-10-01T00:00:00Z" };
beforeEach(() => vi.clearAllMocks());
describe("atomic import repository", () => {
  it("sends create and replacement, including all history, through one RPC", async () => {
    const other = { ...row, id: "22222222-2222-4222-8222-222222222222" };
    const client = { rpc: vi.fn().mockResolvedValue({ data: [row.id, other.id], error: null }), from: vi.fn() };
    vi.mocked(createSupabaseServerClient).mockReturnValue(client as never);
    const batch = { id: crypto.randomUUID(), items: [{ operation: "update" as const, row }, { operation: "create" as const, row: other }] };
    await expect(importPlanBatch(batch)).resolves.toEqual([row.id,other.id]);
    expect(client.rpc).toHaveBeenCalledExactlyOnceWith("import_sowing_plan_rows", expect.objectContaining({ p_id: batch.id, p_request: batch.items,
      p_items: [expect.objectContaining({ operation: "update", expected_updated_at: row.updatedAt, events: [], losses: [] }), expect.objectContaining({ operation: "create", expected_updated_at: null })] }));
    expect(client.from).not.toHaveBeenCalled();
  });
  it.each(["40001", "23505", "23514", "PGRST202"])("never falls back to partial writes on %s", async code => {
    const client = { rpc: vi.fn().mockResolvedValue({ data: null, error: { code } }), from: vi.fn() };
    vi.mocked(createSupabaseServerClient).mockReturnValue(client as never);
    await expect(importPlanBatch({ id: crypto.randomUUID(), items: [{ operation: "create", row }] })).rejects.toThrow();
    expect(client.rpc).toHaveBeenCalledTimes(1); expect(client.from).not.toHaveBeenCalled();
  });
  it("refuses an unversioned replacement before any write", async () => {
    const client = { rpc: vi.fn() };
    vi.mocked(createSupabaseServerClient).mockReturnValue(client as never);
    await expect(importPlanBatch({ id: crypto.randomUUID(), items: [{ operation: "update", row: { ...row, updatedAt: undefined } }] })).rejects.toThrow();
    expect(client.rpc).not.toHaveBeenCalled();
  });
});

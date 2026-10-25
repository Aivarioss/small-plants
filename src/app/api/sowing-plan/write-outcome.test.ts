import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST, PATCH } from "./route";
import { POST as archive, PATCH as restore } from "../hus-archive/route";
import { POST as batch } from "./batch/route";
import { hasValidSession } from "@/lib/auth/session";
import { importPlanBatch, SowingPlanConflictError } from "@/lib/repositories/supabase-sowing-plan-repository";
import { WriteOutcomeError } from "@/lib/write-outcome";
import { demoPlanRows } from "@/lib/demo-data";
const { repo } = vi.hoisted(() => ({ repo: { create: vi.fn(), update: vi.fn(), archive: vi.fn(), restore: vi.fn() } }));
vi.mock("@/lib/auth/session", () => ({ hasValidSession: vi.fn().mockResolvedValue(true) }));
vi.mock("@/lib/supabase/server", () => ({ isSupabaseServerConfigured: () => true, createSupabaseServerClient: vi.fn() }));
vi.mock("@/lib/repositories/supabase-sowing-plan-repository", async original => ({ ...await original<typeof import("@/lib/repositories/supabase-sowing-plan-repository")>(), createSupabaseSowingPlanRepository: () => repo, importPlanBatch: vi.fn() }));
const row = { ...demoPlanRows[0], id: "11111111-1111-4111-8111-111111111111", source: "user" };
const request = (body: unknown) => new NextRequest("http://localhost/api/sowing-plan", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });
beforeEach(() => { vi.clearAllMocks(); vi.mocked(hasValidSession).mockResolvedValue(true); });
describe("write outcome HTTP responses", () => {
  it.each(["create", "update", "archive", "restore"] as const)("returns an acknowledged %s rather than a failed save after a read error", async operation => {
    repo[operation].mockRejectedValue(new WriteOutcomeError("committed", [row.id]));
    const handler = operation === "create" ? POST : operation === "update" ? PATCH : operation === "archive" ? archive : restore;
    const response = await handler(request({ row, id: row.id }));
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ writeStatus: "committed", ids: [row.id] });
  });
  it("keeps an unknown server outcome unknown", async () => {
    repo.create.mockRejectedValue(new WriteOutcomeError("unknown", [row.id]));
    const response = await POST(request({ row }));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ writeStatus: "unknown" });
  });
  it("checks authentication and validates the complete batch before writing", async () => {
    vi.mocked(hasValidSession).mockResolvedValue(false);
    expect((await batch(request({}))).status).toBe(401);
    vi.mocked(hasValidSession).mockResolvedValue(true);
    expect((await batch(request({ id: row.id, items: [] }))).status).toBe(400);
    expect((await batch(request({ id: row.id, items: [{ operation: "create", row }, { operation: "create", row: {} }] }))).status).toBe(400);
    expect(importPlanBatch).not.toHaveBeenCalled();
  });
  it("acknowledges the complete import without performing an extra read", async () => {
    vi.mocked(importPlanBatch).mockResolvedValue([row.id]);
    const body = { id: row.id, items: [{ operation: "create", row }] };
    const response = await batch(request(body));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ writeStatus: "committed", ids: [row.id] });
    expect(importPlanBatch).toHaveBeenCalledExactlyOnceWith(body);
  });
  it("does not acknowledge a rejected import", async () => {
    vi.mocked(importPlanBatch).mockRejectedValue(new SowingPlanConflictError());
    const response = await batch(request({ id: row.id, items: [{ operation: "create", row }] }));
    expect(response.status).toBe(409);
    expect(await response.json()).not.toHaveProperty("writeStatus", "committed");
  });
});

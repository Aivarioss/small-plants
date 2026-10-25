import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";
import { hasValidSession } from "@/lib/auth/session";
import { isSupabaseServerConfigured } from "@/lib/supabase/server";
import { loadWorkspaceRowsFromSupabase } from "@/lib/repositories/supabase-sowing-plan-repository";
import { demoPlanRows } from "@/lib/demo-data";
vi.mock("@/lib/auth/session", () => ({ hasValidSession: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ isSupabaseServerConfigured: vi.fn() }));
vi.mock("@/lib/repositories/supabase-sowing-plan-repository", () => ({ loadWorkspaceRowsFromSupabase: vi.fn() }));
const request = () => new NextRequest("http://localhost/api/sowing-plan/workspace");
beforeEach(() => {
  vi.clearAllMocks(); vi.mocked(hasValidSession).mockResolvedValue(true); vi.mocked(isSupabaseServerConfigured).mockReturnValue(true);
});
describe("consistent workspace API", () => {
  it("requires authentication and configuration before loading", async () => {
    vi.mocked(hasValidSession).mockResolvedValue(false);
    expect((await GET(request())).status).toBe(401);
    vi.mocked(hasValidSession).mockResolvedValue(true); vi.mocked(isSupabaseServerConfigured).mockReturnValue(false);
    expect((await GET(request())).status).toBe(503);
    expect(loadWorkspaceRowsFromSupabase).not.toHaveBeenCalled();
  });
  it("returns one complete read including active and archived rows", async () => {
    const rows = [demoPlanRows[0], { ...demoPlanRows[1], archivedAt: "2026-10-24T12:00:00Z" }];
    vi.mocked(loadWorkspaceRowsFromSupabase).mockResolvedValue(rows);
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ rows });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(loadWorkspaceRowsFromSupabase).toHaveBeenCalledTimes(1);
  });
  it("never returns a partial workspace as successful", async () => {
    vi.mocked(loadWorkspaceRowsFromSupabase).mockRejectedValue(new Error("incomplete workspace"));
    const response = await GET(request());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "incomplete workspace" });
  });
});

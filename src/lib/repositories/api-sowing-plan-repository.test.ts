import { afterEach, describe, expect, it, vi } from "vitest";
import { apiSowingPlanRepository, loadWorkspaceRows, archiveRow, restoreArchivedRow, submitPlanImport, SowingPlanApiConflictError } from "./api-sowing-plan-repository";
import { WriteOutcomeError } from "@/lib/write-outcome";
import { demoPlanRows } from "@/lib/demo-data";
afterEach(() => vi.unstubAllGlobals());
const row = demoPlanRows[0];

describe("write outcome transport", () => {
  it.each(["create", "update", "archive", "restore"])("preserves confirmed %s status when row reload failed on the server", async (operation) => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ writeStatus: "committed", ids: [row.id] }, { status: 202 }));
    vi.stubGlobal("fetch", fetch);
    const write = operation === "create" ? () => apiSowingPlanRepository.create(row)
      : operation === "update" ? () => apiSowingPlanRepository.update(row)
      : operation === "archive" ? () => archiveRow(row.id) : () => restoreArchivedRow(row.id);
    await expect(write()).rejects.toMatchObject({ writeStatus: "committed", ids: [row.id] });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("marks network loss and malformed acknowledgements unknown", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
    await expect(apiSowingPlanRepository.create(row)).rejects.toMatchObject({ writeStatus: "unknown" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("broken", { status: 200 })));
    await expect(apiSowingPlanRepository.update(row)).rejects.toBeInstanceOf(WriteOutcomeError);
  });
  it("keeps conflicts distinct from uncertain writes", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "changed" }, { status: 409 })));
    await expect(apiSowingPlanRepository.update(row)).rejects.toBeInstanceOf(SowingPlanApiConflictError);
  });
  it("submits one batch and reuses its exact operation ID and payload on retry", async () => {
    const batch = { id: "stable-import-id", items: [{ operation: "create" as const, row }] };
    const fetch = vi.fn().mockRejectedValueOnce(new Error("lost response")).mockResolvedValueOnce(Response.json({ writeStatus: "committed", ids: [row.id] }));
    vi.stubGlobal("fetch", fetch);
    await expect(submitPlanImport(batch)).rejects.toMatchObject({ writeStatus: "unknown" });
    await expect(submitPlanImport(batch)).resolves.toEqual([row.id]);
    expect(fetch.mock.calls[0][1].body).toBe(fetch.mock.calls[1][1].body);
    expect(fetch.mock.calls[0][0]).toBe("/api/sowing-plan/batch");
  });
  it("treats an infrastructure error without a write acknowledgement as unknown", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "Gateway timeout" }, { status: 504 })));
    await expect(apiSowingPlanRepository.create(row)).rejects.toMatchObject({ writeStatus: "unknown" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "constraint", writeStatus: "failed" }, { status: 500 })));
    await expect(apiSowingPlanRepository.create(row)).rejects.toThrow("constraint");
  });
  it("requires an explicit delete acknowledgement", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({})));
    await expect(apiSowingPlanRepository.delete(row)).rejects.toMatchObject({ writeStatus: "unknown" });
  });

  it("loads the whole workspace with one uncached request", async () => {
    const archived = { ...row, id: "archived", archivedAt: "2026-10-24T12:00:00Z" };
    const fetch = vi.fn().mockResolvedValue(Response.json({ rows: [row, archived] }));
    vi.stubGlobal("fetch", fetch);
    await expect(loadWorkspaceRows()).resolves.toEqual([row, archived]);
    expect(fetch).toHaveBeenCalledExactlyOnceWith("/api/sowing-plan/workspace", { cache: "no-store" });
  });
  it("refuses failed or malformed workspace responses", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ rows: [], error: "read failed" }, { status: 500 })));
    await expect(loadWorkspaceRows()).rejects.toThrow("read failed");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ rows: {} })));
    await expect(loadWorkspaceRows()).rejects.toThrow("Neizdevās ielādēt pilno plānu");
  });
  it("keeps transient receipt locking responses unknown through HTTP transport", async () => {
    const batch = { id: crypto.randomUUID(), items: [{ operation: "create" as const, row }] };
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({ writeStatus: "unknown", ids: [row.id] }, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ writeStatus: "committed", ids: [row.id] }));
    vi.stubGlobal("fetch", fetch);
    await expect(submitPlanImport(batch)).rejects.toMatchObject({ writeStatus: "unknown" });
    await expect(submitPlanImport(batch)).resolves.toEqual([row.id]);
    expect(fetch.mock.calls[0][1].body).toBe(fetch.mock.calls[1][1].body);
  });

});

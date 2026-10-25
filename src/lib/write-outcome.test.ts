import { describe, expect, it, vi } from "vitest";
import { loadPlanWorkspace, WriteOutcomeError, writeAndRefresh } from "./write-outcome";
import { demoPlanRows } from "./demo-data";

describe("write acknowledgement and refresh", () => {
  it("never reports rollback or repeats a write after its refresh fails", async () => {
    const write = vi.fn().mockResolvedValue("saved ID");
    const result = await writeAndRefresh(write, async () => { throw new Error("offline"); });
    expect(result).toMatchObject({ writeStatus: "committed", refreshed: false, value: "saved ID" });
    expect(write).toHaveBeenCalledTimes(1);
  });
  it("preserves a server commit acknowledgement even if both subsequent reads fail", async () => {
    const result = await writeAndRefresh(async () => { throw new WriteOutcomeError("committed", ["id"]); }, async () => { throw new Error("offline"); });
    expect(result).toMatchObject({ writeStatus: "committed", refreshed: false });
  });
  it("reconciles a lost response when the expected ID and state can be read", async () => {
    const snapshot = { active: [], archived: [demoPlanRows[0]] };
    const result = await writeAndRefresh(async () => { throw new WriteOutcomeError("unknown", [demoPlanRows[0].id]); }, async () => snapshot,
      fresh => fresh.archived.some(row => row.id === demoPlanRows[0].id));
    expect(result).toMatchObject({ writeStatus: "committed", refreshed: true, snapshot });
  });
  it("keeps an unproven response unknown, including a successful but inconclusive refresh", async () => {
    const result = await writeAndRefresh(async () => { throw new WriteOutcomeError("unknown", ["id"]); }, async () => [], rows => rows.length > 0);
    expect(result).toMatchObject({ writeStatus: "unknown", refreshed: true });
  });
  it("does not label a rejected write as committed merely because refresh succeeds", async () => {
    const result = await writeAndRefresh(async () => { throw new Error("constraint"); }, async () => ["old data"], () => true);
    expect(result).toMatchObject({ writeStatus: "failed", refreshed: true });
  });
  it("loads active and archive lists as one publishable snapshot", async () => {
    const snapshot = await loadPlanWorkspace(async () => [demoPlanRows[0], { ...demoPlanRows[1], archivedAt: "2026-10-24T12:00:00Z" }]);
    expect(snapshot).toEqual({ active: [demoPlanRows[0]], archived: [{ ...demoPlanRows[1], archivedAt: "2026-10-24T12:00:00Z" }] });
    await expect(loadPlanWorkspace(async () => { throw new Error("workspace unavailable"); })).rejects.toThrow("workspace unavailable");
  });
  it("waits for prerequisites before starting and acknowledging the current write", async () => {
    const calls: string[] = [];
    const result = await writeAndRefresh(async () => { calls.push("write"); return "current ID"; },
      async () => { calls.push("refresh"); return []; }, undefined, async () => { calls.push("prepare"); });
    expect(calls).toEqual(["prepare", "write", "refresh"]);
    expect(result).toMatchObject({ writeStatus: "committed", refreshed: true, value: "current ID" });
  });
  it("keeps a blocked write not_started even when both prerequisite and refresh fail", async () => {
    const write = vi.fn();
    const result = await writeAndRefresh(write, async () => { throw new Error("offline"); }, undefined,
      async () => { throw new Error("prerequisite failed"); });
    expect(result).toMatchObject({ writeStatus: "not_started", refreshed: false });
    expect(write).not.toHaveBeenCalled();
  });

});

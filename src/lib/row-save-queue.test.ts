import { describe, expect, it, vi } from "vitest";
import { enqueueRowSave } from "./row-save-queue";
import { demoPlanRows } from "./demo-data";
import type { SowingPlanRow } from "./types";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
describe("row save queue", () => {
  it("preserves three rapid field edits when earlier replies arrive between edits", async () => {
    const original = { ...demoPlanRows[0], extraPlants: 100, updatedAt: "v0" };
    const chains = new Map<string, Promise<SowingPlanRow>>();
    let visible: SowingPlanRow = original;
    const writes: SowingPlanRow[] = [];
    const replies = Array.from({ length: 3 }, () => deferred<SowingPlanRow>());
    const callbacks = { recover: vi.fn(), saved: (row: SowingPlanRow) => { visible = row; }, failed: vi.fn() };
    const edit = (patch: Partial<SowingPlanRow>) => {
      visible = { ...visible, ...patch };
      return enqueueRowSave(chains, visible, (latest) => {
        writes.push({ ...latest, ...patch });
        return replies[writes.length - 1].promise;
      }, callbacks);
    };
    const first = edit({ variety: "new" });
    const second = edit({ extraPlants: 200 });
    await Promise.resolve();
    replies[0].resolve({ ...writes[0], updatedAt: "v1" });
    await first;
    expect(visible.extraPlants).toBe(200);
    const third = edit({ requiredPlants: 3600 });
    replies[1].resolve({ ...writes[1], updatedAt: "v2" });
    await second;
    replies[2].resolve({ ...writes[2], updatedAt: "v3" });
    await third;
    expect(visible).toMatchObject({ variety: "new", extraPlants: 200, requiredPlants: 3600 });
    expect(writes.map((row) => row.updatedAt)).toEqual(["v0", "v1", "v2"]);
    expect(callbacks.failed).not.toHaveBeenCalled();
    expect(chains.size).toBe(0);
  });

  it("stops dependent writes after failure and allows a new edit after recovery", async () => {
    const row = demoPlanRows[0];
    const chains = new Map<string, Promise<SowingPlanRow>>();
    const reply = deferred<SowingPlanRow>();
    const failed = vi.fn().mockResolvedValue(undefined);
    const saved = vi.fn();
    const first = enqueueRowSave(chains, row, () => reply.promise, { recover: vi.fn(), failed, saved });
    const nextWrite = vi.fn();
    const second = enqueueRowSave(chains, row, nextWrite, { recover: vi.fn(), failed, saved });
    const checked = Promise.allSettled([first, second]);
    reply.reject(new Error("network"));
    expect((await checked).every((result) => result.status === "rejected")).toBe(true);
    expect(nextWrite).not.toHaveBeenCalled();
    expect(failed).toHaveBeenCalledTimes(1);
    await enqueueRowSave(chains, row, async (latest) => latest, { recover: vi.fn(), failed, saved });
    expect(saved).toHaveBeenCalledWith(row);
  });

  it("uses a freshly reloaded version after the previous save finishes", async () => {
    const row = demoPlanRows[0];
    const chains = new Map<string, Promise<SowingPlanRow>>();
    const callbacks = { recover: vi.fn(), saved: vi.fn(), failed: vi.fn() };
    await enqueueRowSave(chains, row, async () => ({ ...row, updatedAt: "v1" }), callbacks);
    const fresh = { ...row, updatedAt: "changed-elsewhere", extraPlants: 500 };
    const write = vi.fn(async (latest: SowingPlanRow) => latest);
    await enqueueRowSave(chains, fresh, write, callbacks);
    expect(write).toHaveBeenCalledWith(fresh);
  });
});

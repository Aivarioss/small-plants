import { describe, expect, it, vi } from "vitest";
import { createWorkspaceReadOrder, SupersededWorkspaceReadError } from "./workspace-read-order";
import { writeAndRefresh, WriteOutcomeError } from "./write-outcome";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe("workspace response ordering", () => {
  it("keeps C after a fast B refresh, a confirmed write C, and the late B snapshot", async () => {
    const order = createWorkspaceReadOrder();
    const slow = deferred<{ active: string[]; archived: string[]; selected: string }>();
    let view = { active: ["A"], archived: [] as string[], selected: "A" };
    const publish = (snapshot: typeof view) => { view = snapshot; };
    const first = order.read(() => slow.promise, publish).catch(error => error);
    await order.read(async () => ({ active: ["B"], archived: ["archive B"], selected: "B" }), publish);
    const end = order.beginMutation();
    end();
    view = { active: ["C"], archived: ["archive B"], selected: "C" };
    slow.resolve({ active: ["B"], archived: [], selected: "B" });
    expect(await first).toBeInstanceOf(SupersededWorkspaceReadError);
    expect(view).toEqual({ active: ["C"], archived: ["archive B"], selected: "C" });
  });

  it("does not let old success remove the pause after a newer read failure", async () => {
    const order = createWorkspaceReadOrder();
    const slow = deferred<{ active: string[] }>();
    let paused = true;
    let message = "refresh required";
    const refresh = async (load: () => Promise<{ active: string[] }>) => {
      try {
        const snapshot = await order.read(load, vi.fn());
        if (!snapshot.isCurrent()) return;
        paused = false; message = "refreshed";
      } catch (error) {
        if (error instanceof SupersededWorkspaceReadError) return;
        paused = true; message = "new failure";
      }
    };
    const old = refresh(() => slow.promise);
    await refresh(async () => { throw new Error("offline"); });
    slow.resolve({ active: ["old"] });
    await old;
    expect({ paused, message }).toEqual({ paused: true, message: "new failure" });
  });

  it("discards an old failure after the newer read succeeded", async () => {
    const order = createWorkspaceReadOrder();
    const slow = deferred<{ active: string[] }>();
    const publish = vi.fn();
    const old = order.read(() => slow.promise, publish).catch(error => error);
    await order.read(async () => ({ active: ["new"] }), publish);
    slow.reject(new Error("old network error"));
    expect(await old).toBeInstanceOf(SupersededWorkspaceReadError);
    expect(publish).toHaveBeenCalledExactlyOnceWith({ active: ["new"] });
  });

  it("invalidates a pending initial load when a mutation starts", async () => {
    const order = createWorkspaceReadOrder();
    const slow = deferred<{ active: string[] }>();
    const publish = vi.fn();
    const mount = order.read(() => slow.promise, publish).catch(error => error);
    const end = order.beginMutation();
    slow.resolve({ active: ["old"] });
    expect(await mount).toBeInstanceOf(SupersededWorkspaceReadError);
    end();
    expect(publish).not.toHaveBeenCalled();
  });

  it("invalidates reads started during a write even when they finish after its acknowledgement", async () => {
    const order = createWorkspaceReadOrder();
    const end = order.beginMutation();
    const slow = deferred<{ active: string[] }>();
    const publish = vi.fn();
    const read = order.read(() => slow.promise, publish).catch(error => error);
    end();
    slow.resolve({ active: ["before commit"] });
    expect(await read).toBeInstanceOf(SupersededWorkspaceReadError);
    expect(publish).not.toHaveBeenCalled();
    await order.read(async () => ({ active: ["after commit"] }), publish);
    expect(publish).toHaveBeenCalledExactlyOnceWith({ active: ["after commit"] });
  });

  it("does not publish during any overlapping mutation and releases each mutation once", async () => {
    const order = createWorkspaceReadOrder();
    const first = order.beginMutation();
    const second = order.beginMutation();
    first(); first();
    const publish = vi.fn();
    await expect(order.read(async () => ({ active: [] }), publish)).rejects.toBeInstanceOf(SupersededWorkspaceReadError);
    second();
    await order.read(async () => ({ active: ["ready"] }), publish);
    expect(publish).toHaveBeenCalledExactlyOnceWith({ active: ["ready"] });
  });

  it("invalidates already returned snapshot permissions before caller status updates", async () => {
    const order = createWorkspaceReadOrder();
    const result = await order.read(async () => ({ active: ["A"] }), vi.fn());
    expect(result.isCurrent()).toBe(true);
    order.invalidate();
    expect(result.isCurrent()).toBe(false);
  });

  it.each(["committed", "unknown"] as const)("retains %s acknowledgement but identifies a superseded post-write refresh", async status => {
    const order = createWorkspaceReadOrder();
    const slow = deferred<{ active: string[] }>();
    const started = deferred<void>();
    const publish = vi.fn();
    const operation = writeAndRefresh(async () => { throw new WriteOutcomeError(status, ["row"]); },
      () => order.read(() => { started.resolve(); return slow.promise; }, publish));
    await started.promise;
    await expect(order.read(async () => { throw new Error("new recovery failed"); }, publish)).rejects.toThrow("new recovery failed");
    slow.resolve({ active: ["old"] });
    const result = await operation;
    expect(result).toMatchObject({ writeStatus: status, refreshed: false, refreshSuperseded: true });
    expect(result.snapshot).toBeUndefined();
    expect(publish).not.toHaveBeenCalled();
  });
});

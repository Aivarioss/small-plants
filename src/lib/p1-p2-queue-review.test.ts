import { describe, expect, it, vi } from "vitest";
import { enqueueRowSave } from "./row-save-queue";
import { persistHusEntries } from "./hus-entry-save";
import { demoPlanRows } from "./demo-data";
import type { SowingPlanRow } from "./types";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => { resolve = yes; });
  return { promise, resolve };
}

describe("mixed row save recovery regression", () => {
  it("recovers a failed field before rejecting queued events and accepting a new edit", async () => {
    const original = { ...demoPlanRows[0], variety: "Original", updatedAt: "v0" };
    let visible: SowingPlanRow = { ...original, variety: "Unsaved" };
    const chains = new Map<string, Promise<SowingPlanRow>>();
    const recovery = deferred<void>();
    const started = deferred<void>();
    const recover = vi.fn(async (_error: unknown, confirmed: SowingPlanRow) => {
      started.resolve(); await recovery.promise; visible = confirmed;
    });
    const firstError = vi.fn(), lastError = vi.fn();
    const first = enqueueRowSave(chains, original, async () => { throw new Error("network"); },
      { saved: vi.fn(), recover, failed: firstError });
    const saveEvent = vi.fn();
    const second = enqueueRowSave(chains, visible, saveEvent, { saved: vi.fn(), recover, failed: lastError });
    const checked = Promise.allSettled([first, second]);
    await started.promise;
    expect(chains.has(original.id)).toBe(true);
    expect(saveEvent).not.toHaveBeenCalled();
    const duringRecoveryWrite = vi.fn();
    const duringRecoveryError = vi.fn();
    const duringRecovery = enqueueRowSave(chains, visible, duringRecoveryWrite,
      { saved: vi.fn(), recover, failed: duringRecoveryError });
    const duringChecked = Promise.allSettled([duringRecovery]);
    recovery.resolve();
    expect((await checked).every(result => result.status === "rejected")).toBe(true);
    expect((await duringChecked)[0].status).toBe("rejected");
    expect(recover).toHaveBeenCalledTimes(1);
    expect(recover).toHaveBeenCalledWith(expect.any(Error), original);
    expect(saveEvent).not.toHaveBeenCalled();
    expect(duringRecoveryWrite).not.toHaveBeenCalled();
    expect(duringRecoveryError).toHaveBeenCalledTimes(1);
    expect(visible.variety).toBe("Original");
    expect(chains.size).toBe(0);
    let sent: SowingPlanRow | undefined;
    await enqueueRowSave(chains, visible, async (base) => {
      sent = { ...base, extraPlants: 200 }; return sent;
    }, { saved: vi.fn(), recover, failed: vi.fn() });
    expect(sent).toMatchObject({ variety: "Original", extraPlants: 200, updatedAt: "v0" });
  });

  it("falls back to the last confirmed write when recovery cannot reload", async () => {
    const original = { ...demoPlanRows[0], variety: "Original", updatedAt: "v0" };
    let visible: SowingPlanRow = { ...original, variety: "Confirmed", extraPlants: 999 };
    const chains = new Map<string, Promise<SowingPlanRow>>();
    const load = vi.fn().mockRejectedValue(new Error("offline"));
    const recover = vi.fn(async (_error: unknown, confirmed: SowingPlanRow) => {
      await load().catch(() => { visible = confirmed; });
    });
    const callbacks = { saved: vi.fn(), recover, failed: vi.fn() };
    const first = enqueueRowSave(chains, original, async base => ({ ...base, variety: "Confirmed", updatedAt: "v1" }), callbacks);
    const second = enqueueRowSave(chains, visible, async () => { throw new Error("write failed"); }, callbacks);
    const eventWrite = vi.fn();
    const third = enqueueRowSave(chains, visible, eventWrite, callbacks);
    await Promise.allSettled([first, second, third]);
    expect(visible).toMatchObject({ variety: "Confirmed", extraPlants: original.extraPlants, updatedAt: "v1" });
    expect(recover).toHaveBeenCalledTimes(1);
    expect(eventWrite).not.toHaveBeenCalled();
  });

  it("uses reloaded state after an ambiguous committed write and retains the dialog error", async () => {
    const original = { ...demoPlanRows[0], updatedAt: "v0" };
    let visible: SowingPlanRow = original;
    const fresh = { ...original, variety: "Actually committed", updatedAt: "v1" };
    const chains = new Map<string, Promise<SowingPlanRow>>();
    const error = new Error("response lost");
    const recover = vi.fn(async () => { visible = fresh; });
    const first = enqueueRowSave(chains, original, async () => { throw error; }, { saved: vi.fn(), recover, failed: vi.fn() });
    const dialogError = vi.fn();
    const second = enqueueRowSave(chains, original, vi.fn(), { saved: vi.fn(), recover, failed: dialogError });
    await Promise.allSettled([first, second]);
    expect(dialogError).toHaveBeenCalledWith(error);
    const nextWrite = vi.fn(async (base: SowingPlanRow) => base);
    await enqueueRowSave(chains, visible, nextWrite, { saved: vi.fn(), recover, failed: vi.fn() });
    expect(nextWrite).toHaveBeenCalledWith(fresh);
    expect(recover).toHaveBeenCalledTimes(1);
  });

  it("preserves Moving and its loss between successful field edits in the same queue", async () => {
    let stored: SowingPlanRow = { ...demoPlanRows[0], updatedAt: "v0", husEvents: [], plantCorrections: [] };
    const original = stored;
    const chains = new Map<string, Promise<SowingPlanRow>>();
    const recover = vi.fn();
    const callbacks = { saved: vi.fn(), recover, failed: vi.fn() };
    const event = { id: "moving", eventType: "move" as const, eventDate: original.sowingDate,
      location: "A1", destinationLocation: "C1-C24", plantChange: -10, plantCorrectionId: "loss" };
    const first = enqueueRowSave(chains, original, async (base) => {
      stored = { ...base, extraPlants: 200, updatedAt: "v1" }; return stored;
    }, callbacks);
    const second = enqueueRowSave(chains, original, () => persistHusEntries(original.id, [event], {
      load: async () => [stored], update: async (next) => { stored = { ...next, updatedAt: "v2" }; return stored; },
    }), callbacks);
    const third = enqueueRowSave(chains, original, async (base) => {
      stored = { ...base, variety: "New variety", updatedAt: "v3" }; return stored;
    }, callbacks);
    await Promise.all([first, second, third]);
    expect(stored).toMatchObject({ extraPlants: 200, variety: "New variety", updatedAt: "v3" });
    expect(stored.husEvents).toHaveLength(1);
    expect(stored.husEvents?.[0]).toMatchObject({ id: "moving", plantCorrectionId: "loss" });
    expect(stored.plantCorrections).toHaveLength(1);
    expect(stored.plantCorrections?.[0]).toMatchObject({ id: "loss", amount: -10 });
    expect(recover).not.toHaveBeenCalled();
    expect(callbacks.saved).toHaveBeenCalledExactlyOnceWith(stored);
  });

});

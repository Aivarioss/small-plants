import type { SowingPlanRow } from "./types";

/** Apply changes to the last confirmed row, and never publish an older acknowledgement over newer input. */
export function enqueueRowSave(
  chains: Map<string, Promise<SowingPlanRow>>,
  previous: SowingPlanRow,
  save: (latest: SowingPlanRow) => Promise<SowingPlanRow>,
  callbacks: {
    saved: (row: SowingPlanRow) => void;
    recover: (error: unknown, confirmed: SowingPlanRow) => Promise<void>;
    failed: (error: unknown) => Promise<void>;
  },
): Promise<SowingPlanRow> {
  const baseline = chains.get(previous.id) ?? Promise.resolve(previous);
  const operation = baseline.then(async (confirmed) => {
    try {
      return await save(confirmed);
    } catch (error) {
      // Recovery belongs to the write that failed, not to the last queued caller.
      // All dependents wait for recovery, then reject without performing their writes.
      await callbacks.recover(error, confirmed);
      throw error;
    }
  }).then(
    (saved) => {
      if (chains.get(previous.id) === operation) {
        callbacks.saved(saved);
        chains.delete(previous.id);
      }
      return saved;
    },
    async (error: unknown) => {
      // Reject dependent edits as well. Continuing on an unconfirmed base can erase a saved change.
      if (chains.get(previous.id) === operation) {
        await callbacks.failed(error);
        if (chains.get(previous.id) === operation) chains.delete(previous.id);
      }
      throw error;
    },
  );
  chains.set(previous.id, operation);
  return operation;
}

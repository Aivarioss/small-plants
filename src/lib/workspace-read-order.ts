export class SupersededWorkspaceReadError extends Error {
  constructor() { super("Workspace read superseded"); }
}

/** A read may publish only until another read or mutation starts. */
export function createWorkspaceReadOrder() {
  let generation = 0;
  let mutations = 0;
  return {
    invalidate() { generation++; },
    beginMutation() {
      generation++;
      mutations++;
      let ended = false;
      return () => {
        if (ended) return;
        ended = true;
        mutations--;
        generation++;
      };
    },
    async read<T>(load: () => Promise<T>, publish: (snapshot: T) => void) {
      const ticket = ++generation;
      const isCurrent = () => ticket === generation && mutations === 0;
      try {
        const snapshot = await load();
        if (!isCurrent()) throw new SupersededWorkspaceReadError();
        publish(snapshot);
        return { ...snapshot, isCurrent };
      } catch (error) {
        // Even an old failure must not change the newer view's recovery state.
        if (!isCurrent()) throw new SupersededWorkspaceReadError();
        throw error;
      }
    },
  };
}

import type { SowingPlanRow } from "./types";

/** Fields/events own their server version; later local media changes own the photo view. */
export function createHusMediaPublication() {
  const revisions = new Map<string, number>();
  const checkpoint = (id: string) => revisions.get(id) ?? 0;
  return {
    checkpoint,
    changed(id: string) { revisions.set(id, checkpoint(id) + 1); },
    acknowledge(current: SowingPlanRow, saved: SowingPlanRow, startedAt: number): SowingPlanRow {
      if (current.id !== saved.id || checkpoint(saved.id) === startedAt) return saved;
      // An intentional event deletion still removes its linked photos. Never union
      // photo arrays: doing so would resurrect a photo deleted during the write.
      const events = new Set((saved.husEvents ?? []).map(event => event.id));
      const husPhotos = current.husPhotos?.filter(photo => !photo.husEventId || events.has(photo.husEventId));
      const photoIds = new Set((husPhotos ?? []).map(photo => photo.id));
      return { ...saved, husPhotos, husNotes: current.husNotes?.map(note => ({
        ...note, photos: note.photos?.filter(photo => photoIds.has(photo.id)),
      })) };
    },
  };
}

import { describe, expect, it, vi } from "vitest";
import { enqueueRowSave } from "./row-save-queue";
import { createWorkspaceReadOrder } from "./workspace-read-order";
import { createHusMediaPublication } from "./hus-media-publication";
import { demoPlanRows } from "./demo-data";
import type { HusPhotoEntry, SowingPlanRow } from "./types";

describe("combined review: row acknowledgement versus newer media", () => {
  it.each(["upload", "delete"] as const)("late field acknowledgement preserves the visible %s result", async action => {
    const order = createWorkspaceReadOrder();
    const media = createHusMediaPublication();
    const photo: HusPhotoEntry = { id: "photo", sowingPlanRowId: demoPlanRows[0].id,
      storageBucket: "hus-photos", storagePath: "synthetic/photo.png", originalFileName: "photo.png",
      contentType: "image/png", fileSizeBytes: 10 };
    const original: SowingPlanRow = { ...demoPlanRows[0], variety: "before", husPhotos: action === "delete" ? [photo] : [] };
    let visible = original;
    let db = original;
    let deliver!: (row: SowingPlanRow) => void;
    let started!: () => void;
    const awaitingResponse = new Promise<SowingPlanRow>(resolve => { deliver = resolve; });
    const writeStarted = new Promise<void>(resolve => { started = resolve; });
    const chains = new Map<string, Promise<SowingPlanRow>>();
    const checkpoint = media.checkpoint(original.id);
    order.invalidate(); // updatePlanRow's optimistic update
    visible = { ...visible, variety: "after" };
    const write = enqueueRowSave(chains, original, async latest => {
      const end = order.beginMutation();
      try {
        db = { ...latest, variety: "after" };
        const serverSnapshot = { ...db }; // server read before media commits, response delayed
        started();
        await awaitingResponse;
        return serverSnapshot;
      } finally { end(); }
    }, {
      recover: vi.fn(), failed: vi.fn(),
      saved: row => { order.invalidate(); visible = media.acknowledge(visible, row, checkpoint); },
    });
    await writeStarted;
    const endMedia = order.beginMutation();
    const newPhotos = action === "upload" ? [photo] : [];
    db = { ...db, husPhotos: newPhotos };
    endMedia();
    media.changed(original.id);
    visible = { ...visible, husPhotos: newPhotos };
    expect(visible.husPhotos).toEqual(newPhotos);
    deliver(db);
    await write;
    expect(db.husPhotos).toEqual(newPhotos);
    expect(visible.variety).toBe("after");
    expect(visible.husPhotos).toEqual(db.husPhotos);
    expect(chains.size).toBe(0);
  });
});

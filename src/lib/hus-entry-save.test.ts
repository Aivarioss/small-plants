import { describe, expect, it, vi } from "vitest";
import { buildHusEntrySubmission, containsSavedHusEntries, createHusEntrySaveOperation, persistHusEntries } from "./hus-entry-save";
import { applyHusEventSave, calculatePlantBalance } from "./planning";
import type { HusEventEntry, SowingPlanRow } from "./types";

const row: SowingPlanRow = {
  id: "hus-6", sectorName: "HUS 6", requiredPlants: 3556, extraPlants: 100, variety: "Baltazsara",
  sowingDate: "2026-09-29", harvestDate: "2026-10-21", cycleLength: 23, sectorType: 26,
  plantsPerBox: 30, correction: 0, husEvents: [], plantCorrections: [],
};
const event: HusEventEntry = { id: "stable-event", eventDate: "2026-10-08", eventType: "move",
  location: "A7", destinationLocation: "C1-C24", plantChange: -52, plantCorrectionId: "stable-correction" };
const file = new File(["photo"], "roots.jpg", { type: "image/jpeg" });

describe("unified HUS entry save", () => {
  it("assigns each damaged table's photos to exactly its own event", () => {
    const otherFile = new File(["other"], "other.jpg", { type: "image/jpeg" });
    const submission = buildHusEntrySubmission({ entry: null, eventType: "brownRoots", eventDate: "2026-10-19", note: "Saknes",
      readOnly: false, otherLocation: "", validMovementRows: [],
      validBrownRootsRows: [{ id: "C7-event", location: "C7", amount: 10 }, { id: "C8-event", location: "C8", amount: 20 }],
      photos: [{ target: "C7-event", file }, { target: "C8-event", file: otherFile }],
    });
    expect(submission.entries.map((entry) => [entry.id, entry.location, entry.plantChange])).toEqual([["C7-event", "C7", -10], ["C8-event", "C8", -20]]);
    expect(submission.media).toEqual([{ eventId: "C7-event", files: [file] }, { eventId: "C8-event", files: [otherFile] }]);
    expect(new Set(submission.entries.map((entry) => entry.plantCorrectionId)).size).toBe(2);
  });

  it("stores archived observations only as notes, retaining date, location and chosen photos", () => {
    const submission = buildHusEntrySubmission({ entry: null, eventType: "other", eventDate: "2026-10-23", note: "Novērojums",
      readOnly: true, otherLocation: "C7", validMovementRows: [], validBrownRootsRows: [], photos: [{ target: "entry", file }],
    });
    expect(submission.entries).toEqual([]);
    expect(submission.media).toEqual([{ files: [file], note: "Novērojums\n\nGalds: C7", observationDate: "2026-10-23" }]);
  });

  it("awaits confirmed events before uploading photos and shares double-click requests", async () => {
    let confirm!: () => void;
    const pending = new Promise<void>((resolve) => { confirm = resolve; });
    const saveEvents = vi.fn().mockReturnValue(pending), upload = vi.fn().mockResolvedValue(undefined);
    const operation = createHusEntrySaveOperation({ entries: [event], media: [{ eventId: event.id, files: [file] }] });
    const first = operation.save({ saveEvents, upload });
    const second = operation.save({ saveEvents, upload });
    expect(first).toBe(second);
    expect(upload).not.toHaveBeenCalled();
    confirm();
    await first;
    expect(saveEvents).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ eventId: event.id, files: [file] }));
  });

  it("retries only failed photo batches, retaining upload IDs and one loss correction", async () => {
    const other = { ...event, id: "roots-C8", eventType: "brownRoots" as const, location: "C8", plantCorrectionId: "loss-C8", plantChange: -7 };
    let saved = structuredClone(row);
    const saveEvents = vi.fn(async (entries: HusEventEntry[]) => {
      entries.forEach((entry) => { saved = { ...saved, ...applyHusEventSave(saved, entry) }; });
    });
    const upload = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce(undefined);
    const operation = createHusEntrySaveOperation({ entries: [event, other], media: [
      { eventId: event.id, files: [file] }, { eventId: other.id, files: [file] },
    ] });
    await expect(operation.save({ saveEvents, upload })).rejects.toThrow("network");
    expect(operation.eventsSaved).toBe(true);
    expect(operation.uploadedBatches).toBe(1);
    await operation.save({ saveEvents, upload });
    expect(saveEvents).toHaveBeenCalledTimes(1);
    expect(upload.mock.calls.map(([input]) => input.eventId)).toEqual([event.id, other.id, other.id]);
    expect(upload.mock.calls[1][0].uploadId).toBe(upload.mock.calls[2][0].uploadId);
    expect(upload.mock.calls[0][0].uploadId).not.toBe(upload.mock.calls[1][0].uploadId);
    expect(saved.husEvents).toHaveLength(2);
    expect(saved.plantCorrections).toHaveLength(2);
    expect(calculatePlantBalance(saved).correctionTotal).toBe(-59);
  });

  it("does not upload on event failure and retries the same event/correction IDs", async () => {
    const saveEvents = vi.fn().mockRejectedValueOnce(new Error("save failed")).mockResolvedValueOnce(undefined);
    const upload = vi.fn().mockResolvedValue(undefined);
    const operation = createHusEntrySaveOperation({ entries: [event], media: [{ files: [file], eventId: event.id }] });
    await expect(operation.save({ saveEvents, upload })).rejects.toThrow("save failed");
    expect(upload).not.toHaveBeenCalled();
    await operation.save({ saveEvents, upload });
    expect(saveEvents.mock.calls[0]).toEqual(saveEvents.mock.calls[1]);
  });

  it("allows an archived observation without writing any production events", async () => {
    const saveEvents = vi.fn(), upload = vi.fn().mockResolvedValue(undefined);
    await createHusEntrySaveOperation({ entries: [], media: [{ note: "Saknes pārbaudītas", files: [file] }] }).save({ saveEvents, upload });
    expect(saveEvents).not.toHaveBeenCalled();
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it("reconciles a lost success response and never repeats the saved event or loss", async () => {
    let stored = structuredClone(row);
    const repository = { load: vi.fn(async () => [structuredClone(stored)]), update: vi.fn(async (next: SowingPlanRow) => {
      stored = next;
      throw new TypeError("Failed to fetch");
    }) };
    await persistHusEntries(row.id, [event], repository);
    await persistHusEntries(row.id, [event], repository);
    expect(repository.update).toHaveBeenCalledTimes(1);
    expect(stored.husEvents).toHaveLength(1);
    expect(stored.plantCorrections).toHaveLength(1);
    expect(calculatePlantBalance(stored).correctionTotal).toBe(-52);
  });

  it("repairs a partially saved loss using its original correction ID", async () => {
    let stored = { ...row, plantCorrections: [{ id: event.plantCorrectionId!, date: event.eventDate, amount: -52, reason: "thinning" as const }] };
    const repository = { load: async () => [stored], update: vi.fn(async (next: SowingPlanRow) => { stored = next as typeof stored; return next; }) };
    expect(containsSavedHusEntries(stored, [event])).toBe(false);
    await persistHusEntries(row.id, [event], repository);
    expect(stored.plantCorrections).toHaveLength(1);
    expect(stored.husEvents).toHaveLength(1);
  });

  it("updates an existing loss instead of appending a second correction", async () => {
    let stored: SowingPlanRow = { ...row, ...applyHusEventSave(row, event) };
    const edited = { ...event, plantChange: -60 };
    await persistHusEntries(row.id, [edited], { load: async () => [stored], update: async (next) => { stored = next; return next; } });
    expect(stored.husEvents).toHaveLength(1);
    expect(stored.plantCorrections).toHaveLength(1);
    expect(calculatePlantBalance(stored).correctionTotal).toBe(-60);
  });

  it("refuses archived rows and propagates real failures without false success", async () => {
    const update = vi.fn();
    await expect(persistHusEntries(row.id, [event], { load: async () => [{ ...row, archivedAt: "2026-10-22" }], update })).rejects.toThrow("not active");
    expect(update).not.toHaveBeenCalled();
    await expect(persistHusEntries(row.id, [event], { load: async () => [row], update: async () => { throw new Error("denied"); } })).rejects.toThrow("denied");
  });
});

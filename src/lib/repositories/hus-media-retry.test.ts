import { describe, expect, it, vi } from "vitest";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseHusMediaRepository } from "./supabase-hus-media-repository";
import { buildPhotoArchive } from "@/lib/hus-photo-archive";
import { demoPlanRows } from "@/lib/demo-data";

vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));
const rowId = "11111111-1111-4111-8111-111111111111";
const eventId = "22222222-2222-4222-8222-222222222222";
const uploadId = "33333333-3333-4333-8333-333333333333";
const files = [new File(["one"], "one.jpg", { type: "image/jpeg" }), new File(["two"], "two.jpg", { type: "image/jpeg" })];

function mediaStore() {
  const notes = new Map<string, Record<string, unknown>>();
  const photos = new Map<string, Record<string, unknown>>();
  const upload = vi.fn().mockResolvedValue({ error: null });
  const remove = vi.fn().mockResolvedValue({ error: null });
  const client = {
    storage: { from: vi.fn().mockReturnValue({ upload, remove,
      download: vi.fn(async () => ({ data: new Blob(["saved image"]), error: null })),
    }) },
    from: vi.fn((table: string) => {
      if (table === "sowing_plan_rows" || table === "hus_events") {
        const query = { eq: vi.fn().mockReturnThis(), maybeSingle: async () => ({ data: { id: table === "hus_events" ? eventId : rowId }, error: null }) };
        return { select: () => query };
      }
      const records = table === "hus_notes" ? notes : table === "hus_photos" ? photos : undefined;
      if (!records) throw new Error("Unexpected write to " + table);
      return {
        select: () => ({
          in: async (_field: string, ids: string[]) => ({ data: ids.flatMap((id) => records.has(id) ? [records.get(id)] : []), error: null }),
          eq: (_field: string, id: string) => ({ maybeSingle: async () => ({ data: records.get(id) ?? null, error: null }) }),
        }),
        insert: (input: Record<string, unknown> | Record<string, unknown>[]) => {
          const values = Array.isArray(input) ? input : [input];
          values.forEach((record) => {
            if (records.has(String(record.id))) throw new Error("Duplicate primary key");
            records.set(String(record.id), record);
          });
          return { select: () => Array.isArray(input) ? Promise.resolve({ data: values, error: null })
            : { single: async () => ({ data: input, error: null }) } };
        },
        delete: () => ({ eq: async (_field: string, id: string) => { records.delete(id); return { error: null }; } }),
      };
    }),
  };
  vi.mocked(createSupabaseServerClient).mockReturnValue(client as never);
  return { client, notes, photos, upload, remove };
}

describe("HUS media retry identity", () => {
  it("returns the same event photos after a lost response, without uploading or copying again", async () => {
    const store = mediaStore();
    const repository = createSupabaseHusMediaRepository();
    const input = { rowId, eventId, uploadId, files };
    const first = await repository.save(input);
    const retried = await repository.save(input);
    expect(retried.photos).toEqual(first.photos);
    expect(store.photos.size).toBe(2);
    expect(store.upload).toHaveBeenCalledTimes(2);
    expect(store.notes.size).toBe(0);
    expect(store.remove).not.toHaveBeenCalled();
    expect(retried.photos.every((photo) => photo.husEventId === eventId)).toBe(true);
  });

  it("keeps a single archived observation and all its photos when retried", async () => {
    const store = mediaStore();
    const repository = createSupabaseHusMediaRepository();
    const input = { rowId, uploadId, files, note: "Brūnās saknes\n\nGalds: C7", observationDate: "2026-10-23" };
    const first = await repository.save(input);
    const retry = await repository.save(input);
    expect(retry).toEqual(first);
    expect(store.notes.size).toBe(1);
    expect(store.photos.size).toBe(2);
    expect(store.upload).toHaveBeenCalledTimes(2);
    const source = { ...demoPlanRows[0], id: rowId, archivedAt: "2026-10-22", husNotes: [retry.note!], husPhotos: retry.photos };
    const archive = buildPhotoArchive([], [source]);
    expect(archive).toHaveLength(2);
    expect(archive.every((photo) => photo.description === "Brūnās saknes" && photo.location === "C7" && photo.date === "2026-10-23")).toBe(true);
    expect(store.client.from.mock.calls.some(([table]) => table === "hus_events" || table === "plant_corrections")).toBe(false);
  });

  it("recovers a failed batch with the same IDs, keeping unrelated saved media", async () => {
    const store = mediaStore();
    const repository = createSupabaseHusMediaRepository();
    await repository.save({ rowId, uploadId, files: [files[0]], note: "Existing note" });
    const existingNote = [...store.notes.keys()];
    const retryInput = { rowId, eventId, uploadId: "44444444-4444-4444-8444-444444444444", files };
    store.upload.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ error: { message: "storage unavailable" } });
    await expect(repository.save(retryInput)).rejects.toThrow("storage unavailable");
    expect(store.photos.size).toBe(1);
    expect([...store.notes.keys()]).toEqual(existingNote);
    const retried = await repository.save(retryInput);
    expect(retried.photos).toHaveLength(2);
    expect(store.photos.size).toBe(3);
  });

  it("refuses reusing an upload identity for another event or different note", async () => {
    const store = mediaStore();
    const repository = createSupabaseHusMediaRepository();
    await repository.save({ rowId, eventId, uploadId, files });
    await expect(repository.save({ rowId, eventId: "another-event", uploadId, files })).rejects.toThrow("different photo");
    expect(store.upload).toHaveBeenCalledTimes(2);
    const noteInput = { rowId, uploadId: "44444444-4444-4444-8444-444444444444", files: [], note: "First note" };
    await repository.save(noteInput);
    await expect(repository.save({ ...noteInput, note: "Different note" })).rejects.toThrow("different note");
    expect(store.notes.size).toBe(1);
  });
});

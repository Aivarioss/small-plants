import { describe, expect, it, vi } from "vitest";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseHusMediaRepository } from "./supabase-hus-media-repository";
import type { HusNoteRecord, HusPhotoRecord } from "@/lib/supabase/database";

vi.mock("@/lib/supabase/server", () => ({ createSupabaseServerClient: vi.fn() }));
const rowId = "11111111-1111-4111-8111-111111111111";
const eventId = "22222222-2222-4222-8222-222222222222";
const uploadId = "33333333-3333-4333-8333-333333333333";
const input = { rowId, eventId, uploadId, files: [new File(["demo"], "roots.jpg", { type: "image/jpeg" })] };

function fixture() {
  const photos = new Map<string, HusPhotoRecord>();
  const notes = new Map<string, HusNoteRecord>();
  const files = new Map<string, Blob>();
  const faults = { metadata: "" as "" | "before" | "after", download: false };
  const upload = vi.fn(async (path: string, buffer: Buffer) => {
    if (files.has(path)) return { error: { message: "The resource already exists", statusCode: "409" } };
    files.set(path, new Blob([new Uint8Array(buffer)]));
    return { error: null };
  });
  const remove = vi.fn(async (paths: string[]) => { paths.forEach((p) => files.delete(p)); return { error: null }; });
  const download = vi.fn(async (path: string) => faults.download
    ? { data: null, error: { message: "network", statusCode: "503" } }
    : files.has(path) ? { data: files.get(path), error: null }
      : { data: null, error: { message: "Object not found", statusCode: "404" } });
  const existing = (data: unknown) => {
    const chain = { eq: vi.fn(), maybeSingle: vi.fn().mockResolvedValue({ data, error: null }) };
    chain.eq.mockReturnValue(chain);
    return { select: vi.fn().mockReturnValue(chain) };
  };
  const client = {
    storage: { from: vi.fn().mockReturnValue({ upload, download, remove }) },
    from: vi.fn((table: string) => {
      if (table === "sowing_plan_rows") return existing({ id: rowId });
      if (table === "hus_events") return existing({ id: eventId });
      if (table === "hus_notes") return {
        select: vi.fn().mockReturnValue({ eq: vi.fn((_field: string, id: string) => ({ maybeSingle: async () => ({ data: notes.get(id) ?? null, error: null }) })) }),
        insert: vi.fn((record: HusNoteRecord) => ({ select: () => ({ single: async () => {
          notes.set(record.id, record); return { data: record, error: null };
        } }) })),
        delete: vi.fn().mockReturnValue({ eq: async (_field: string, id: string) => { notes.delete(id);
          for (const [photoId, photo] of photos) if (photo.hus_note_id === id) photos.delete(photoId);
          return { error: null }; } }),
      };
      if (table === "hus_photos") return {
        select: vi.fn().mockReturnValue({ in: async (_field: string, ids: string[]) => ({ data: ids.flatMap((id) => photos.has(id) ? [photos.get(id)] : []), error: null }) }),
        insert: vi.fn((records: HusPhotoRecord[]) => ({ select: async () => {
          if (faults.metadata !== "before") records.forEach((r) => photos.set(r.id, r));
          if (faults.metadata) { faults.metadata = ""; return { data: null, error: { message: "response lost" } }; }
          return { data: records, error: null };
        } })),
      };
      throw new Error(`Unexpected table ${table}`);
    }),
  };
  vi.mocked(createSupabaseServerClient).mockReturnValue(client as never);
  return { repo: createSupabaseHusMediaRepository(), photos, notes, files, faults, upload, remove };
}

describe("overlapping photo retry regression", () => {
  it.each(["event", "note"])("retains committed %s photos when the first request fails before metadata", async (target) => {
    const f = fixture();
    const batch = { ...input, eventId: target === "event" ? eventId : undefined, note: target === "note" ? "Concurrent retry" : undefined, files: [...input.files, new File(["second"], "second.jpg", { type: "image/jpeg" })] };
    const normalUpload = f.upload.getMockImplementation()!;
    let release!: () => void;
    let entered!: () => void;
    const paused = new Promise<void>((resolve) => { entered = resolve; });
    const resume = new Promise<void>((resolve) => { release = resolve; });
    let calls = 0;
    f.upload.mockImplementation(async (path, buffer) => {
      calls += 1;
      if (calls === 2) {
        entered(); await resume;
        return { error: { message: "connection lost", statusCode: "503" } };
      }
      return normalUpload(path, buffer);
    });
    const first = f.repo.save(batch);
    const rejected = expect(first).rejects.toThrow();
    await paused;
    const retry = await f.repo.save(batch);
    expect(retry.photos).toHaveLength(2);
    expect(retry.photos.every(photo => f.files.has(photo.storagePath))).toBe(true);
    f.faults.download = true;
    release();
    await rejected;
    expect(retry.photos.every(photo => f.files.has(photo.storagePath))).toBe(true);
    expect(f.photos.size).toBe(2);
    expect(f.notes.size).toBe(target === "note" ? 1 : 0);
    expect(f.remove).not.toHaveBeenCalled();
    f.faults.download = false;
    const finalRetry = await f.repo.save(batch);
    expect(finalRetry.photos.map(photo => photo.id)).toEqual(retry.photos.map(photo => photo.id));
    expect(f.photos.size).toBe(2);
    expect(f.files.size).toBe(2);
  });
});

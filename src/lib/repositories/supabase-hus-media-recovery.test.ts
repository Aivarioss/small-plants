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
        delete: vi.fn().mockReturnValue({ eq: async (_field: string, id: string) => { notes.delete(id); return { error: null }; } }),
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

describe("HUS photo outcome recovery", () => {
  it.each(["event", "note"])("retains committed %s photos and retries without duplicating or deleting them", async (target) => {
    const f = fixture();
    const submission = target === "event" ? input : { ...input, eventId: undefined, note: "Observation" };
    f.faults.metadata = "after";
    await expect(f.repo.save(submission)).rejects.toThrow("response lost");
    expect(f.photos.size).toBe(1);
    expect(f.files.size).toBe(1);
    if (target === "note") expect(f.notes.size).toBe(1);
    const retried = await f.repo.save(submission);
    expect(retried.photos).toHaveLength(1);
    expect(f.photos.size).toBe(1);
    expect(f.files.has(retried.photos[0].storagePath)).toBe(true);
    expect(f.upload).toHaveBeenCalledTimes(1);
    expect(f.remove).not.toHaveBeenCalled();
  });

  it("reuses the retained object when metadata did not commit, even across midnight", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-10-24T23:59:59Z"));
      const f = fixture();
      f.faults.metadata = "before";
      await expect(f.repo.save(input)).rejects.toThrow("response lost");
      expect(f.photos.size).toBe(0);
      expect(f.files.size).toBe(1);
      const path = [...f.files.keys()][0];
      vi.setSystemTime(new Date("2026-10-25T00:00:01Z"));
      const retried = await f.repo.save(input);
      expect(retried.photos[0].storagePath).toBe(path);
      expect(f.files.size).toBe(1);
      expect(f.photos.size).toBe(1);
      expect(f.remove).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });

  it("repairs a missing object referenced by saved metadata instead of reporting false success", async () => {
    const f = fixture();
    const saved = await f.repo.save(input);
    f.files.clear();
    const repaired = await f.repo.save(input);
    expect(repaired.photos[0].id).toBe(saved.photos[0].id);
    expect(f.files.has(saved.photos[0].storagePath)).toBe(true);
    expect(f.photos.size).toBe(1);
    expect(f.upload).toHaveBeenCalledTimes(2);
  });

  it("does not claim success or overwrite a file when its availability cannot be checked", async () => {
    const f = fixture();
    await f.repo.save(input);
    f.faults.download = true;
    await expect(f.repo.save(input)).rejects.toThrow("Neizdevās pārbaudīt");
    expect(f.upload).toHaveBeenCalledTimes(1);
    expect(f.files.size).toBe(1);
    expect(f.remove).not.toHaveBeenCalled();
  });

  it("never reuses a stable path whose bytes belong to a different photo", async () => {
    const f = fixture(); f.faults.metadata = "before";
    await expect(f.repo.save(input)).rejects.toThrow();
    f.files.set([...f.files.keys()][0], new Blob(["different"]));
    await expect(f.repo.save(input)).rejects.toThrow("Neizdevās augšupielādēt");
    expect(f.photos.size).toBe(0);
    expect(f.remove).not.toHaveBeenCalled();
  });
});

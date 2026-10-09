import { beforeEach, describe, expect, it, vi } from "vitest";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  createSupabaseHusMediaRepository,
  HUS_PHOTO_BUCKET,
  MAX_HUS_PHOTO_BYTES,
  validateHusPhotoFile,
} from "./supabase-hus-media-repository";

vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(),
}));

const rowId = "11111111-1111-4111-8111-111111111111";
const eventId = "22222222-2222-4222-8222-222222222222";
const noteRecord = {
  id: "33333333-3333-4333-8333-333333333333",
  author: null,
  note: "Saknes pārbaudītas",
  observation_date: "2026-10-07",
  sowing_plan_row_id: rowId,
  created_at: "2026-10-07T08:00:00.000Z",
  updated_at: "2026-10-07T08:00:00.000Z",
};
const photoRecord = {
  id: "44444444-4444-4444-8444-444444444444",
  content_type: "image/jpeg" as const,
  file_size_bytes: 4,
  hus_event_id: eventId,
  hus_note_id: null,
  original_file_name: "roots.jpg",
  sowing_plan_row_id: rowId,
  storage_bucket: HUS_PHOTO_BUCKET,
  storage_path: `hus/${rowId}/2026-10-07-photo.jpg`,
  created_at: "2026-10-07T08:00:00.000Z",
};

describe("supabase HUS media repository", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ["photo.jpg", "image/jpeg"],
    ["photo.png", "image/png"],
  ])("accepts %s uploads", (name, contentType) => {
    expect(() => validateHusPhotoFile(new File(["demo"], name, { type: contentType }))).not.toThrow();
  });

  it("rejects unsupported files", () => {
    expect(() => validateHusPhotoFile(new File(["pdf"], "photo.pdf", { type: "application/pdf" }))).toThrow(
      "Atļauti tikai JPEG vai PNG attēli.",
    );
  });

  it("rejects files over 10 MB", () => {
    const file = new File([new Uint8Array(MAX_HUS_PHOTO_BYTES + 1)], "large.jpg", { type: "image/jpeg" });

    expect(() => validateHusPhotoFile(file)).toThrow("Fotogrāfija ir par lielu. Maksimums ir 10 MB.");
  });

  it("saves a free HUS note without photos", async () => {
    const client = clientMock({
      husNotesInsert: noteRecord,
      rowExists: true,
    });
    vi.mocked(createSupabaseServerClient).mockReturnValue(client as never);

    const result = await createSupabaseHusMediaRepository().save({
      files: [],
      note: "Saknes pārbaudītas",
      observationDate: "2026-10-07",
      rowId,
    });

    expect(result.note?.note).toBe("Saknes pārbaudītas");
    expect(result.photos).toEqual([]);
    expect(client.storage.from.mock.results[0].value.upload).not.toHaveBeenCalled();
  });

  it("saves event photos in private storage and metadata", async () => {
    const upload = vi.fn().mockResolvedValue({ error: null });
    const client = clientMock({
      eventExists: true,
      husPhotosInsert: [photoRecord],
      rowExists: true,
      upload,
    });
    vi.mocked(createSupabaseServerClient).mockReturnValue(client as never);

    const result = await createSupabaseHusMediaRepository().save({
      eventId,
      files: [new File(["demo"], "roots.jpg", { type: "image/jpeg" })],
      rowId,
    });

    expect(result.photos).toHaveLength(1);
    expect(result.photos[0].husEventId).toBe(eventId);
    expect(client.storage.from).toHaveBeenCalledWith(HUS_PHOTO_BUCKET);
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it("rejects a tampered event id from another Hus before uploading", async () => {
    const upload = vi.fn().mockResolvedValue({ error: null });
    const client = clientMock({
      eventExists: false,
      rowExists: true,
      upload,
    });
    vi.mocked(createSupabaseServerClient).mockReturnValue(client as never);

    await expect(
      createSupabaseHusMediaRepository().save({
        eventId,
        files: [new File(["demo"], "roots.jpg", { type: "image/jpeg" })],
        rowId,
      }),
    ).rejects.toThrow("HUS notikums netika atrasts.");

    expect(upload).not.toHaveBeenCalled();
  });

  it("cleans a newly created note if photo upload fails", async () => {
    const deleteNote = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: null }),
    });
    const client = clientMock({
      deleteNote,
      husNotesInsert: { ...noteRecord, note: null, observation_date: null },
      rowExists: true,
      upload: vi.fn().mockResolvedValue({ error: { message: "upload failed" } }),
    });
    vi.mocked(createSupabaseServerClient).mockReturnValue(client as never);

    await expect(
      createSupabaseHusMediaRepository().save({
        files: [new File(["demo"], "photo.jpg", { type: "image/jpeg" })],
        rowId,
      }),
    ).rejects.toThrow("Neizdevās augšupielādēt HUS fotogrāfiju");

    expect(deleteNote).toHaveBeenCalledTimes(1);
  });

  it("creates a note container for photo-only HUS entries", async () => {
    const photoOnlyRecord = { ...photoRecord, hus_event_id: null, hus_note_id: noteRecord.id };
    const client = clientMock({
      husNotesInsert: { ...noteRecord, note: null, observation_date: null },
      husPhotosInsert: [photoOnlyRecord],
      rowExists: true,
      upload: vi.fn().mockResolvedValue({ error: null }),
    });
    vi.mocked(createSupabaseServerClient).mockReturnValue(client as never);

    const result = await createSupabaseHusMediaRepository().save({
      files: [new File(["demo"], "photo.jpg", { type: "image/jpeg" })],
      rowId,
    });

    expect(result.note?.note).toBeUndefined();
    expect(result.note?.photos).toHaveLength(1);
    expect(result.photos[0].husNoteId).toBe(noteRecord.id);
  });

  it("cleans uploaded storage when photo metadata insert fails", async () => {
    const remove = vi.fn().mockResolvedValue({ error: null });
    const client = clientMock({
      eventExists: true,
      husPhotosInsertError: { message: "insert failed" },
      remove,
      rowExists: true,
      upload: vi.fn().mockResolvedValue({ error: null }),
    });
    vi.mocked(createSupabaseServerClient).mockReturnValue(client as never);

    await expect(
      createSupabaseHusMediaRepository().save({
        eventId,
        files: [new File(["demo"], "roots.jpg", { type: "image/jpeg" })],
        rowId,
      }),
    ).rejects.toThrow("Neizdevās saglabāt HUS fotogrāfiju metadatus");

    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("downloads a private HUS photo", async () => {
    const blob = new Blob(["jpg"], { type: "image/jpeg" });
    const download = vi.fn().mockResolvedValue({ data: blob, error: null });
    const client = clientMock({
      download,
      photoSelect: photoRecord,
    });
    vi.mocked(createSupabaseServerClient).mockReturnValue(client as never);

    const result = await createSupabaseHusMediaRepository().downloadPhoto(photoRecord.id);

    expect(result.photo.id).toBe(photoRecord.id);
    expect(result.file).toBe(blob);
    expect(download).toHaveBeenCalledWith(photoRecord.storage_path);
  });

  it("deletes photo metadata before removing storage to avoid broken references", async () => {
    const remove = vi.fn().mockResolvedValue({ error: null });
    const deleteEq = vi.fn().mockResolvedValue({ error: null });
    const calls: string[] = [];
    const client = {
      storage: {
        from: vi.fn().mockReturnValue({
          remove: (...args: unknown[]) => {
            calls.push("storage.remove");
            return remove(...args);
          },
        }),
      },
      from: vi.fn((table: string) => {
        if (table !== "hus_photos") {
          throw new Error(`Unexpected table ${table}`);
        }

        return {
          delete: vi.fn().mockReturnValue({
            eq: (...args: unknown[]) => {
              calls.push("db.delete");
              return deleteEq(...args);
            },
          }),
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: photoRecord, error: null }),
            }),
          }),
        };
      }),
    };
    vi.mocked(createSupabaseServerClient).mockReturnValue(client as never);

    await expect(createSupabaseHusMediaRepository().deletePhoto(photoRecord.id)).resolves.toEqual({ storageRemoved: true });

    expect(calls).toEqual(["db.delete", "storage.remove"]);
    expect(remove).toHaveBeenCalledWith([photoRecord.storage_path]);
  });

  it("keeps HUS references clean when storage cleanup fails after metadata delete", async () => {
    const client = {
      storage: {
        from: vi.fn().mockReturnValue({
          remove: vi.fn().mockResolvedValue({ error: { message: "storage failed" } }),
        }),
      },
      from: vi.fn().mockReturnValue({
        delete: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null }),
        }),
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: photoRecord, error: null }),
          }),
        }),
      }),
    };
    vi.mocked(createSupabaseServerClient).mockReturnValue(client as never);

    await expect(createSupabaseHusMediaRepository().deletePhoto(photoRecord.id)).resolves.toEqual({ storageRemoved: false });
  });
});

function clientMock(options: {
  deleteNote?: ReturnType<typeof vi.fn>;
  download?: ReturnType<typeof vi.fn>;
  eventExists?: boolean;
  husNotesInsert?: unknown;
  husPhotosInsert?: unknown[];
  husPhotosInsertError?: unknown;
  photoSelect?: unknown;
  remove?: ReturnType<typeof vi.fn>;
  rowExists?: boolean;
  upload?: ReturnType<typeof vi.fn>;
}) {
  const upload = options.upload ?? vi.fn();
  const remove = options.remove ?? vi.fn();
  const download = options.download ?? vi.fn();

  return {
    storage: {
      from: vi.fn().mockReturnValue({ download, remove, upload }),
    },
    from: vi.fn((table: string) => {
      if (table === "sowing_plan_rows") {
        return selectMaybeSingle(options.rowExists ? { id: rowId } : null);
      }
      if (table === "hus_events") {
        return selectMaybeSingle(options.eventExists ? { id: eventId } : null);
      }
      if (table === "hus_notes") {
        return {
          ...insertSelectSingle(options.husNotesInsert),
          delete: options.deleteNote ?? vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
        };
      }
      if (table === "hus_photos" && options.photoSelect) {
        return selectSingle(options.photoSelect);
      }
      if (table === "hus_photos") {
        return insertSelect(options.husPhotosInsert ?? [], options.husPhotosInsertError ?? null);
      }

      throw new Error(`Unexpected table ${table}`);
    }),
  };
}

function selectMaybeSingle(data: unknown, error: unknown = null) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data, error }),
    }),
  };
}

function selectSingle(data: unknown, error: unknown = null) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data, error }),
      }),
    }),
  };
}

function insertSelectSingle(data: unknown, error: unknown = null) {
  return {
    insert: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data, error }),
      }),
    }),
  };
}

function insertSelect(data: unknown[], error: unknown = null) {
  return {
    insert: vi.fn().mockReturnValue({
      select: vi.fn().mockResolvedValue({ data, error }),
    }),
  };
}

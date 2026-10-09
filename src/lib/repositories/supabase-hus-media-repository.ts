import "server-only";
import type { HusNoteEntry, HusPhotoEntry } from "@/lib/types";
import type { HusNoteRecord, HusPhotoRecord } from "@/lib/supabase/database";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const HUS_PHOTO_BUCKET = "small-plants-hus-photos";
export const MAX_HUS_PHOTO_BYTES = 10 * 1024 * 1024;
export const ALLOWED_HUS_PHOTO_TYPES = ["image/jpeg", "image/png"] as const;

export class HusMediaPersistenceError extends Error {
  code?: string;
  details?: string;
  hint?: string;

  constructor(message: string, error?: unknown) {
    super(error ? `${message}: ${supabaseErrorSummary(error)}` : message);
    this.name = "HusMediaPersistenceError";

    const candidate = error as { code?: unknown; details?: unknown; hint?: unknown };
    this.code = typeof candidate?.code === "string" ? candidate.code : undefined;
    this.details = typeof candidate?.details === "string" ? candidate.details : undefined;
    this.hint = typeof candidate?.hint === "string" ? candidate.hint : undefined;
  }
}

export function isSupabaseHusMediaError(error: unknown): error is HusMediaPersistenceError {
  return error instanceof HusMediaPersistenceError;
}

export type SaveHusMediaInput = {
  eventId?: string;
  files: File[];
  note?: string;
  observationDate?: string;
  rowId: string;
};

export type SavedHusMedia = {
  note?: HusNoteEntry;
  photos: HusPhotoEntry[];
};

export type HusMediaRepository = {
  downloadPhoto: (id: string) => Promise<{ file: Blob; photo: HusPhotoEntry }>;
  save: (input: SaveHusMediaInput) => Promise<SavedHusMedia>;
};

export function createSupabaseHusMediaRepository(): HusMediaRepository {
  return {
    downloadPhoto,
    save,
  };
}

async function save(input: SaveHusMediaInput): Promise<SavedHusMedia> {
  const rowId = input.rowId.trim();
  const eventId = input.eventId?.trim() || undefined;
  const noteText = input.note?.trim() || undefined;
  const observationDate = input.observationDate?.trim() || undefined;
  const files = input.files;

  if (!rowId) {
    throw new Error("Expected a Hus id.");
  }

  if (!noteText && files.length === 0) {
    throw new Error("Pievieno piezīmi vai fotogrāfiju.");
  }

  files.forEach(validateHusPhotoFile);

  const client = createSupabaseServerClient();
  await assertRowExists(client, rowId);
  if (eventId) {
    await assertEventBelongsToRow(client, rowId, eventId);
  }

  const uploadedPaths: string[] = [];
  const storage = client.storage.from(HUS_PHOTO_BUCKET);
  let createdNoteId: string | undefined;

  try {
    let note: HusNoteEntry | undefined;
    let noteId: string | undefined;

    if (!eventId) {
      const noteRecord: HusNoteRecord = {
        id: crypto.randomUUID(),
        author: null,
        note: noteText ?? null,
        observation_date: observationDate || null,
        sowing_plan_row_id: rowId,
      };
      const insert = await client.from("hus_notes").insert(noteRecord).select("*").single();
      if (insert.error) {
        throw new HusMediaPersistenceError("Neizdevās saglabāt HUS piezīmi", insert.error);
      }
      note = recordToHusNote(insert.data as HusNoteRecord, []);
      noteId = note.id;
      createdNoteId = noteId;
    }

    const photoRecords: HusPhotoRecord[] = [];
    for (const file of files) {
      const storagePath = createStoragePath(rowId, file);
      const buffer = Buffer.from(await file.arrayBuffer());
      const upload = await storage.upload(storagePath, buffer, {
        contentType: file.type,
        upsert: false,
      });

      if (upload.error) {
        throw new HusMediaPersistenceError("Neizdevās augšupielādēt HUS fotogrāfiju", upload.error);
      }

      uploadedPaths.push(storagePath);
      photoRecords.push({
        id: crypto.randomUUID(),
        content_type: file.type as HusPhotoRecord["content_type"],
        file_size_bytes: file.size,
        hus_event_id: eventId ?? null,
        hus_note_id: noteId ?? null,
        original_file_name: file.name || "hus-photo",
        sowing_plan_row_id: rowId,
        storage_bucket: HUS_PHOTO_BUCKET,
        storage_path: storagePath,
      });
    }

    let photos: HusPhotoEntry[] = [];
    if (photoRecords.length > 0) {
      const insertPhotos = await client.from("hus_photos").insert(photoRecords).select("*");
      if (insertPhotos.error) {
        throw new HusMediaPersistenceError("Neizdevās saglabāt HUS fotogrāfiju metadatus", insertPhotos.error);
      }
      photos = ((insertPhotos.data ?? []) as HusPhotoRecord[]).map(recordToHusPhoto);
    }

    if (note) {
      note = { ...note, photos };
    }

    return { note, photos };
  } catch (error) {
    if (uploadedPaths.length > 0) {
      await storage.remove(uploadedPaths).catch(() => undefined);
    }
    if (createdNoteId) {
      try {
        await client.from("hus_notes").delete().eq("id", createdNoteId);
      } catch {
        // Best-effort cleanup only; the original upload/persistence error is more useful.
      }
    }
    throw error;
  }
}

async function downloadPhoto(id: string): Promise<{ file: Blob; photo: HusPhotoEntry }> {
  const client = createSupabaseServerClient();
  const { data, error } = await client.from("hus_photos").select("*").eq("id", id).single();
  if (error || !data) {
    throw new HusMediaPersistenceError("Neizdevās ielādēt HUS fotogrāfijas metadatus", error);
  }

  const photo = recordToHusPhoto(data as HusPhotoRecord);
  const download = await client.storage.from(photo.storageBucket).download(photo.storagePath);
  if (download.error || !download.data) {
    throw new HusMediaPersistenceError("Neizdevās atvērt HUS fotogrāfiju", download.error);
  }

  return { file: download.data, photo };
}

export function validateHusPhotoFile(file: File): void {
  if (!ALLOWED_HUS_PHOTO_TYPES.includes(file.type as (typeof ALLOWED_HUS_PHOTO_TYPES)[number])) {
    throw new Error("Atļauti tikai JPEG vai PNG attēli.");
  }

  if (file.size <= 0) {
    throw new Error("Fails ir tukšs.");
  }

  if (file.size > MAX_HUS_PHOTO_BYTES) {
    throw new Error("Fotogrāfija ir par lielu. Maksimums ir 10 MB.");
  }
}

async function assertRowExists(client: ReturnType<typeof createSupabaseServerClient>, rowId: string): Promise<void> {
  const { data, error } = await client.from("sowing_plan_rows").select("id").eq("id", rowId).maybeSingle();
  if (error) {
    throw new HusMediaPersistenceError("Neizdevās pārbaudīt HUS", error);
  }

  if (!data) {
    throw new Error("HUS netika atrasts.");
  }
}

async function assertEventBelongsToRow(
  client: ReturnType<typeof createSupabaseServerClient>,
  rowId: string,
  eventId: string,
): Promise<void> {
  const { data, error } = await client
    .from("hus_events")
    .select("id")
    .eq("id", eventId)
    .eq("sowing_plan_row_id", rowId)
    .maybeSingle();
  if (error) {
    throw new HusMediaPersistenceError("Neizdevās pārbaudīt HUS notikumu", error);
  }

  if (!data) {
    throw new Error("HUS notikums netika atrasts.");
  }
}

function recordToHusNote(record: HusNoteRecord, photos: HusPhotoEntry[]): HusNoteEntry {
  return {
    id: record.id,
    author: record.author ?? undefined,
    createdAt: record.created_at,
    note: record.note ?? undefined,
    observationDate: record.observation_date ?? undefined,
    photos,
    sowingPlanRowId: record.sowing_plan_row_id,
    updatedAt: record.updated_at,
  };
}

function recordToHusPhoto(record: HusPhotoRecord): HusPhotoEntry {
  return {
    id: record.id,
    contentType: record.content_type,
    createdAt: record.created_at,
    fileSizeBytes: record.file_size_bytes,
    husEventId: record.hus_event_id ?? undefined,
    husNoteId: record.hus_note_id ?? undefined,
    originalFileName: record.original_file_name,
    sowingPlanRowId: record.sowing_plan_row_id,
    storageBucket: record.storage_bucket,
    storagePath: record.storage_path,
  };
}

function createStoragePath(rowId: string, file: File): string {
  const extension = file.type === "image/png" ? ".png" : ".jpg";
  const date = new Date().toISOString().slice(0, 10);
  return `hus/${rowId}/${date}-${crypto.randomUUID()}${extension}`;
}

function supabaseErrorSummary(error: unknown): string {
  const candidate = error as { code?: unknown; details?: unknown; hint?: unknown; message?: unknown };
  const parts = [
    typeof candidate.code === "string" ? candidate.code : "",
    typeof candidate.message === "string" ? candidate.message : "",
    typeof candidate.details === "string" ? candidate.details : "",
    typeof candidate.hint === "string" ? candidate.hint : "",
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" · ") : "Supabase operation failed.";
}

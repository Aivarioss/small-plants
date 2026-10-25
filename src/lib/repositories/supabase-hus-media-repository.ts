import "server-only";
import { createHash } from "node:crypto";
import type { HusNoteEntry, HusPhotoEntry } from "@/lib/types";
import type { HusNoteRecord, HusPhotoRecord } from "@/lib/supabase/database";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { photoDetailsToNote, validHusUploadId, validatePhotoDetails, type HusMediaUploadInput } from "@/lib/hus-photo-archive";

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

export type SaveHusMediaInput = HusMediaUploadInput & { rowId: string };

export type SavedHusMedia = {
  note?: HusNoteEntry;
  notes?: HusNoteEntry[];
  photos: HusPhotoEntry[];
};

export type HusMediaRepository = {
  deletePhoto: (id: string) => Promise<{ storageRemoved: boolean }>;
  downloadPhoto: (id: string) => Promise<{ file: Blob; photo: HusPhotoEntry }>;
  save: (input: SaveHusMediaInput) => Promise<SavedHusMedia>;
};

export function createSupabaseHusMediaRepository(): HusMediaRepository {
  return {
    deletePhoto,
    downloadPhoto,
    save,
  };
}

async function save(input: SaveHusMediaInput): Promise<SavedHusMedia> {
  const rowId = input.rowId.trim();
  const uploadId = input.uploadId;
  if (uploadId && !validHusUploadId(uploadId)) throw new Error("Invalid upload id.");
  const eventId = input.eventId?.trim() || undefined;
  const noteText = input.note?.trim() || undefined;
  const observationDate = input.observationDate?.trim() || undefined;
  const files = input.files;
  const photoDetails = input.photoDetails === undefined ? undefined : validatePhotoDetails(input.photoDetails, files.length, eventId);

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

  const photoId = (index: number) => uploadId ? husUploadRecordId(rowId, uploadId, "photo:" + index) : undefined;
  const noteIdFor = (slot: string) => uploadId ? husUploadRecordId(rowId, uploadId, slot) : undefined;
  const existingPhotos = new Map<string, HusPhotoRecord>();
  if (uploadId && files.length) {
    const existing = await client.from("hus_photos").select("*").in("id", files.map((_, index) => photoId(index)!));
    if (existing.error) throw new HusMediaPersistenceError("Neizdevās pārbaudīt iepriekš saglabātos foto", existing.error);
    for (const photo of (existing.data ?? []) as HusPhotoRecord[]) existingPhotos.set(photo.id, photo);
  }
  const uploadedPaths: string[] = [];
  const storage = client.storage.from(HUS_PHOTO_BUCKET);
  const createdNoteIds: string[] = [];
  let metadataWriteStarted = false;

  try {
    let note: HusNoteEntry | undefined;
    let noteId: string | undefined;
    const individualNotes: HusNoteEntry[] = [];

    async function createNote(text?: string, date?: string, slot = "note"): Promise<HusNoteEntry> {
      const stableId = noteIdFor(slot);
      if (stableId) {
        const existing = await client.from("hus_notes").select("*").eq("id", stableId).maybeSingle();
        if (existing.error) throw new HusMediaPersistenceError("Neizdevās pārbaudīt piezīmi", existing.error);
        if (existing.data) {
          const saved = existing.data as HusNoteRecord;
          if (saved.sowing_plan_row_id !== rowId || (saved.note ?? undefined) !== text || (saved.observation_date ?? undefined) !== date) {
            throw new Error("Upload id already belongs to a different note.");
          }
          return recordToHusNote(saved, []);
        }
      }
      const noteRecord: HusNoteRecord = {
        id: stableId ?? crypto.randomUUID(),
        author: null,
        note: text ?? null,
        observation_date: date || null,
        sowing_plan_row_id: rowId,
      };
      const insert = await client.from("hus_notes").insert(noteRecord).select("*").single();
      if (insert.error) {
        throw new HusMediaPersistenceError("Neizdevās saglabāt HUS piezīmi", insert.error);
      }
      const saved = recordToHusNote(insert.data as HusNoteRecord, []);
      createdNoteIds.push(saved.id);
      return saved;
    }

    if (!eventId && (!photoDetails || noteText)) {
      note = await createNote(noteText, observationDate);
      noteId = note.id;
    }

    const photoRecords: HusPhotoRecord[] = [];
    const reusedPhotos: HusPhotoEntry[] = [];
    for (const [index, file] of files.entries()) {
      let photoNoteId = noteId;
      if (photoDetails) {
        const details = photoDetails[index];
        const photoNote = await createNote(photoDetailsToNote(details), details.date, "note:" + index);
        individualNotes.push(photoNote);
        photoNoteId = photoNote.id;
      }
      const stablePhotoId = photoId(index);
      const existing = stablePhotoId ? existingPhotos.get(stablePhotoId) : undefined;
      if (existing) {
        if (existing.sowing_plan_row_id !== rowId || (existing.hus_event_id ?? undefined) !== eventId ||
          (existing.hus_note_id ?? undefined) !== photoNoteId || existing.original_file_name !== file.name ||
          existing.content_type !== file.type || existing.file_size_bytes !== file.size) {
          throw new Error("Upload id already belongs to a different photo.");
        }
        // A previous response can be lost, or an old client may have removed the object.
        // Metadata alone is not proof that the image exists.
        const downloaded = await storage.download(existing.storage_path);
        if (downloaded.error || !downloaded.data) {
          const status = String(downloaded.error?.statusCode ?? "");
          if (status !== "404" && downloaded.error?.message !== "Object not found") {
            throw new HusMediaPersistenceError("Neizdevās pārbaudīt saglabāto HUS foto; mēģini vēlreiz", downloaded.error);
          }
          const restored = await storage.upload(existing.storage_path, Buffer.from(await file.arrayBuffer()), {
            contentType: file.type, upsert: false,
          });
          if (restored.error) throw new HusMediaPersistenceError("Neizdevās atjaunot HUS foto failu", restored.error);
          // This file already has a DB reference: never add it to compensating cleanup.
        }
        reusedPhotos.push(recordToHusPhoto(existing));
        continue;
      }
      const storagePath = createStoragePath(rowId, file, stablePhotoId);
      const buffer = Buffer.from(await file.arrayBuffer());
      const upload = await storage.upload(storagePath, buffer, {
        contentType: file.type,
        upsert: false,
      });

      if (upload.error) {
        // A prior attempt may have uploaded this stable path before its metadata write failed.
        // Never overwrite an unknown object; only reuse it if its bytes match this submission.
        const previous = uploadId ? await storage.download(storagePath) : undefined;
        if (!previous?.data || !buffer.equals(Buffer.from(await previous.data.arrayBuffer()))) {
          throw new HusMediaPersistenceError("Neizdevās augšupielādēt HUS fotogrāfiju", upload.error);
        }
      } else {
        uploadedPaths.push(storagePath);
      }
      photoRecords.push({
        id: stablePhotoId ?? crypto.randomUUID(),
        content_type: file.type as HusPhotoRecord["content_type"],
        file_size_bytes: file.size,
        hus_event_id: eventId ?? null,
        hus_note_id: photoNoteId ?? null,
        original_file_name: file.name || "hus-photo",
        sowing_plan_row_id: rowId,
        storage_bucket: HUS_PHOTO_BUCKET,
        storage_path: storagePath,
      });
    }

    let photos: HusPhotoEntry[] = reusedPhotos;
    if (photoRecords.length > 0) {
      metadataWriteStarted = true;
      const insertPhotos = await client.from("hus_photos").insert(photoRecords).select("*");
      if (insertPhotos.error) {
        throw new HusMediaPersistenceError("Neizdevās saglabāt HUS fotogrāfiju metadatus", insertPhotos.error);
      }
      photos = [...reusedPhotos, ...((insertPhotos.data ?? []) as HusPhotoRecord[]).map(recordToHusPhoto)];
    }

    if (note) {
      const savedNoteId = note.id;
      note = { ...note, photos: photos.filter((photo) => photo.husNoteId === savedNoteId) };
    }

    return {
      note,
      ...(photoDetails ? { notes: individualNotes.map((entry) => ({
        ...entry, photos: photos.filter((photo) => photo.husNoteId === entry.id),
      })) } : {}),
      photos,
    };
  } catch (error) {
    // A failed/lost response does not prove that the DB transaction rolled back.
    // Retain both files and notes once insertion was attempted; retries use stable IDs.
    // Unreferenced files can be reconciled later, but deleting a committed image is irreversible.
    // Stable upload IDs are shared by overlapping retries. Another request may
    // already reference our files/notes even before this request writes metadata.
    // Leave cleanup to delayed reconciliation; request-local state cannot prove ownership.
    if (uploadId || metadataWriteStarted) throw error;
    if (uploadedPaths.length > 0) {
      await storage.remove(uploadedPaths).catch(() => undefined);
    }
    for (const createdNoteId of createdNoteIds) {
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

async function deletePhoto(id: string): Promise<{ storageRemoved: boolean }> {
  const client = createSupabaseServerClient();
  const { data, error } = await client.from("hus_photos").select("*").eq("id", id).single();
  if (error || !data) {
    throw new HusMediaPersistenceError("Neizdevās ielādēt HUS fotogrāfijas metadatus", error);
  }

  const photo = recordToHusPhoto(data as HusPhotoRecord);
  const deleted = await client.from("hus_photos").delete().eq("id", id);
  if (deleted.error) {
    throw new HusMediaPersistenceError("Neizdevās dzēst HUS fotogrāfijas metadatus", deleted.error);
  }

  const removed = await client.storage.from(photo.storageBucket).remove([photo.storagePath]);
  if (removed.error) {
    console.error("HUS photo storage cleanup failed", {
      message: removed.error.message,
      path: photo.storagePath,
    });
    return { storageRemoved: false };
  }

  return { storageRemoved: true };
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

function createStoragePath(rowId: string, file: File, stableId?: string): string {
  const extension = file.type === "image/png" ? ".png" : ".jpg";
  if (stableId) return `hus/${rowId}/${stableId}${extension}`;
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

/** Reuses existing UUID primary keys; no additional table or migration is needed. */
function husUploadRecordId(rowId: string, uploadId: string, slot: string): string {
  const hex = createHash("sha256").update(rowId + ":" + uploadId + ":" + slot).digest("hex").slice(0, 32).split("");
  hex[12] = "4";
  hex[16] = ((parseInt(hex[16], 16) & 3) | 8).toString(16);
  const id = hex.join("");
  return [id.slice(0, 8), id.slice(8, 12), id.slice(12, 16), id.slice(16, 20), id.slice(20)].join("-");
}

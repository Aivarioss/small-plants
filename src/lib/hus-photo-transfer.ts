import type { HusMediaUploadInput } from "./hus-photo-archive";
import type { HusNoteEntry, HusPhotoEntry } from "./types";

export class HusPhotoTransferError extends Error {
  constructor(message: string, public readonly retryable: boolean) { super(message); this.name = "HusPhotoTransferError"; }
}

export function eventPhotoUploads(eventId: string, files: File[]): HusMediaUploadInput[] {
  return files.map(file => ({ eventId, files: [file] }));
}

export type HusMediaResponse = { note?: HusNoteEntry; notes?: HusNoteEntry[]; photos: HusPhotoEntry[] };

/** Successful HTTP alone is not confirmation that all requested images belong to this exact event. */
export function confirmHusMediaResponse(value: unknown, rowId: string, input: HusMediaUploadInput): HusMediaResponse {
  const result = value as HusMediaResponse | null;
  if (!result || !Array.isArray(result.photos) || result.photos.length !== input.files.length ||
    new Set(result.photos.map(photo => photo?.id)).size !== result.photos.length ||
    result.photos.some((photo, index) => !photo || typeof photo.id !== "string" || !photo.id ||
      photo.sowingPlanRowId !== rowId || photo.husEventId !== input.eventId ||
      photo.originalFileName !== input.files[index].name || photo.fileSizeBytes !== input.files[index].size ||
      photo.contentType !== input.files[index].type) ||
    (input.files.length === 0 && (!result.note?.id || result.note.sowingPlanRowId !== rowId))) {
    throw new HusPhotoTransferError("Foto saglabāšanas apstiprinājums nav pilnīgs. / Photo saving has not been fully confirmed.", true);
  }
  if (!input.eventId) {
    const notes = [result.note, ...(Array.isArray(result.notes) ? result.notes : [])].filter(note => note?.sowingPlanRowId === rowId);
    if (result.photos.some(photo => !photo.husNoteId || !notes.some(note => note?.id === photo.husNoteId))) {
      throw new HusPhotoTransferError("Foto piesaiste novērojumam nav apstiprināta. / The photo observation link is unconfirmed.", true);
    }
  }
  return result;
}

export async function sendHusMedia(rowId: string, input: HusMediaUploadInput, request: typeof fetch = fetch): Promise<HusMediaResponse> {
  const body = new FormData();
  body.append("rowId", rowId);
  if (input.uploadId) body.append("uploadId", input.uploadId);
  if (input.eventId) body.append("eventId", input.eventId);
  if (input.note?.trim()) body.append("note", input.note.trim());
  if (input.observationDate) body.append("observationDate", input.observationDate);
  if (input.photoDetails) body.append("photoDetails", JSON.stringify(input.photoDetails));
  input.files.forEach(file => body.append("photos", file));
  let response: Response;
  try { response = await request("/api/hus-media", { method: "POST", body }); }
  catch { throw new HusPhotoTransferError("Foto pieprasījuma atbilde nav saņemta. Saglabāšana nav apstiprināta. / No photo response was received. Saving is unconfirmed.", true); }
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const message = response.status === 401
      ? "Sesija beigusies. Pieslēdzies un atkārto foto saglabāšanu. / Session expired. Sign in and retry saving the photos."
      : response.status === 413
        ? "Foto pieprasījums ir par lielu. / The photo request is too large."
        : typeof result?.error === "string" ? result.error
          : "Foto saglabāšana nav apstiprināta. Mēģini vēlreiz. / Photo saving is unconfirmed. Please retry.";
    throw new HusPhotoTransferError(message, response.status >= 500 || response.status === 429);
  }
  return confirmHusMediaResponse(result, rowId, input);
}

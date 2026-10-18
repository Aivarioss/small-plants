import type { HusPhotoEntry, SowingPlanRow } from "./types";

export type HusPhotoDetails = { description?: string; date?: string; table?: string };
export type HusMediaUploadInput = {
  /** Stable for one dialog submission, including retries after a lost response. */
  uploadId?: string;
  eventId?: string;
  files: File[];
  note?: string;
  observationDate?: string;
  photoDetails?: HusPhotoDetails[];
};

export function validHusUploadId(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
export type PhotoArchiveFilter = "all" | "active" | "archived";
export type PhotoArchiveEntry = {
  photo: HusPhotoEntry;
  rowId: string;
  hus: string;
  archived: boolean;
  date?: string;
  uploadedAt?: string;
  description?: string;
  location?: string;
};

// A readable convention in the existing note field avoids a DB migration.
// Only an explicit final table line is interpreted; table numbers in prose
// and current production placements never imply where a photo was taken.
export function photoDetailsToNote(details: HusPhotoDetails): string | undefined {
  return [details.description?.trim(), details.table?.trim() ? `Galds: ${details.table.trim()}` : undefined]
    .filter(Boolean).join("\n\n") || undefined;
}

export function noteToPhotoDetails(note?: string): Pick<HusPhotoDetails, "description" | "table"> {
  const text = note?.trim();
  if (!text) return {};
  const match = text.match(/(?:^|\n)(?:Galds|Galdi|Table|Tables):[ \t]*([^\n]+)$/i);
  if (!match) return { description: text };
  return { description: text.slice(0, match.index).trim() || undefined, table: match[1].trim() };
}

export function validatePhotoDetails(value: unknown, fileCount: number, eventId?: string): HusPhotoDetails[] {
  if (eventId || !Array.isArray(value) || value.length !== fileCount) {
    throw new Error("Invalid photo details.");
  }
  return value.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error("Invalid photo details.");
    const result: HusPhotoDetails = {};
    for (const key of ["description", "date", "table"] as const) {
      const field = item[key];
      if (field !== undefined && typeof field !== "string") throw new Error("Invalid photo details.");
      if (field?.trim()) result[key] = field.trim();
    }
    if (result.table && /[\r\n]/.test(result.table)) throw new Error("Invalid photo details.");
    if (result.date && (!/^\d{4}-\d{2}-\d{2}$/.test(result.date) ||
      !Number.isFinite(Date.parse(result.date)) || new Date(result.date).toISOString().slice(0, 10) !== result.date)) {
      throw new Error("Invalid photo date.");
    }
    return result;
  });
}

export function buildPhotoArchive(activeRows: SowingPlanRow[], archivedRows: SowingPlanRow[]): PhotoArchiveEntry[] {
  const entries = new Map<string, PhotoArchiveEntry>();
  for (const row of [...activeRows, ...archivedRows]) {
    const notes = (row.husNotes ?? []).filter((note) => note.sowingPlanRowId === row.id);
    const events = row.archivedAt && row.archiveSnapshot ? row.archiveSnapshot.events : row.husEvents ?? [];
    // Live DB relations are authoritative: snapshots must not resurrect deleted photos.
    const photos = row.husPhotos ?? notes.flatMap((note) => note.photos ?? []);
    for (const photo of photos) {
      if (photo.sowingPlanRowId !== row.id) continue;
      const note = notes.find((candidate) => candidate.id === photo.husNoteId);
      const event = events.find((candidate) => candidate.id === photo.husEventId);
      const details = noteToPhotoDetails(note?.note);
      entries.set(photo.id, {
        photo,
        rowId: row.id,
        hus: row.archivedAt ? row.archiveSnapshot?.hus.sectorName ?? row.sectorName : row.sectorName,
        archived: Boolean(row.archivedAt),
        date: note?.observationDate || event?.eventDate || undefined,
        uploadedAt: photo.createdAt,
        description: details.description || event?.note?.trim() || undefined,
        location: details.table || event?.location?.trim() || undefined,
      });
    }
  }
  return [...entries.values()].sort((a, b) =>
    (b.date ?? b.uploadedAt ?? "").localeCompare(a.date ?? a.uploadedAt ?? "") ||
    (b.uploadedAt ?? "").localeCompare(a.uploadedAt ?? "") || a.photo.id.localeCompare(b.photo.id));
}

export function photoArchiveHusTarget(entry: PhotoArchiveEntry): { rowId: string; mode: "active" | "archive" } {
  return { rowId: entry.rowId, mode: entry.archived ? "archive" : "active" };
}

export function filterPhotoArchive(entries: PhotoArchiveEntry[], query: string, filter: PhotoArchiveFilter): PhotoArchiveEntry[] {
  const terms = normalize(query).split(/\s+/).filter(Boolean);
  return entries.filter((entry) => {
    if (filter === "active" && entry.archived || filter === "archived" && !entry.archived) return false;
    const dates = [entry.date, entry.uploadedAt?.slice(0, 10)].filter((date): date is string => Boolean(date));
    const displayDates = dates.map((date) => `${date.slice(8, 10)}.${date.slice(5, 7)}.${date.slice(0, 4)}`);
    const text = normalize([entry.hus, entry.description, entry.location, ...dates, ...displayDates].filter(Boolean).join(" "));
    return terms.every((term) => text.includes(term));
  });
}

export function husPhotoFileUrl(photo: HusPhotoEntry): string {
  return `/api/hus-media/photo/${encodeURIComponent(photo.id)}?v=${encodeURIComponent(photo.createdAt ?? photo.id)}`;
}

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

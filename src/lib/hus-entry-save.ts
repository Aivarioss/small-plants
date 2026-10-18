import { applyHusEventSave, serializeHusEventMovementRows } from "./planning";
import { photoDetailsToNote, type HusMediaUploadInput } from "./hus-photo-archive";
import type { HusEventEntry, SowingPlanRow } from "./types";

export type HusEntrySubmission = {
  entries: HusEventEntry[];
  media: HusMediaUploadInput[];
};

/** One mounted dialog owns one operation: retries retain event/correction IDs and upload progress. */
export function createHusEntrySaveOperation(submission: HusEntrySubmission) {
  const media = submission.media.map((input) => ({ ...input, uploadId: input.uploadId ?? crypto.randomUUID() }));
  let eventsSaved = false;
  let uploadedBatches = 0;
  let running: Promise<void> | undefined;
  return {
    get eventsSaved() { return eventsSaved; },
    get uploadedBatches() { return uploadedBatches; },
    save(dependencies: {
      saveEvents: (entries: HusEventEntry[]) => Promise<void>;
      upload: (input: HusMediaUploadInput) => Promise<void>;
    }): Promise<void> {
      if (running) return running;
      running = (async () => {
        if (!eventsSaved) {
          if (submission.entries.length) await dependencies.saveEvents(submission.entries);
          eventsSaved = true;
        }
        while (uploadedBatches < media.length) {
          await dependencies.upload(media[uploadedBatches]);
          uploadedBatches += 1;
        }
      })().finally(() => { running = undefined; });
      return running;
    },
  };
}

export function containsSavedHusEntries(row: SowingPlanRow, entries: HusEventEntry[]): boolean {
  return entries.every((entry) => {
    const saved = row.husEvents?.find((candidate) => candidate.id === entry.id);
    if (!saved || (["eventDate", "eventType", "location", "destinationLocation", "plantChange", "note"] as const)
      .some((key) => (saved[key] ?? undefined) !== (entry[key] ?? undefined))) return false;
    if (!entry.plantChange) return !saved.plantCorrectionId;
    return saved.plantCorrectionId === entry.plantCorrectionId && row.plantCorrections?.some((correction) =>
      correction.id === entry.plantCorrectionId && correction.amount === entry.plantChange && correction.date === entry.eventDate,
    ) === true;
  });
}

/** Fresh reads and stable IDs reconcile a saved request whose response was lost. */
export async function persistHusEntries(rowId: string, entries: HusEventEntry[], repository: {
  load: () => Promise<SowingPlanRow[]>;
  update: (row: SowingPlanRow) => Promise<SowingPlanRow>;
}): Promise<SowingPlanRow> {
  const row = (await repository.load()).find((candidate) => candidate.id === rowId);
  if (!row || row.archivedAt) throw new Error("HUS nav aktīvs. Pārlādē datus. / HUS is not active. Reload the data.");
  if (containsSavedHusEntries(row, entries)) return row;
  const next = entries.reduce((current, entry) => ({ ...current, ...applyHusEventSave(current, entry) }), row);
  try {
    const saved = await repository.update(next);
    if (!containsSavedHusEntries(saved, entries)) throw new Error("HUS ieraksta saglabāšana nav apstiprināta. / HUS entry save was not confirmed.");
    return saved;
  } catch (error) {
    const reloaded = await repository.load().catch(() => []);
    const recovered = reloaded.find((candidate) => candidate.id === rowId);
    if (recovered && containsSavedHusEntries(recovered, entries)) return recovered;
    throw error;
  }
}

export type HusEntryDraft = {
  entry: HusEventEntry | null;
  eventType: HusEventEntry["eventType"];
  eventDate: string;
  note: string;
  readOnly: boolean;
  otherLocation: string;
  otherPlantChange?: number;
  movePlantChange?: number;
  validMovementRows: { from: string; to: string }[];
  validBrownRootsRows: { id: string; location: string; amount?: number }[];
  photos: { target: string; file: File }[];
};

export function buildHusEntrySubmission(draft: HusEntryDraft, newId = () => crypto.randomUUID()): HusEntrySubmission {
  const { entry, eventType, eventDate, note, readOnly, otherLocation, otherPlantChange, movePlantChange, validMovementRows, validBrownRootsRows, photos } = draft;
    const generalFiles = photos.filter((photo) => photo.target === "entry").map((photo) => photo.file);
    if (readOnly) return { entries: [], media: [{ files: generalFiles,
      note: photoDetailsToNote({ description: note, table: otherLocation }), observationDate: eventDate }] };
    let entries: HusEventEntry[];
    if (eventType === "move") {
      const locations = serializeHusEventMovementRows(validMovementRows);
      entries = [{ ...entry, id: entry?.id ?? newId(), eventDate, eventType,
        location: locations.location, destinationLocation: locations.destinationLocation, plantChange: movePlantChange, note: note.trim() || undefined }];
    } else if (eventType === "brownRoots") {
      entries = validBrownRootsRows.map((draft, index) => ({
        ...(index === 0 ? entry : undefined), id: index === 0 && entry ? entry.id : draft.id,
        eventDate, eventType, location: draft.location,
        plantChange: draft.amount && draft.amount > 0 ? -Math.trunc(draft.amount) : undefined, note: note.trim() || undefined,
      }));
    } else {
      entries = [{ ...entry, id: entry?.id ?? newId(), eventDate, eventType,
        location: otherLocation.trim() || undefined, plantChange: otherPlantChange, note: note.trim() || undefined }];
    }
    entries = entries.map((event) => ({ ...event,
      plantCorrectionId: event.plantChange ? event.plantCorrectionId ?? newId() : undefined,
    }));
    const media = entries.flatMap((event, index) => {
      const target = eventType === "brownRoots" ? validBrownRootsRows[index].id : "entry";
      const files = photos.filter((photo) => photo.target === target).map((photo) => photo.file);
      return files.length ? [{ eventId: event.id, files }] : [];
    });
    return { entries, media };
}

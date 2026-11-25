import { eventPhotoUploads, HusPhotoTransferError } from "./hus-photo-transfer";
import { applyHusEventSave, serializeHusEventMovementRows } from "./planning";
import { photoDetailsToNote, type HusMediaUploadInput } from "./hus-photo-archive";
import type { HusEventEntry, SowingPlanRow } from "./types";

export type HusEntrySubmission = {
  entries: HusEventEntry[];
  media: HusMediaUploadInput[];
};

export type HusEntrySaveProgress = {
  phase: "idle" | "preparing" | "events" | "photos" | "complete" | "failed";
  errorStage?: "preparing" | "events" | "photos";
  failedFile?: string;
  eventsSaved: boolean;
  writeStarted: boolean;
  totalPhotos: number;
  confirmedPhotos: number;
  unconfirmedPhotos: number;
  pendingPhotos: number;
  completedUploads: number;
};

/** Stable per-photo IDs and cached compressed bytes survive failed/lost responses and repeated clicks. */
export function createHusEntrySaveOperation(submission: HusEntrySubmission) {
  const entries = submission.entries.map(entry => ({ ...entry }));
  const media = submission.media.map(input => ({
    input: { ...input, files: [...input.files], uploadId: input.uploadId ?? crypto.randomUUID() },
    prepared: [] as File[], state: "pending" as "pending" | "confirmed" | "unconfirmed",
  }));
  let eventsSaved = false, writeStarted = false;
  let phase: HusEntrySaveProgress["phase"] = "idle";
  let errorStage: HusEntrySaveProgress["errorStage"], failedFile: string | undefined;
  let running: Promise<void> | undefined;
  const count = (state: string) => media.filter(job => job.state === state).reduce((sum, job) => sum + job.input.files.length, 0);
  function progress(): HusEntrySaveProgress {
    return { phase, errorStage, failedFile, eventsSaved, writeStarted,
      totalPhotos: media.reduce((sum, job) => sum + job.input.files.length, 0),
      confirmedPhotos: count("confirmed"), unconfirmedPhotos: count("unconfirmed"), pendingPhotos: count("pending"),
      completedUploads: media.filter(job => job.state === "confirmed").length };
  }
  return {
    get eventsSaved() { return eventsSaved; },
    get uploadedBatches() { return media.filter(job => job.state === "confirmed").length; },
    get progress() { return progress(); },
    save(dependencies: {
      saveEvents: (entries: HusEventEntry[]) => Promise<void>;
      upload: (input: HusMediaUploadInput) => Promise<void>;
      preparePhoto?: (file: File) => Promise<File>;
      onProgress?: (progress: HusEntrySaveProgress) => void;
    }): Promise<void> {
      if (running) return running;
      const notify = () => dependencies.onProgress?.(progress());
      running = (async () => {
        errorStage = undefined; failedFile = undefined;
        try {
          phase = "preparing"; notify();
          // Preparation cannot leave a newly saved event/loss behind. Retrying uploads reuses these exact bytes.
          for (const job of media) {
            if (job.state === "confirmed") continue;
            for (let index = 0; index < job.input.files.length; index++) {
              if (!job.prepared[index]) {
                failedFile = job.input.files[index].name;
                job.prepared[index] = dependencies.preparePhoto
                  ? await dependencies.preparePhoto(job.input.files[index]) : job.input.files[index];
              }
            }
          }
          failedFile = undefined;
          if (!eventsSaved) {
            if (entries.length) { phase = "events"; notify(); writeStarted = true; await dependencies.saveEvents(entries); }
            eventsSaved = true;
          }
          phase = "photos"; notify();
          let firstError: unknown;
          let failed = false;
          for (const job of media) {
            if (job.state === "confirmed") continue;
            writeStarted = true;
            for (let attempt = 0; attempt < 2; attempt++) {
              try {
                await dependencies.upload({ ...job.input, files: job.prepared });
                job.state = "confirmed"; notify(); break;
              } catch (error) {
                // A missing reply is not proof that a photo is absent. Its stable ID makes a retry safe.
                job.state = "unconfirmed"; notify();
                if (attempt === 0 && (error instanceof HusPhotoTransferError && error.retryable || error instanceof TypeError)) continue;
                if (!failed) firstError = error;
                failed = true;
                break;
              }
            }
          }
          if (failed) throw firstError ?? new Error("Foto saglabāšana nav apstiprināta. / Photo saving is unconfirmed.");
          phase = "complete"; notify();
        } catch (error) {
          errorStage = phase === "preparing" || phase === "events" ? phase : "photos";
          phase = "failed"; notify();
          throw error;
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
      return eventPhotoUploads(event.id, files);
    });
    return { entries, media };
}

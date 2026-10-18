"use client";

import { useEffect, useRef, useState } from "react";
import { defaultHusEventDate, getBiologicalCycleDays, getCycleDay, parseHusEventMovementRows } from "@/lib/planning";
import { growingTableSelectionRows } from "@/lib/greenhouse-simulation";
import { formatCycleDay, husEventTypeTitle, t, type AppLanguage } from "@/lib/localization";
import { type HusMediaUploadInput } from "@/lib/hus-photo-archive";
import { buildHusEntrySubmission, createHusEntrySaveOperation } from "@/lib/hus-entry-save";
import type { HusEventEntry, HusEventType, SowingPlanRow } from "@/lib/types";
import { HusEntryPhotos, type HusEntryDraftPhoto } from "./HusEntryPhotos";

function shortDate(date: string) { return date.slice(8, 10) + "." + date.slice(5, 7) + "."; }
function editableHusEventType(type: HusEventType | undefined): "move" | "brownRoots" | "other" {
  return type === "move" || type === "brownRoots" || type === "other" ? type : "other";
}

type MovementDraftRow = {
  id: string;
  from: string;
  to: string;
};

type BrownRootsDraftRow = {
  id: string;
  location: string;
  amount: string;
};

function newDraftId(): string {
  return crypto.randomUUID();
}

function createMovementDraftRows(entry: HusEventEntry | null): MovementDraftRow[] {
  if (entry?.eventType !== "move") {
    return [{ id: newDraftId(), from: "", to: "" }];
  }

  const rows = parseHusEventMovementRows(entry).map((row) => ({ id: newDraftId(), from: row.from, to: row.to }));
  return rows.length > 0 ? rows : [{ id: newDraftId(), from: entry.location ?? "", to: entry.destinationLocation ?? "" }];
}

function createBrownRootsDraftRows(entry: HusEventEntry | null): BrownRootsDraftRow[] {
  if (entry?.eventType !== "brownRoots") {
    return [{ id: newDraftId(), location: "", amount: "" }];
  }

  return [
    {
      id: newDraftId(),
      location: entry.location ?? "",
      amount: typeof entry.plantChange === "number" && entry.plantChange !== 0 ? String(Math.abs(entry.plantChange)) : "0",
    },
  ];
}

export function HusEntryDialog({
  entry,
  onCancel,
  onSaveEvents,
  onUploadMedia,
  readOnly = false,
  language,
  row,
}: {
  entry: HusEventEntry | null;
  onCancel: () => void;
  onSaveEvents: (entries: HusEventEntry[]) => Promise<void>;
  onUploadMedia: (input: HusMediaUploadInput) => Promise<void>;
  readOnly?: boolean;
  language: AppLanguage;
  row: SowingPlanRow;
}) {
  const [eventDate, setEventDate] = useState(() => defaultHusEventDate(entry));
  const [eventType, setEventType] = useState<HusEventType>(() => readOnly ? "other" : editableHusEventType(entry?.eventType));
  const [movementRows, setMovementRows] = useState<MovementDraftRow[]>(() => createMovementDraftRows(entry));
  const [brownRootsRows, setBrownRootsRows] = useState<BrownRootsDraftRow[]>(() => createBrownRootsDraftRows(entry));
  const [moveLossAmount, setMoveLossAmount] = useState(() =>
    entry?.eventType === "move" && typeof entry.plantChange === "number" && entry.plantChange !== 0
      ? String(Math.abs(entry.plantChange))
      : "0",
  );
  const [otherLocation, setOtherLocation] = useState(entry?.eventType === "other" ? entry.location ?? "" : "");
  const [otherPlantChangeMode, setOtherPlantChangeMode] = useState<"none" | "loss" | "addition">(() => {
    if (entry?.eventType !== "other" || typeof entry.plantChange !== "number" || entry.plantChange === 0) {
      return "none";
    }

    return entry.plantChange < 0 ? "loss" : "addition";
  });
  const [otherPlantChangeAmount, setOtherPlantChangeAmount] = useState(() =>
    entry?.eventType === "other" && typeof entry.plantChange === "number" && entry.plantChange !== 0
      ? String(Math.abs(entry.plantChange))
      : "",
  );
  const [note, setNote] = useState(entry?.note ?? "");
  const [photos, setPhotos] = useState<HusEntryDraftPhoto[]>([]);
  const photosRef = useRef<HusEntryDraftPhoto[]>([]);
  const operationRef = useRef<ReturnType<typeof createHusEntrySaveOperation> | null>(null);
  const [busy, setBusy] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [recordSaved, setRecordSaved] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => () => photosRef.current.forEach((photo) => URL.revokeObjectURL(photo.url)), []);

  function addPhotos(target: string, files: File[]) {
    if (files.some((file) => !["image/jpeg", "image/png"].includes(file.type))) {
      setError(language === "lv" ? "Atļauti tikai JPEG vai PNG attēli." : "Only JPEG and PNG images are allowed.");
      return;
    }
    const next = [...photosRef.current, ...files.map((file) => ({ id: newDraftId(), target, file, url: URL.createObjectURL(file) }))];
    photosRef.current = next;
    setPhotos(next);
    setError("");
  }

  function removePhoto(id: string) {
    photosRef.current.filter((photo) => photo.id === id).forEach((photo) => URL.revokeObjectURL(photo.url));
    photosRef.current = photosRef.current.filter((photo) => photo.id !== id);
    setPhotos(photosRef.current);
  }

  function changeType(type: HusEventType) {
    if (type === eventType) return;
    if (photos.length && !window.confirm(language === "lv"
      ? "Mainot ieraksta veidu, izvēlētie foto tiks noņemti. Turpināt?" : "Changing entry type will remove the selected photos. Continue?")) return;
    photosRef.current.forEach((photo) => URL.revokeObjectURL(photo.url));
    photosRef.current = [];
    setPhotos([]);
    setEventType(type);
  }
  const parsedMoveLossAmount = moveLossAmount.trim() === "" ? undefined : Number(moveLossAmount);
  const parsedOtherAmount = otherPlantChangeAmount.trim() === "" ? undefined : Number(otherPlantChangeAmount);
  const cycleDay = eventDate ? getCycleDay(row, eventDate) : 0;
  const maxCycleDay = getBiologicalCycleDays(row);
  const dateOutsideCycle = eventType !== "other" && Boolean(eventDate) && (cycleDay < 1 || cycleDay > maxCycleDay);
  const needsNote = eventType === "other";
  const cleanedMovementRows = movementRows.map((draft) => ({ from: draft.from.trim(), to: draft.to.trim() }));
  const validMovementRows = cleanedMovementRows.filter((draft) => draft.from || draft.to);
  const movementRowsComplete = validMovementRows.length > 0 && validMovementRows.every((draft) => draft.from && growingTableSelectionRows(draft.to).length > 0);
  const cleanedBrownRootsRows = brownRootsRows.map((draft) => ({
    id: draft.id,
    location: draft.location.trim(),
    amount: draft.amount.trim() === "" ? undefined : Number(draft.amount),
  }));
  const validBrownRootsRows = cleanedBrownRootsRows.filter((draft) => draft.location || draft.amount !== undefined);
  const brownRootsRowsComplete =
    new Set(validBrownRootsRows.map((draft) => draft.location.toUpperCase())).size === validBrownRootsRows.length &&
    validBrownRootsRows.length > 0 &&
    validBrownRootsRows.every(
      (draft) => draft.location && draft.amount !== undefined && Number.isInteger(draft.amount) && draft.amount >= 0,
    );
  const moveLossValid =
    parsedMoveLossAmount !== undefined &&
    Number.isFinite(parsedMoveLossAmount) &&
    Number.isInteger(parsedMoveLossAmount) &&
    parsedMoveLossAmount >= 0;
  const otherAmountValid =
    otherPlantChangeMode === "none" ||
    (parsedOtherAmount !== undefined && Number.isFinite(parsedOtherAmount) && Number.isInteger(parsedOtherAmount) && parsedOtherAmount > 0);
  const otherPlantChange =
    otherPlantChangeMode === "none" || parsedOtherAmount === undefined
      ? undefined
      : otherPlantChangeMode === "loss"
        ? -Math.trunc(parsedOtherAmount)
        : Math.trunc(parsedOtherAmount);
  const movePlantChange =
    eventType === "move" && Number.isFinite(parsedMoveLossAmount) && parsedMoveLossAmount !== undefined && parsedMoveLossAmount > 0
      ? -Math.trunc(parsedMoveLossAmount)
      : undefined;
  const canSave =
    Boolean(eventDate) &&
    !dateOutsideCycle &&
    (eventType !== "move" || (movementRowsComplete && moveLossValid)) &&
    (eventType !== "brownRoots" || brownRootsRowsComplete) &&
    (!needsNote || note.trim().length > 0 || photos.length > 0) &&
    otherAmountValid;

  function updateMovementRow(id: string, patch: Partial<MovementDraftRow>) {
    setMovementRows((current) => current.map((draft) => (draft.id === id ? { ...draft, ...patch } : draft)));
  }

  function updateBrownRootsRow(id: string, patch: Partial<BrownRootsDraftRow>) {
    setBrownRootsRows((current) => current.map((draft) => (draft.id === id ? { ...draft, ...patch } : draft)));
  }

  function numericValue(value: string): string {
    return value.replace(/\D/g, "");
  }

  async function saveEntries() {
    if (busy || (!attempted && !canSave)) return;
    if (!operationRef.current) operationRef.current = createHusEntrySaveOperation(buildHusEntrySubmission({
      entry, eventType, eventDate, note, readOnly, otherLocation, otherPlantChange, movePlantChange,
      validMovementRows, validBrownRootsRows, photos,
    }));
    const operation = operationRef.current;
    setAttempted(true);
    setBusy(true);
    setError("");
    try {
      await operation.save({ saveEvents: onSaveEvents, upload: onUploadMedia });
      onCancel();
    } catch (error) {
      setRecordSaved(operation.eventsSaved && !readOnly);
      setError(error instanceof Error ? error.message : language === "lv" ? "Neizdevās saglabāt." : "Could not save.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section aria-modal="true" aria-label={t("husEvents", language)} className="sowing-tables-dialog" role="dialog">
        <div>
          <p className="eyebrow">{t("husEvents", language)}</p>
          <h3>{entry ? t("editEntry", language) : t("addEntry", language)}</h3>
          <span className="dialog-hint">
            {eventDate ? `${shortDate(eventDate)} · ${formatCycleDay(getCycleDay(row, eventDate), language)}` : t("chooseDate", language)}
          </span>
          {dateOutsideCycle ? (
            <span className="dialog-error">
              {language === "lv"
                ? `Datums ir ārpus HUS cikla (${formatCycleDay(1, language)}–${formatCycleDay(maxCycleDay, language)}).`
                : `Date is outside the Hus cycle (${formatCycleDay(1, language)}-${formatCycleDay(maxCycleDay, language)}).`}
            </span>
          ) : null}
        </div>
        <fieldset className="hus-entry-fields" disabled={busy || attempted}>
        <label>
          {t("date", language)}
          <input autoFocus type="date" value={eventDate} onChange={(event) => setEventDate(event.target.value)} />
        </label>
        <div className="segmented segmented--compact hus-event-type-picker" aria-label={language === "lv" ? "Notikuma veids" : "Event type"}>
          {(readOnly ? ["other"] as const : ["move", "brownRoots", "other"] as const).map((type) => (
            <button
              className={eventType === type ? "is-active" : ""}
              key={type}
              disabled={Boolean(entry) && type !== editableHusEventType(entry?.eventType)}
              onClick={() => {
                changeType(type);
              }}
              type="button"
            >
              {type === "other" ? language === "lv" ? "Novērojums" : "Observation" : husEventTypeTitle(type, language)}
            </button>
          ))}
        </div>
        {eventType === "move" ? (
          <div className="event-lines">
            <strong>{language === "lv" ? "Pārvietošanas rindas" : "Movement rows"}</strong>
            {movementRows.map((draft) => (
              <div className="event-line-grid event-line-grid--movement" key={draft.id}>
                <label>
                  {language === "lv" ? "No galda" : "From table"}
                  <input maxLength={40} placeholder="A7" value={draft.from} onChange={(event) => updateMovementRow(draft.id, { from: event.target.value })} />
                </label>
                <label>
                  {language === "lv" ? "Uz galdiem" : "To tables"}
                  <input maxLength={80} placeholder="C1-C10" value={draft.to} onChange={(event) => updateMovementRow(draft.id, { to: event.target.value })} />
                  <span className="dialog-hint">
                    {language === "lv" ? "Faktiskā rinda" : "Actual row"}: {growingTableSelectionRows(draft.to).join(", ") || "—"}
                  </span>
                  {draft.to.trim() && !growingTableSelectionRows(draft.to).length ? (
                    <span className="dialog-error">{language === "lv"
                      ? "Norādi faktiskos augšanas galdus: A14–A26, B1–B26, C1–C26 vai D1–D26."
                      : "Enter actual growing tables: A14–A26, B1–B26, C1–C26 or D1–D26."}</span>
                  ) : null}
                </label>
                <button
                  className="danger-action danger-action--small"
                  disabled={movementRows.length === 1}
                  type="button"
                  onClick={() => setMovementRows((current) => current.filter((row) => row.id !== draft.id))}
                >
                  {t("delete", language)}
                </button>
              </div>
            ))}
            <button
              className="secondary-action"
              type="button"
              onClick={() => setMovementRows((current) => [...current, { id: newDraftId(), from: "", to: "" }])}
            >
              + {language === "lv" ? "Pievienot galdu" : "Add table"}
            </button>
            <label>
              {language === "lv" ? "Kopā izņemtie stādi no visa HUS" : "Total removed plants from this Hus"}
              <input inputMode="numeric" pattern="[0-9]*" placeholder="0" type="text" value={moveLossAmount} onChange={(event) => setMoveLossAmount(numericValue(event.target.value))} />
            </label>
          </div>
        ) : null}
        {eventType === "brownRoots" ? (
          <div className="event-lines">
            <strong>{language === "lv" ? "Bojātie galdi" : "Damaged tables"}</strong>
            {brownRootsRows.map((draft) => (
              <div className="event-line-grid event-line-grid--roots" key={draft.id}>
                <label>
                  {language === "lv" ? "Galds" : "Table"}
                  <input maxLength={40} placeholder="C7" value={draft.location} onChange={(event) => updateBrownRootsRow(draft.id, { location: event.target.value })} />
                </label>
                <label>
                  {language === "lv" ? "Bojātie stādi" : "Damaged plants"}
                  <input inputMode="numeric" pattern="[0-9]*" placeholder="0" type="text" value={draft.amount} onChange={(event) => updateBrownRootsRow(draft.id, { amount: numericValue(event.target.value) })} />
                </label>
                <button
                  className="danger-action danger-action--small"
                  disabled={brownRootsRows.length === 1}
                  type="button"
                  onClick={() => {
                    photos.filter((photo) => photo.target === draft.id).forEach((photo) => removePhoto(photo.id));
                    setBrownRootsRows((current) => current.filter((row) => row.id !== draft.id));
                  }}
                >
                  {t("delete", language)}
                </button>
                <HusEntryPhotos photos={photos.filter((photo) => photo.target === draft.id)} language={language}
                  onAdd={(files) => addPhotos(draft.id, files)} onRemove={removePhoto} />
              </div>
            ))}
            <button
              className="secondary-action"
              type="button"
              onClick={() => setBrownRootsRows((current) => [...current, { id: newDraftId(), location: "", amount: "" }])}
            >
              + {language === "lv" ? "Pievienot galdu" : "Add table"}
            </button>
            {new Set(validBrownRootsRows.map((draft) => draft.location.toUpperCase())).size !== validBrownRootsRows.length ? (
              <p className="dialog-error">{language === "lv" ? "Katru bojāto galdu šajā ierakstā norādi vienu reizi." : "Enter each damaged table only once in this entry."}</p>
            ) : null}
            <strong>
              {language === "lv" ? "Kopā bojāti" : "Total damaged"}:{" "}
              {validBrownRootsRows.reduce((sum, draft) => sum + (typeof draft.amount === "number" && draft.amount > 0 ? draft.amount : 0), 0)}{" "}
              {language === "lv" ? "stādi" : "plants"}
            </strong>
          </div>
        ) : null}
        {eventType === "other" ? (
          <div className="event-lines">
            <label>
              {language === "lv" ? "Galds / vieta" : "Table / location"}
              <input maxLength={80} placeholder="C6" value={otherLocation} onChange={(event) => setOtherLocation(event.target.value)} />
            </label>
            {!readOnly ? <div className="plant-change-field">
              {t("plantChange", language)}
              <div className="segmented segmented--compact plant-change-mode" aria-label={language === "lv" ? "Stādu izmaiņas veids" : "Plant change type"}>
                <button className={otherPlantChangeMode === "none" ? "is-active" : ""} onClick={() => setOtherPlantChangeMode("none")} type="button">
                  {language === "lv" ? "Nav" : "None"}
                </button>
                <button className={otherPlantChangeMode === "loss" ? "is-active" : ""} onClick={() => setOtherPlantChangeMode("loss")} type="button">
                  − {language === "lv" ? "Zudums" : "Loss"}
                </button>
                <button className={otherPlantChangeMode === "addition" ? "is-active" : ""} onClick={() => setOtherPlantChangeMode("addition")} type="button">
                  + {language === "lv" ? "Papildinājums" : "Addition"}
                </button>
              </div>
            </div> : null}
            {otherPlantChangeMode !== "none" && !readOnly ? (
              <label>
                {t("amount", language)}
                <input inputMode="numeric" pattern="[0-9]*" placeholder="20" type="text" value={otherPlantChangeAmount} onChange={(event) => setOtherPlantChangeAmount(numericValue(event.target.value))} />
              </label>
            ) : null}
          </div>
        ) : null}
        <label>
          {t("notes", language)}
          <textarea maxLength={240} rows={3} value={note} onChange={(event) => setNote(event.target.value)} />
        </label>
        {eventType !== "brownRoots" ? <HusEntryPhotos photos={photos.filter((photo) => photo.target === "entry")} language={language}
          onAdd={(files) => addPhotos("entry", files)} onRemove={removePhoto} /> : null}
        </fieldset>
        {recordSaved ? <p className="dialog-hint" role="status">{language === "lv"
          ? "Ieraksts un stādu izmaiņas ir saglabātas. Atkārtoti tiks sūtīti tikai vēl nesaglabātie foto."
          : "The entry and plant changes are saved. Retrying will upload only the remaining photos."}</p> : null}
        {error ? <p className="dialog-error" role="alert">{error}</p> : null}
        <div className="button-row">
          <button className="secondary-action" type="button" disabled={busy} onClick={() => {
            if (attempted && !window.confirm(recordSaved
              ? language === "lv" ? "Ieraksts ir saglabāts, bet daļa foto vēl nav pievienota. Aizvērt logu?"
                : "The entry is saved, but some photos are still missing. Close the dialog?"
              : language === "lv" ? "Saglabāšana vēl nav pilnībā apstiprināta. Ieteicams mēģināt vēlreiz šajā logā. Aizvērt?"
                : "Saving has not been fully confirmed. Retry in this dialog to finish safely. Close?")) return;
            onCancel();
          }}>
            {t("cancel", language)}
          </button>
          <button
            className="primary-action"
            disabled={busy || (!attempted && !canSave)}
            type="button"
            onClick={() => void saveEntries()}
          >
            {busy ? language === "lv" ? "Saglabā…" : "Saving…"
              : attempted ? recordSaved ? language === "lv" ? "Atkārtot foto augšupielādi" : "Retry photo upload"
                : language === "lv" ? "Mēģināt vēlreiz" : "Retry" : t("save", language)}
          </button>
        </div>
      </section>
    </div>
  );
}

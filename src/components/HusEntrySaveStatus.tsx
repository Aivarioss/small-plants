import type { HusEntrySaveProgress } from "@/lib/hus-entry-save";
import type { AppLanguage } from "@/lib/localization";

export type HusEntrySaveMode = "event" | "observation" | "photos";
export function husEntrySaveMessage(progress: HusEntrySaveProgress, language: AppLanguage, mode: HusEntrySaveMode): string {
  const lv = language === "lv";
  if (progress.phase === "preparing") return lv ? "Sagatavo fotogrāfijas…" : "Preparing photos…";
  if (progress.phase === "events") return lv ? "Saglabā notikumu un stādu izmaiņas…" : "Saving the event and plant changes…";
  if (progress.phase === "complete") return mode === "photos"
    ? (lv ? "Foto saglabāti" : "Photos saved") + ": " + progress.confirmedPhotos + "/" + progress.totalPhotos + "."
    : (lv ? mode === "event" ? "Notikums un stādu izmaiņas saglabātas." : "Novērojums saglabāts."
      : mode === "event" ? "Event and plant changes saved." : "Observation saved.") +
      (progress.totalPhotos ? (lv ? " Foto saglabāti: " : " Photos saved: ") + progress.confirmedPhotos + "/" + progress.totalPhotos + "." : "");
  if (mode === "observation" && progress.totalPhotos === 0 && progress.phase === "photos") return lv ? "Saglabā novērojumu…" : "Saving observation…";
  if (mode === "observation" && progress.totalPhotos === 0 && progress.phase === "failed" && progress.errorStage === "photos") return lv
    ? "Novērojuma saglabāšana nav apstiprināta. Atkārto saglabāšanu šajā logā."
    : "Observation saving is unconfirmed. Retry saving in this dialog.";
  if (progress.phase === "photos") return (lv ? "Saglabā foto: " : "Saving photos: ") + progress.confirmedPhotos + "/" + progress.totalPhotos + ".";
  if (progress.errorStage === "preparing") return (lv ? "Neizdevās sagatavot foto" : "Could not prepare photo") +
    (progress.failedFile ? ": " + progress.failedFile : "") + (lv ? mode === "event" ? ". Notikuma un foto saglabāšana netika sākta. Noņem šo foto vai izvēlies to vēlreiz."
        : ". Foto saglabāšana netika sākta. Noņem šo foto vai izvēlies to vēlreiz."
      : mode === "event" ? ". Saving the event and photos has not started. Remove this photo or select it again."
        : ". Saving photos has not started. Remove this photo or select it again.");
  if (progress.errorStage === "events") return lv
    ? "Notikuma saglabāšana nav apstiprināta. Foto vēl nav sūtīti. Atkārto saglabāšanu šajā logā."
    : "Event saving is unconfirmed. Photos have not been sent. Retry saving in this dialog.";
  return (mode === "event" && progress.eventsSaved
    ? lv ? "Notikums un stādu izmaiņas saglabātas. " : "Event and plant changes saved. " : "") +
    (lv ? "Foto apstiprināti: " : "Photos confirmed: ") + progress.confirmedPhotos + "/" + progress.totalPhotos + ". " +
    (progress.unconfirmedPhotos ? (lv ? "Nav apstiprināta saglabāšana: " : "Saving unconfirmed: ") + progress.unconfirmedPhotos + ". " : "") +
    (lv ? "Atkārto foto saglabāšanu šajā logā; jau apstiprinātie foto netiks sūtīti vēlreiz." : "Retry saving photos in this dialog; confirmed photos will not be sent again.");
}

export function HusEntrySaveStatus({ progress, language, mode }: { progress: HusEntrySaveProgress | null; language: AppLanguage; mode: HusEntrySaveMode }) {
  if (!progress || progress.phase === "idle") return null;
  return <p className={progress.phase === "failed" ? "dialog-error" : "dialog-hint"} role="status" aria-live="polite">
    {husEntrySaveMessage(progress, language, mode)}
  </p>;
}

import type { SowingPlanRow } from "./types";
import { SupersededWorkspaceReadError } from "./workspace-read-order";

export class WriteOutcomeError extends Error {
  constructor(public readonly writeStatus: "committed" | "unknown", public readonly ids: string[]) {
    super(writeStatus === "committed"
      ? "Saglabāšana ir apstiprināta, bet datu pārlāde neizdevās. Pārlādē datus; saglabāšanu neatkārto."
      : "Saglabāšanas rezultāts nav apstiprināts. Pārlādē datus un pārbaudi rezultātu.");
    this.name = "WriteOutcomeError";
  }
}

/** Keep the write acknowledgement even when a later refresh fails. */
export async function writeAndRefresh<T, S>(
  write: () => Promise<T>, refresh: () => Promise<S>, verify?: (snapshot: S) => boolean,
  prepare?: () => Promise<unknown>,
) {
  let writeStatus: "committed" | "unknown" | "failed" | "not_started" = "committed";
  let value: T | undefined;
  let error: unknown;
  // Prerequisite outcomes belong to earlier operations, never to this write.
  try { await prepare?.(); }
  catch {
    writeStatus = "not_started";
    error = new Error("Šī darbība nav sākta, jo iepriekšējās izmaiņas jāpārbauda. Ievade saglabāta; pārbaudi datus un mēģini vēlreiz.");
  }
  if (writeStatus !== "not_started") {
    try { value = await write(); }
    catch (caught) {
      error = caught;
      writeStatus = caught instanceof WriteOutcomeError ? caught.writeStatus : "failed";
    }
  }
  let refreshed = false;
  let refreshSuperseded = false;
  let snapshot: S | undefined;
  try {
    snapshot = await refresh(); refreshed = true;
    if (writeStatus === "unknown" && verify?.(snapshot)) writeStatus = "committed";
  } catch (caught) {
    refreshSuperseded = caught instanceof SupersededWorkspaceReadError;
    // A read failure never changes the known write outcome.
  }
  return { writeStatus, refreshed, refreshSuperseded, value, error, snapshot };
}

/** One server SELECT supplies both lists; never combine independently timed reads. */
export async function loadPlanWorkspace(loadRows: () => Promise<SowingPlanRow[]>) {
  const rows = await loadRows();
  const ids = new Set<string>();
  for (const row of rows) {
    if (!row.id || ids.has(row.id)) throw new Error("Plāna atbilde nav viennozīmīga. Pārlādē datus.");
    ids.add(row.id);
  }
  return {
    active: rows.filter(row => !row.archivedAt).sort((a, b) => a.sowingDate.localeCompare(b.sowingDate) || a.id.localeCompare(b.id)),
    archived: rows.filter(row => Boolean(row.archivedAt)).sort((a, b) => (b.archivedAt ?? "").localeCompare(a.archivedAt ?? "") || a.id.localeCompare(b.id)),
  };
}

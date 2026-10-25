import { beforeAll, describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseSowingPlanRepository, importPlanBatch, loadWorkspaceRowsFromSupabase } from "@/lib/repositories/supabase-sowing-plan-repository";
import { createSupabaseHusMediaRepository, HUS_PHOTO_BUCKET } from "@/lib/repositories/supabase-hus-media-repository";
import { applyHusEventSave, buildArchiveSnapshot } from "@/lib/planning";
import { demoPlanRows, plannerConfig } from "@/lib/demo-data";
import { simulateGreenhouseSowing, simulateTwoHusSowing } from "@/lib/greenhouse-sowing-simulator";
import type { SowingPlanRow } from "@/lib/types";
import { createHusMediaPublication } from "@/lib/hus-media-publication";

// Explicitly opt in. Every write is restricted to the prepared loopback-only source stack.
describe.skipIf(process.env.SMALL_PLANTS_LOCAL_INTEGRATION !== "1")("real local Supabase RPC and Storage", () => {
  const repo = createSupabaseSowingPlanRepository();
  const media = createSupabaseHusMediaRepository();
  const run = crypto.randomUUID().slice(0, 8);
  const makeRow = (suffix: string): SowingPlanRow => ({ ...demoPlanRows[0], id: crypto.randomUUID(),
    sectorName: `LOCAL TEST ${run} ${suffix}`, variety: "Synthetic", source: "user", sowingDate: "2027-01-10",
    harvestDate: "2027-02-01", cycleLength: 23, updatedAt: undefined, husEvents: [], plantCorrections: [],
    husPhotos: [], husNotes: [], changeHistory: [], adjustments: undefined, adjustmentSources: undefined, placement: undefined });
  let row: SowingPlanRow;
  let eventId: string;
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jhFEAAAAASUVORK5CYII=", "base64");
  const file = () => new File([png], "synthetic.png", { type: "image/png" });
  beforeAll(async () => {
    const status = JSON.parse(await readFile(new URL("../../supabase-local-test/source/local-status.private.json", import.meta.url), "utf8"));
    const url = status.API_URL ?? status.api_url;
    if (url !== "http://127.0.0.1:56321") throw new Error("Only the prepared loopback source stack is allowed");
    const key = status.SERVICE_ROLE_KEY ?? status.service_role_key ?? status.SECRET_KEY ?? status.secret_key;
    if (!key) throw new Error("Local server key missing");
    process.env.SUPABASE_URL = url;
    process.env.SUPABASE_SERVICE_ROLE_KEY = key;
    const client = createSupabaseServerClient();
    const bucket = await client.storage.getBucket(HUS_PHOTO_BUCKET);
    if (bucket.error) {
      const created = await client.storage.createBucket(HUS_PHOTO_BUCKET, { public: false, fileSizeLimit: 10485760, allowedMimeTypes: ["image/png", "image/jpeg"] });
      if (created.error) throw created.error;
    }
    // The SQL-only migration fixture deliberately used an opaque legacy JSON.
    // For browser tests, replace only that known synthetic fixture with the
    // application's complete archive representation. Never touches hosted data.
    const legacy = (await repo.loadArchived()).find(candidate => candidate.id === "10000000-0000-4000-8000-000000000002");
    if (legacy && (legacy.archiveSnapshot as unknown as { legacy?: boolean })?.legacy) {
      const active = { ...legacy, archivedAt: undefined, archiveSnapshot: undefined };
      const snapshot = buildArchiveSnapshot(active, [active], plannerConfig, legacy.archivedAt!, "Synthetic archive fixture");
      const repaired = await client.from("sowing_plan_rows").update({ archive_snapshot: snapshot }).eq("id", legacy.id);
      if (repaired.error) throw repaired.error;
    }
  });

  it("returns PT409 over real PostgREST instead of retrying a stale version", async () => {
    const input = makeRow("non-retryable conflict");
    input.sectorName = `LOCAL CONFLICT ${input.id}`;
    const created = await repo.create(input);
    const client = createSupabaseServerClient();
    const stored = await client.from("sowing_plan_rows").select("*").eq("id", created.id).single();
    expect(stored.error).toBeNull();
    const response = await client.rpc("save_sowing_plan_row", {
      p_operation: "update", p_row: stored.data, p_expected_updated_at: "2000-01-01T00:00:00Z",
      p_work_adjustments: [], p_table_placement: null, p_plant_corrections: [], p_hus_events: [], p_change_history: [],
    }).abortSignal(AbortSignal.timeout(3000));
    expect(response.status).toBe(409);
    expect(response.error?.code).toBe("PT409");
    expect((await repo.load()).find(row => row.id === created.id)?.updatedAt).toBe(created.updatedAt);
  });

  it("creates, edits several fields, and reloads the actual persisted row", async () => {
    row = await repo.create(makeRow("main"));
    row = await repo.update({ ...row, variety: "Edited", requiredPlants: 3600, extraPlants: 90 });
    const fresh = (await repo.load()).find(candidate => candidate.id === row.id)!;
    expect(fresh).toMatchObject({ variety: "Edited", requiredPlants: 3600, extraPlants: 90 });
    expect(fresh.updatedAt).toBeTruthy();
    row = fresh;
  });

  it("persists Moving and one linked loss together", async () => {
    eventId = crypto.randomUUID();
    row = await repo.update({ ...row, ...applyHusEventSave(row, { id: eventId, eventType: "move", eventDate: "2027-01-18", location: "A7", destinationLocation: "C1-C24", plantChange: -10 }) });
    expect(row.husEvents).toHaveLength(1);
    expect(row.plantCorrections).toHaveLength(1);
    expect(row.husEvents![0].plantCorrectionId).toBe(row.plantCorrections![0].id);
  });

  it("uploads, downloads and replays the same event-photo request without duplication", async () => {
    const input = { rowId: row.id, eventId, uploadId: crypto.randomUUID(), files: [file()] };
    const first = await media.save(input);
    const again = await media.save(input);
    expect(again.photos.map(photo => photo.id)).toEqual(first.photos.map(photo => photo.id));
    const loaded = await media.downloadPhoto(first.photos[0].id);
    expect(Buffer.from(await loaded.file.arrayBuffer())).toEqual(png);
    row = (await repo.load()).find(candidate => candidate.id === row.id)!;
    expect(row.husPhotos).toHaveLength(1);
  });

  it("recovers a lost metadata response by retrying the same upload ID against real Storage/DB", async () => {
    const input = { rowId: row.id, note: "Synthetic observation", uploadId: crypto.randomUUID(), files: [file()] };
    const originalFetch = globalThis.fetch;
    let dropped = false;
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (resource, options) => {
      const response = await originalFetch(resource, options);
      const url = String(resource instanceof Request ? resource.url : resource);
      if (!dropped && url.includes("/rest/v1/hus_photos") && options?.method === "POST") {
        dropped = true;
        throw new TypeError("Synthetic response loss AFTER real metadata request");
      }
      return response;
    });
    try { await expect(media.save(input)).rejects.toThrow(); }
    finally { spy.mockRestore(); }
    expect(dropped).toBe(true);
    await media.save(input);
    row = (await repo.load()).find(candidate => candidate.id === row.id)!;
    expect(row.husPhotos).toHaveLength(2);
    expect(row.husNotes).toHaveLength(1);
  });

  it("archives/restores while preserving events, loss and photo links", async () => {
    const photos = row.husPhotos!.map(photo => photo.id).sort();
    const archived = await repo.archive(row.id, "Local test");
    expect(archived.archivedAt).toBeTruthy();
    await expect(repo.update(archived)).rejects.toThrow();
    row = await repo.restore(row.id);
    expect(row.archivedAt).toBeFalsy();
    expect(row.husPhotos!.map(photo => photo.id).sort()).toEqual(photos);
    expect(row.husEvents).toHaveLength(1);
    expect(row.plantCorrections).toHaveLength(1);
  });

  it("imports multiple HUS atomically, replays receipts, rejects duplicates and simulates without writes", async () => {
    const one = makeRow("import1"), two = makeRow("import2");
    const batch = { id: crypto.randomUUID(), items: [one, two].map(row => ({ operation: "create" as const, row })) };
    const ids = await importPlanBatch(batch);
    expect((await importPlanBatch(batch)).sort()).toEqual(ids.sort());
    const duplicate = { ...one, id: crypto.randomUUID() };
    await expect(importPlanBatch({ id: crypto.randomUUID(), items: [{ operation: "create", row: makeRow("rolled-back") }, { operation: "create", row: duplicate }] })).rejects.toThrow();
    const before = await loadWorkspaceRowsFromSupabase();
    expect(before.filter(candidate => candidate.sectorName.includes(run))).toHaveLength(3);
    simulateGreenhouseSowing(before, plannerConfig, one.id, "2027-01-11", "2026-10-25");
    simulateTwoHusSowing(before, plannerConfig, [{ planRowId: one.id, sowingDate: "2027-01-11" }, { planRowId: two.id, sowingDate: "2027-01-12" }], "2026-10-25");
    expect(await loadWorkspaceRowsFromSupabase()).toEqual(before);
  });

  it.each(["upload", "delete"] as const)("keeps the real %s result when an older field response is delivered afterwards", async action => {
    row = (await repo.load()).find(candidate => candidate.id === row.id)!;
    const publication = createHusMediaPublication();
    const checkpoint = publication.checkpoint(row.id);
    // The DB/RPC read is real; only its delivery to the UI publisher is delayed.
    const heldResponse = await repo.update({ ...row, variety: `Delayed ${action}` });
    if (action === "upload") {
      await media.save({ rowId: row.id, note: "Concurrent local photo", uploadId: crypto.randomUUID(), files: [file()] });
    } else {
      const id = row.husPhotos![row.husPhotos!.length - 1].id;
      expect(await media.deletePhoto(id)).toEqual({ storageRemoved: true });
    }
    publication.changed(row.id);
    const current = (await repo.load()).find(candidate => candidate.id === row.id)!;
    const published = publication.acknowledge(current, heldResponse, checkpoint);
    expect(published.husPhotos).toEqual(current.husPhotos);
    expect(published.husNotes).toEqual(current.husNotes);
    expect(published.updatedAt).toBe(heldResponse.updatedAt);
    expect(published.variety).toBe(`Delayed ${action}`);
    row = current;
  });

  it("allows exactly one of two real concurrent updates using the same version", async () => {
    const original = await repo.create(makeRow("race"));
    const results = await Promise.allSettled([
      repo.update({ ...original, variety: "Concurrent A" }),
      repo.update({ ...original, variety: "Concurrent B" }),
    ]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
    const winner = results.find(result => result.status === "fulfilled")!;
    const saved = (await repo.load()).find(candidate => candidate.id === original.id)!;
    if (winner.status === "fulfilled") expect(saved.variety).toBe(winner.value.variety);
  });

  it("retains the import identity after a real second-connection advisory-lock timeout", async () => {
    const batch = { id: crypto.randomUUID(), items: [{ operation: "create" as const, row: makeRow("lock retry") }] };
    const holder = spawn("C:/Program Files/Docker/Docker/resources/bin/docker.exe", ["exec", "-i", "supabase_db_small-plants-local-test-source", "psql", "-X", "-Atq", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"]);
    let output = "";
    const exited = new Promise<void>((resolve, reject) => {
      holder.once("error", reject);
      holder.once("exit", code => code === 0 ? resolve() : reject(new Error("Local lock connection failed")));
    });
    const locked = new Promise<void>((resolve, reject) => {
      holder.once("error", reject);
      holder.stdout.on("data", chunk => { output += String(chunk); if (output.includes("LOCAL_LOCK_READY")) resolve(); });
    });
    holder.stdin.write(`begin;\nselect pg_advisory_xact_lock(hashtextextended('${batch.id}',0));\nselect 'LOCAL_LOCK_READY';\n`);
    await locked;
    try {
      await expect(importPlanBatch(batch)).rejects.toMatchObject({ writeStatus: "unknown", ids: [batch.items[0].row.id] });
    } finally { holder.stdin.end("commit;\n\\q\n"); await exited; }
    expect(await importPlanBatch(batch)).toEqual([batch.items[0].row.id]);
    expect(await importPlanBatch(batch)).toEqual([batch.items[0].row.id]);
    expect((await repo.load()).filter(candidate => candidate.id === batch.items[0].row.id)).toHaveLength(1);
  });

  it("retries a real uploaded file after its Storage response was lost, without duplicate notes or objects", async () => {
    const before = (await repo.load()).find(candidate => candidate.id === row.id)!;
    const input = { rowId: row.id, note: "Storage response loss", uploadId: crypto.randomUUID(), files: [file()] };
    const originalFetch = globalThis.fetch;
    let dropped = false;
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async (resource, options) => {
      const response = await originalFetch(resource, options);
      const url = String(resource instanceof Request ? resource.url : resource);
      const method = options?.method ?? (resource instanceof Request ? resource.method : "GET");
      if (!dropped && response.ok && url.includes("/storage/v1/object/" + HUS_PHOTO_BUCKET + "/") && method === "POST") {
        dropped = true;
        throw new TypeError("Synthetic loss AFTER actual file upload");
      }
      return response;
    });
    // The SDK may recover the lost file response internally. Either way, the
    // explicit replay below must reuse the same file/note identity.
    try { await media.save(input).catch(error => { expect(error).toBeInstanceOf(Error); }); }
    finally { spy.mockRestore(); }
    expect(dropped).toBe(true);
    const saved = await media.save(input);
    await media.save(input);
    const fresh = (await repo.load()).find(candidate => candidate.id === row.id)!;
    expect(fresh.husPhotos).toHaveLength((before.husPhotos?.length ?? 0) + 1);
    expect(fresh.husNotes).toHaveLength((before.husNotes?.length ?? 0) + 1);
    expect(Buffer.from(await (await media.downloadPhoto(saved.photos[0].id)).file.arrayBuffer())).toEqual(png);
  });
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test, after } from "node:test";

// An optional module URL lets a sandbox reuse an already downloaded package.
// Normal installations resolve the pinned devDependency directly.
const { PGlite } = await import(process.env.PGLITE_MODULE_URL || "@electric-sql/pglite");
const db = new PGlite();
after(async () => { await db.close(); });
const schema = (await readFile(new URL("../supabase/schema.sql", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const migration = (await readFile(new URL("../supabase/migrations/20261024160132_atomic_sowing_plan_save.sql", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const archiveMigration = (await readFile(new URL("../supabase/migrations/20261024172817_atomic_archive_state.sql", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const importMigration = (await readFile(new URL("../supabase/migrations/20261024180627_atomic_plan_import.sql", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
assert.ok(schema.includes(migration) && schema.includes(archiveMigration) && schema.endsWith(importMigration), "Fresh schema and prepared upgrades must agree");
await db.exec("create role anon; create role authenticated; create role service_role;");
// gen_random_uuid is built in to Postgres. The production schema also enables pgcrypto,
// which is not bundled in this WASM test runtime. All tables, triggers and function SQL are unchanged.
await db.exec(schema.replace("create extension if not exists pgcrypto;", ""));

const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const rowId = uid(1), eventId = uid(2), lossId = uid(3), workId = uid(4), photoId = uid(5);
const base = { id: rowId, hus: "TEST atomic", required_plants: 3500, extra_plants: 100,
  variety: "Synthetic", sowing_date: "2026-10-01", move_out_date: "2026-10-23",
  cycle_length: 23, sector_type: 26, correction: 0, status: "planned", source: "user" };
const loss = { id: lossId, sowing_plan_row_id: rowId, correction_date: "2026-10-09", amount: -10, reason: "thinning" };
const event = { id: eventId, sowing_plan_row_id: rowId, event_date: "2026-10-09", event_type: "move",
  location: "A7", destination_location: "C1-C24", plant_change: -10, plant_correction_id: lossId };
const work = { id: workId, sowing_plan_row_id: rowId, work_type: "thinning", dates: ["2026-10-09"], source: "manual", locked: true };
const original = { row: base, work: [work], losses: [loss], events: [event], history: [], placement: null };
async function save(payload = original, op = "update", version) {
  const p = { ...original, ...payload };
  return db.query("select public.save_sowing_plan_row($1, $2::jsonb, $3::timestamptz, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb)",
    [op, JSON.stringify(p.row), version ?? null, JSON.stringify(p.work), JSON.stringify(p.placement),
      JSON.stringify(p.losses), JSON.stringify(p.events), JSON.stringify(p.history)]);
}
const version = async () => (await db.query("select updated_at::text as value from sowing_plan_rows where id=$1", [rowId])).rows[0].value;
const state = async () => {
  const result = {};
  for (const table of ["sowing_plan_rows", "work_adjustments", "table_placements", "plant_corrections", "hus_events", "change_history", "hus_photos"]) {
    result[table] = (await db.query(`select row_to_json(t) as value from ${table} t order by id`)).rows;
  }
  return result;
};
async function reset() {
  await db.exec("truncate sowing_plan_rows cascade;");
  await save(original, "create");
  await db.query("insert into hus_photos(id,sowing_plan_row_id,hus_event_id,storage_path,original_file_name,content_type,file_size_bytes) values ($1,$2,$3,'test.jpg','test.jpg','image/jpeg',4)", [photoId, rowId, eventId]);
}

test("prepared upgrade is repeatable and RPC is restricted to the existing server role", async () => {
  await db.exec(migration);
  const result = await db.query("select has_function_privilege('anon', p.oid, 'execute') as anon, has_function_privilege('authenticated', p.oid, 'execute') as authenticated, has_function_privilege('service_role', p.oid, 'execute') as server from pg_proc p where proname='save_sowing_plan_row'");
  assert.deepEqual(result.rows, [{ anon: false, authenticated: false, server: true }]);
});
test("editing a cycle keeps Moving, its linked loss, retained photo ID and exact timestamps", async () => {
  await reset();
  const v = await version();
  await save({ row: { ...base, extra_plants: 200 } }, "update", v);
  const s = await state();
  assert.equal(s.sowing_plan_rows[0].value.extra_plants, 200);
  assert.equal(s.hus_events[0].value.plant_correction_id, lossId);
  assert.equal(s.plant_corrections[0].value.amount, -10);
  assert.equal(s.hus_photos[0].value.id, photoId);
  await assert.rejects(save(original, "update", v), { code: "40001" });
});
test("failed work, placement, loss, event and history writes roll back the entire edit", async () => {
  const invalid = [
    { work: [{ ...work, dates: [] }] },
    { placement: { id: uid(9), sowing_plan_row_id: rowId, tables: -1, manual: true } },
    { losses: [{ ...loss, amount: 0 }] },
    { events: [{ ...event, event_date: null }] },
    { history: [{ id: uid(6), sowing_plan_row_id: rowId, field: null, from_value: "", to_value: "", note: "" }] },
  ];
  for (const bad of invalid) {
    await reset();
    const before = await state();
    await assert.rejects(save({ ...bad, row: { ...base, variety: "must roll back" } }, "update", await version()));
    assert.deepEqual(await state(), before);
  }
});
test("failed cycle creation leaves no parent or child records", async () => {
  await db.exec("truncate sowing_plan_rows cascade;");
  await assert.rejects(save({ work: [{ ...work, dates: [] }] }, "create"));
  assert.deepEqual((await db.query("select * from sowing_plan_rows")).rows, []);
});
test("two edits with one version cannot silently overwrite each other", async () => {
  await reset();
  const v = await version();
  const results = await Promise.allSettled([
    save({ row: { ...base, extra_plants: 200 } }, "update", v),
    save({ row: { ...base, extra_plants: 300 } }, "update", v),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(results.find((r) => r.status === "rejected").reason.code, "40001");
});
test("archived, missing and unversioned edits are rejected before any data changes", async () => {
  await reset();
  await assert.rejects(save(original, "update"), { code: "40001" });
  await assert.rejects(save({ row: { ...base, id: uid(99) }, work: [], losses: [], events: [] }, "update", await version()), { code: "P0002" });
  await db.query("update sowing_plan_rows set archived_at=now(), archive_snapshot='{}'::jsonb where id=$1", [rowId]);
  const before = await state();
  await assert.rejects(save(original, "update", await version()), { code: "55000" });
  assert.deepEqual(await state(), before);
});
test("incomplete payloads and child UUIDs belonging to another cycle are rejected", async () => {
  await reset();
  const other = { ...base, id: uid(10), hus: "Other" };
  await save({ row: other, work: [], losses: [], events: [] }, "create");
  await db.query("insert into plant_corrections(id,sowing_plan_row_id,correction_date,amount,reason) values ($1,$2,'2026-10-09',-5,'other')", [uid(11), other.id]);
  const before = await state();
  for (const bad of [
    { events: null }, { losses: [] },
    { losses: [{ ...loss, id: uid(11) }], events: [{ ...event, plant_correction_id: uid(11) }] },
    { losses: [{ ...loss, sowing_plan_row_id: other.id }] },
  ]) {
    await assert.rejects(save(bad, "update", await version()));
    assert.deepEqual(await state(), before);
  }
});
test("intentional event/loss deletion removes only the selected history and photo metadata", async () => {
  await reset();
  await save({ events: [], losses: [] }, "update", await version());
  assert.equal((await db.query("select * from hus_events")).rows.length, 0);
  assert.equal((await db.query("select * from plant_corrections")).rows.length, 0);
  assert.equal((await db.query("select * from hus_photos")).rows.length, 0);
  assert.equal((await db.query("select * from work_adjustments")).rows.length, 1);
});


const context = async () => (await db.query("select id, updated_at::text from sowing_plan_rows where archived_at is null order by id")).rows;
const snapshot = { version: 1, hus: { id: rowId }, archivedAt: "2026-10-24T12:00:00Z" };
const otherId = uid(20);
const freeze = { id: uid(21), sowing_plan_row_id: otherId, work_type: "sticks", dates: ["2026-10-20"], source: "optimizer", locked: true };
async function archiveChange(op, overrides = {}) {
  const args = { id: rowId, op, version: await version(), context: await context(), freeze: [freeze],
    at: op === "archive" ? "2026-10-24T12:00:00Z" : null, note: " Done ", snapshot: op === "archive" ? snapshot : null, ...overrides };
  return db.query("select change_sowing_plan_archive($1,$2,$3::timestamptz,$4::jsonb,$5::jsonb,$6::timestamptz,$7,$8::jsonb)",
    [args.id,args.op,args.version,JSON.stringify(args.context),JSON.stringify(args.freeze),args.at,args.note,JSON.stringify(args.snapshot)]);
}
async function archiveSetup(restore = false) {
  await reset();
  await save({ row: { ...base, id: otherId, hus: "Other HUS" }, work: [], losses: [], events: [] }, "create");
  if (restore) await archiveChange("archive", { freeze: [] });
}

test("archive upgrade is repeatable and RPC is server-only", async () => {
  await db.exec(archiveMigration);
  const result = await db.query("select has_function_privilege('anon', p.oid, 'execute') as anon, has_function_privilege('authenticated', p.oid, 'execute') as authenticated, has_function_privilege('service_role', p.oid, 'execute') as server from pg_proc p where proname='change_sowing_plan_archive'");
  assert.deepEqual(result.rows, [{ anon: false, authenticated: false, server: true }]);
});

test("archive and restore preserve snapshot, manual dates, Moving, loss and photos while freezing other HUS", async () => {
  await archiveSetup();
  await archiveChange("archive");
  let s = await state();
  assert.equal(s.sowing_plan_rows.find(r => r.value.id === rowId).value.archived_note, "Done");
  assert.deepEqual(s.sowing_plan_rows.find(r => r.value.id === rowId).value.archive_snapshot, snapshot);
  assert.equal(s.work_adjustments.find(r => r.value.id === freeze.id).value.source, "optimizer");
  assert.equal(s.work_adjustments.find(r => r.value.id === workId).value.source, "manual");
  assert.equal(s.hus_events[0].value.plant_correction_id, lossId);
  assert.equal(s.hus_photos[0].value.id, photoId);
  await archiveChange("restore", { freeze: [] });
  s = await state();
  const restored = s.sowing_plan_rows.find(r => r.value.id === rowId).value;
  assert.equal(restored.archived_at, null);
  assert.equal(restored.archived_note, null);
  assert.deepEqual(restored.archive_snapshot, snapshot);
  assert.equal(s.work_adjustments.length, 2);
});

test("both archive and restore roll back earlier freezes when a later freeze fails", async () => {
  for (const op of ["archive", "restore"]) {
    await archiveSetup(op === "restore");
    const before = await state();
    await assert.rejects(archiveChange(op, { freeze: [freeze, { ...freeze, id: uid(22), work_type: "sideShoots", dates: [] }] }));
    assert.deepEqual(await state(), before);
  }
});

test("both archive and restore roll back freezes if target update fails", async () => {
  await db.exec("create function reject_archive_test() returns trigger language plpgsql as $$ begin raise exception 'forced target failure'; end; $$;");
  for (const op of ["archive", "restore"]) {
    await archiveSetup(op === "restore");
    await db.exec(`create trigger reject_archive_test before update on sowing_plan_rows for each row when (old.id = '${rowId}') execute function reject_archive_test();`);
    const before = await state();
    await assert.rejects(archiveChange(op), /forced target failure/);
    assert.deepEqual(await state(), before);
    await db.exec("drop trigger reject_archive_test on sowing_plan_rows;");
  }
  await db.exec("drop function reject_archive_test();");
});

test("stale target, changed context, new active rows and missing versions reject without side effects", async () => {
  for (const op of ["archive", "restore"]) {
    await archiveSetup(op === "restore");
    const ctx = await context();
    const before = await state();
    for (const bad of [{ version: "2000-01-01T00:00:00Z" }, { version: null }, { context: [] },
      { context: ctx.map(r => ({ ...r, updated_at: "2000-01-01T00:00:00Z" })) },
      { context: ctx.map(r => ({ id: r.id })) }, { context: [...ctx, ctx[0]] }]) {
      await assert.rejects(archiveChange(op, bad), { code: "40001" });
      assert.deepEqual(await state(), before);
    }
    await save({ row: { ...base, id: uid(30), hus: "New concurrent HUS" }, work: [], losses: [], events: [] }, "create");
    const withNewRow = await state();
    await assert.rejects(archiveChange(op, { context: ctx }), { code: "40001" });
    assert.deepEqual(await state(), withNewRow);
  }
});

test("duplicate restore and conflicting manual dates never partially change another HUS", async () => {
  await archiveSetup(true);
  await save({ row: { ...base, id: uid(30), hus: "  test   ATOMIC " }, work: [], losses: [], events: [] }, "create");
  let before = await state();
  await assert.rejects(archiveChange("restore"), { code: "23505" });
  assert.deepEqual(await state(), before);
  await archiveSetup();
  await db.query("insert into work_adjustments(id,sowing_plan_row_id,work_type,dates,source,locked) values($1,$2,'sticks','[\"2026-10-19\"]','manual',true)", [uid(31),otherId]);
  before = await state();
  await assert.rejects(archiveChange("archive"), { code: "23505" });
  assert.deepEqual(await state(), before);
});

test("restore freezes currently active HUS in the same successful transaction", async () => {
  await archiveSetup(true);
  const beforeVersion = (await context())[0].updated_at;
  await archiveChange("restore");
  const s = await state();
  assert.equal(s.sowing_plan_rows.find(r => r.value.id === rowId).value.archived_at, null);
  assert.equal(s.work_adjustments.find(r => r.value.id === freeze.id).value.locked, true);
  assert.notEqual((await context()).find(r => r.id === otherId).updated_at, beforeVersion);
});


test("invalid snapshot and foreign freezes are rejected without modifying any HUS", async () => {
  await archiveSetup();
  const before = await state();
  for (const bad of [{ snapshot: null }, { snapshot: { ...snapshot, hus: { id: otherId } } },
    { freeze: [{ ...freeze, sowing_plan_row_id: rowId }] }, { freeze: [{ ...freeze, sowing_plan_row_id: uid(99) }] },
    { freeze: [{ ...freeze, source: "manual" }] }, { freeze: [{ ...freeze, locked: false }] }]) {
    await assert.rejects(archiveChange("archive", bad), { code: "22023" });
    assert.deepEqual(await state(), before);
  }
});

test("repeated archive or restore with old state cannot reapply freezes", async () => {
  await archiveSetup();
  const v = await version();
  const ctx = await context();
  await archiveChange("archive");
  const archived = await state();
  await assert.rejects(archiveChange("archive", { version: v, context: ctx }), { code: "40001" });
  assert.deepEqual(await state(), archived);
  const archivedVersion = await version();
  await archiveChange("restore", { freeze: [] });
  const restored = await state();
  await assert.rejects(archiveChange("restore", { version: archivedVersion, freeze: [] }), { code: "40001" });
  assert.deepEqual(await state(), restored);
});


const batchItem = (row, operation = "create", expected_updated_at = null, overrides = {}) => ({
  row, operation, expected_updated_at, work: [], placement: null, losses: [], events: [], history: [], ...overrides,
});
async function importBatch(items, id = uid(100), request = items) {
  return db.query("select import_sowing_plan_rows($1,$2::jsonb,$3::jsonb) as ids", [id, JSON.stringify(request), JSON.stringify(items)]);
}
const receipts = async () => (await db.query("select row_to_json(t) as value from sowing_plan_import_operations t order by id")).rows;
async function importSetup() { await db.exec("truncate sowing_plan_import_operations;"); await reset(); }

test("import upgrade is repeatable and restricted to the server role", async () => {
  await db.exec(importMigration);
  const r = await db.query("select has_function_privilege('anon', p.oid, 'execute') as anon, has_function_privilege('authenticated', p.oid, 'execute') as authenticated, has_function_privilege('service_role', p.oid, 'execute') as server from pg_proc p where proname='import_sowing_plan_rows'");
  assert.deepEqual(r.rows, [{ anon: false, authenticated: false, server: true }]);
  assert.equal((await db.query("select relrowsecurity from pg_class where relname='sowing_plan_import_operations'")).rows[0].relrowsecurity, true);
});

test("batch import creates and updates together, retaining Moving, loss and photo links", async () => {
  await importSetup();
  const items = [batchItem({ ...base, variety: "Imported" }, "update", await version(), { work: [work], losses: [loss], events: [event] }),
    batchItem({ ...base, id: uid(40), hus: "New imported HUS" })];
  const result = await importBatch(items);
  assert.deepEqual(result.rows[0].ids, [rowId,uid(40)]);
  const s = await state();
  assert.equal(s.sowing_plan_rows.length, 2);
  assert.equal(s.hus_events[0].value.plant_correction_id, lossId);
  assert.equal(s.hus_photos[0].value.id, photoId);
  assert.equal((await receipts()).length, 1);
});

test("invalid last imported row rolls back prior create, update and receipt", async () => {
  for (const mode of ["create", "update"]) {
    await importSetup();
    const first = mode === "create" ? batchItem({ ...base, id: uid(30), hus: "First" })
      : batchItem({ ...base, variety: "Must roll back" }, "update", await version(), { work: [work], losses: [loss], events: [event] });
    const items = [first, batchItem({ ...base, id: uid(40), hus: "Last", required_plants: -1 })];
    const before = await state();
    await assert.rejects(importBatch(items));
    assert.deepEqual(await state(), before);
    assert.deepEqual(await receipts(), []);
  }
});

test("late child failure and stale replacement roll back every imported row", async () => {
  await importSetup();
  const before = await state();
  await assert.rejects(importBatch([
    batchItem({ ...base, id: uid(0), hus: "New" }),
    batchItem(base, "update", "2000-01-01T00:00:00Z"),
  ]), { code: "40001" });
  assert.deepEqual(await state(), before);
  await assert.rejects(importBatch([
    batchItem({ ...base, id: uid(30), hus: "First" }),
    batchItem({ ...base, id: uid(40), hus: "Last" }, "create", null, { work: [{ ...work, sowing_plan_row_id: uid(40), dates: [] }] }),
  ]));
  assert.deepEqual(await state(), before);
  assert.deepEqual(await receipts(), []);
});

test("repeating a committed import returns its receipt without rewriting later edits", async () => {
  await importSetup();
  const items = [batchItem({ ...base, id: uid(40), hus: "New" })];
  await importBatch(items);
  await db.query("update sowing_plan_rows set variety='Later edit' where id=$1", [uid(40)]);
  const before = await state();
  const receipt = await receipts();
  const retried = await importBatch([{ ...items[0], history: [{ id: uid(80) }] }], uid(100), items);
  assert.deepEqual(retried.rows[0].ids, [uid(40)]);
  assert.deepEqual(await state(), before);
  assert.deepEqual(await receipts(), receipt);
  await assert.rejects(importBatch(items, uid(100), [{ changed: true }]), { code: "22023" });
  assert.deepEqual(await state(), before);
});

test("import rejects normalized duplicate cycles and repeated target IDs atomically", async () => {
  await importSetup();
  const before = await state();
  await assert.rejects(importBatch([batchItem({ ...base, id: uid(30), hus: "First" }), batchItem({ ...base, id: uid(40), hus: "  test   ATOMIC " })]), { code: "23505" });
  assert.deepEqual(await state(), before);
  await assert.rejects(importBatch([batchItem({ ...base, id: uid(30), hus: "Same new" }), batchItem({ ...base, id: uid(40), hus: "  SAME   new " })]), { code: "23505" });
  assert.deepEqual(await state(), before);
  const duplicate = batchItem({ ...base, id: uid(30), hus: "First" });
  await assert.rejects(importBatch([duplicate,duplicate]), { code: "22023" });
  assert.deepEqual(await state(), before);
  assert.deepEqual(await receipts(), []);
});

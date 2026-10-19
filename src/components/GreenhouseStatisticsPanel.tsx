"use client";

import Image from "next/image";
import { useMemo, useRef, useState } from "react";
import {
  buildGreenhouseRootStatistics, growingStatisticsRows, rankedRootTables,
  seedingStatisticsTables, validStatisticsDate, type RootObservation, type TableRootStatistics,
} from "@/lib/greenhouse-statistics";
import { husPhotoFileUrl } from "@/lib/hus-photo-archive";
import { addDays } from "@/lib/planning";
import type { AppLanguage } from "@/lib/localization";
import type { HusPhotoEntry, SowingPlanRow } from "@/lib/types";

export function GreenhouseStatisticsPanel({ rows, archivedRows, today, language, onOpenHus, onViewPhoto }: {
  rows: SowingPlanRow[]; archivedRows: SowingPlanRow[]; today: string; language: AppLanguage;
  onOpenHus: (id: string) => void; onViewPhoto: (photo: HusPhotoEntry) => void;
}) {
  const lv = language === "lv";
  const [preset, setPreset] = useState("all");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState(today);
  const [selected, setSelected] = useState<string | null>(null);
  const historyRef = useRef<HTMLElement>(null);
  const validPeriod = validStatisticsDate(end) && end <= today && (!start || validStatisticsDate(start) && start <= end);
  const stats = useMemo(() => validPeriod ? buildGreenhouseRootStatistics(rows, archivedRows, { start: start || undefined, end }) : undefined,
    [rows, archivedRows, start, end, validPeriod]);
  const selectedTable = stats?.tables.find((table) => table.table === selected);
  const records = selectedTable ? [...selectedTable.observations, ...selectedTable.possibleObservations]
    .sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id)) : stats?.observations ?? [];
  const date = (value: string) => new Intl.DateTimeFormat(lv ? "lv-LV" : "en-GB", { timeZone: "UTC" }).format(new Date(value));

  function selectTable(table: string) {
    setSelected(table);
    historyRef.current?.focus();
  }
  function applyPreset(value: string) {
    setPreset(value);
    if (value !== "custom") {
      setStart(value === "all" ? "" : addDays(today, value === "30" ? -29 : -89));
      setEnd(today);
    }
  }
  function cell(id: string) {
    const table = stats!.tables.find((entry) => entry.table === id)!;
    const state = table.affectedCycles >= 2 ? "recurring" : table.observations.length ? "recorded"
      : table.possibleObservations.length ? "uncertain" : table.usageCycles ? "used" : "unknown";
    return <button key={id} type="button" aria-pressed={selected === id}
      className={`root-map-cell root-map-cell--${state}`}
      aria-label={`${id}: ${table.observations.length} ${lv ? "ieraksti" : "records"}, ${table.affectedCycles} ${lv ? "skartie cikli" : "affected cycles"}, ${table.usageCycles} ${lv ? "lietošanas cikli" : "usage cycles"}${table.possibleObservations.length ? `, ${lv ? "neskaidra piesaiste" : "uncertain link"}: ${table.possibleObservations.length}` : ""}`}
      onClick={() => selectTable(id)}>
      <strong>{id}</strong><span>{table.observations.length || (table.possibleObservations.length ? "?" : "—")}</span>
    </button>;
  }
  function ranking(zone: TableRootStatistics["zone"]) {
    const ranking = rankedRootTables(stats!.tables, zone);
    return <section className="root-ranking">
      <h3>{zone === "growing" ? lv ? "Augšanas galdi ar reģistrētām problēmām" : "Growing tables with recorded problems"
        : lv ? "Sēšanas galdi ar apstiprinātu izcelsmes saistību" : "Seeding tables with confirmed origin links"}</h3>
      {!ranking.length ? <p className="empty-state">{lv ? "Šajā periodā nav droši piesaistītu ierakstu." : "No reliably linked records in this period."}</p> : <ol>
        {ranking.map((table) => <li key={table.table}><button type="button" onClick={() => selectTable(table.table)}>
          <strong>{table.table}</strong>
          <span>{lv ? "Ieraksti" : "Records"}: {table.observations.length} · {lv ? "Skartie cikli" : "Affected cycles"}: {table.affectedCycles}</span>
          <span>{lv ? "Saistītie lietošanas cikli" : "Related usage cycles"}: {table.usageCycles}</span>
          <span>{lv ? "Piesaistītie zudumi" : "Attributed losses"}: {table.observations.some((entry) => entry.loss === undefined) ? "≥ " : ""}{table.loss}{table.unallocatedLossRecords ? ` · ${lv ? "kopīga diapazona ieraksti" : "shared-range records"}: ${table.unallocatedLossRecords}` : ""}</span>
        </button></li>)}
      </ol>}
    </section>;
  }
  function origin(entry: RootObservation) {
    return entry.origin === "known" ? entry.sources[0] : entry.sources.length
      ? `${lv ? "Iespējami" : "Possible"}: ${entry.sources.join(", ")} (${lv ? "nav precīzi nosakāms" : "not precisely known"})`
      : lv ? "Nav nosakāma no faktiskā Moving" : "Cannot be traced from actual Moving";
  }
  return <section className="panel root-statistics">
    <div className="panel-header"><div><p className="eyebrow">{lv ? "Visa Stādu māja" : "Whole plant house"}</p>
      <h2>{lv ? "Brūno sakņu statistika" : "Brown-root statistics"}</h2></div></div>
    <p>{lv ? "Kopīgs aktīvo un arhivēto ciklu pārskats pēc faktiskajiem ierakstiem. HUS nosaukumi kalpo tikai izsekošanai." : "A combined view of active and archived cycles based on actual records. HUS names are used only for traceability."}</p>
    <div className="root-period-controls">
      <label>{lv ? "Periods" : "Period"}<select value={preset} onChange={(event) => applyPreset(event.target.value)}>
        <option value="all">{lv ? "Visa vēsture līdz šodienai" : "All history through today"}</option>
        <option value="30">{lv ? "Pēdējās 30 dienas" : "Last 30 days"}</option>
        <option value="90">{lv ? "Pēdējās 90 dienas" : "Last 90 days"}</option>
        <option value="custom">{lv ? "Izvēlēts periods" : "Custom period"}</option>
      </select></label>
      <label>{lv ? "No" : "From"}<input type="date" value={start} max={end || today} onChange={(event) => { setPreset("custom"); setStart(event.target.value); }} /></label>
      <label>{lv ? "Līdz" : "To"}<input type="date" value={end} max={today} min={start || undefined} onChange={(event) => { setPreset("custom"); setEnd(event.target.value); }} /></label>
    </div>
    {!stats ? <p className="form-error" role="alert">{lv ? "Norādi derīgu periodu: sākums nedrīkst būt pēc beigām, un beigas nedrīkst būt nākotnē." : "Choose a valid period: start must not follow end, and end must not be in the future."}</p> : <>
      <div className="root-summary" aria-live="polite">
        <div><strong>{stats.observationCount}</strong><span>{lv ? "Brūno sakņu ieraksti" : "Brown-root records"}</span></div>
        <div><strong>{stats.unknownLossRecords ? "≥ " : ""}{stats.loss}</strong><span>{lv ? "Reģistrētie stādu zudumi" : "Recorded plant losses"}</span>{stats.unknownLossRecords ? <span>{stats.unknownLossRecords} {lv ? "ierakstos daudzums nav norādīts" : "records have no loss amount"}</span> : null}</div>
        <div><strong>{stats.affectedGrowingTables}</strong><span>{lv ? "Skartie augšanas galdi" : "Affected growing tables"}</span></div>
        <div><strong>{stats.recurringGrowingTables}</strong><span>{lv ? "Galdi ar ierakstiem vismaz 2 ciklos" : "Tables with records in at least 2 cycles"}</span></div>
      </div>
      <p className="root-statistics-note">{lv ? "Nav ierakstu ≠ pārbaudīts un vesels. Krāsas rāda reģistrēto vēsturi, nevis slimības cēloni vai risku. Biežāk lietots galds var uzkrāt vairāk ierakstu." : "No records ≠ checked and healthy. Colours show recorded history, not disease cause or risk. More frequently used tables can accumulate more records."}</p>
      {!stats.observationCount ? <p className="empty-state">{lv ? "Šajā periodā nav strukturētu brūno sakņu ierakstu. Tas nav veselības apstiprinājums." : "No structured brown-root records in this period. This is not confirmation of healthy plants."}</p> : null}
      <details className="root-method"><summary>{lv ? "Datu pilnīgums un aprēķina skaidrojums" : "Data completeness and calculation"}</summary>
        <p>{lv ? "Ieskaitīti Brūno sakņu notikumi un agrākās ar tiem nesaistītās brūno sakņu zudumu korekcijas; viens zudums netiek skaitīts divreiz. Brīvās piezīmes un foto apraksti netiek automātiski klasificēti." : "Includes Brown roots events and older unlinked brown-root loss corrections; a loss is not counted twice. Free notes and photo descriptions are not classified automatically."}</p>
        <p>{lv ? "Izcelsmei izmanto tikai faktiskos Moving/retināšanas ierakstus līdz novērojuma datumam. Plānotās rindas un sēšanas galdu rezervācijas nav izcelsmes pierādījums. Neskaidra tās pašas dienas darbu secība netiek uzminēta." : "Origin uses only actual Moving/thinning records through the observation date. Planned rows and seeding reservations do not prove origin. Unclear work order on the same day is not guessed."}</p>
        <p>{lv ? "Lietošanas cikli skaitīti pēc faktiskā Moving un adresētiem novērojumiem periodā, ieskaitot tajā turpinātu audzēšanu. Skartie cikli ir dažādi ierakstu cikli, arī ja HUS nosaukumi sakrīt. Galdu sarakstu skaitļus nedrīkst summēt kā unikālus gadījumus." : "Usage cycles follow actual Moving and addressed observations, including growing carried into the period. Affected cycles are distinct production batches even with identical HUS names. Table counts must not be added as unique cases."}</p>
        <p>{lv ? "Zudumi vairāku augšanas galdu diapazonā netiek patvaļīgi sadalīti starp galdiem. Reģistrētie zudumi nav visu simptomātisko vai unikālo bojāto stādu skaits." : "Losses for a range of growing tables are not arbitrarily split between tables. Recorded losses are not the count of all symptomatic or unique affected plants."}</p>
        <p>{lv ? "Nav zināms galds" : "Unknown table"}: {stats.unknownLocationRecords} · {lv ? "Kopīgs galdu diapazons" : "Shared table range"}: {stats.rangeLocationRecords} · {lv ? "Neskaidra izcelsme" : "Uncertain origin"}: {stats.uncertainOriginRecords} · {lv ? "Nav norādīts zudumu daudzums" : "Loss amount unspecified"}: {stats.unknownLossRecords} · {lv ? "Vēsturiskās korekcijas" : "Legacy corrections"}: {stats.legacyRecords}</p>
      </details>
      <div className="root-map-legend">
        <span className="root-legend--unknown">{lv ? "Nav lietošanas datu" : "No usage data"}</span>
        <span className="root-legend--used">{lv ? "Lietots, nav reģistrētu problēmu" : "Used, no recorded problems"}</span>
        <span className="root-legend--recorded">{lv ? "Ieraksti vienā ciklā" : "Records in one cycle"}</span>
        <span className="root-legend--recurring">{lv ? "Atkārtojas dažādos ciklos" : "Recorded in different cycles"}</span>
        <span className="root-legend--uncertain">{lv ? "? Neskaidra izcelsme vai kopīgs diapazons" : "? Uncertain origin or shared range"}</span>
      </div>
      <section className="root-map" aria-label={lv ? "Sēšanas galdu karte" : "Seeding table map"}>
        <h3>{lv ? "Sēšanas galdi A1–A13" : "Seeding tables A1–A13"}</h3>
        <p>{lv ? "Apstiprināta izcelsme; neskaidri vairāku A galdu avoti parādās ar jautājuma zīmi." : "Confirmed origins; ambiguous sources from several A tables appear with a question mark."}</p>
        <div className="root-map-grid">{seedingStatisticsTables.map(cell)}</div>
      </section>
      <section className="root-map" aria-label={lv ? "Augšanas galdu karte" : "Growing table map"}>
        <h3>{lv ? "Augšanas galdi" : "Growing tables"}</h3>
        <p>{lv ? "Skaitlis rāda tieši šim galdam reģistrētos ierakstus. Kopīga diapazona ieraksti parādās ar jautājuma zīmi. Izvēlies galdu, lai atvērtu vēsturi." : "The number shows records specifically assigned to this table. Shared-range records appear with a question mark. Select a table to open its history."}</p>
        {growingStatisticsRows.map((row) => <div className="root-map-row" key={row.row}><strong>{row.row}</strong><div className="root-map-grid">{row.tables.map(cell)}</div></div>)}
      </section>
      <div className="root-rankings">{ranking("growing")}{ranking("seeding")}</div>
      <section ref={historyRef} tabIndex={-1} className="root-history" aria-label={lv ? "Galdu novērojumu vēsture" : "Table observation history"}>
        <div className="panel-header"><h3>{selected ? `${lv ? "Galds" : "Table"} ${selected}` : lv ? "Visi perioda ieraksti" : "All records in the period"}</h3>
          {selected ? <button className="secondary-action" type="button" onClick={() => setSelected(null)}>{lv ? "Visi ieraksti" : "All records"}</button> : null}</div>
        {selectedTable ? <p>{lv ? "Lietošanas cikli" : "Usage cycles"}: {selectedTable.usageCycles} · {lv ? "Skartie cikli" : "Affected cycles"}: {selectedTable.affectedCycles} · {lv ? "Ieraksti" : "Records"}: {selectedTable.observations.length}{selectedTable.possibleObservations.length ? ` · ${lv ? "Neskaidras piesaistes/diapazona ieraksti" : "Uncertain/range records"}: ${selectedTable.possibleObservations.length}` : ""}</p> : null}
        {!records.length ? <p className="empty-state">{lv ? "Šim galdam periodā nav saistītu brūno sakņu ierakstu. Tas nav veselības apstiprinājums." : "No linked brown-root records for this table in the period. This is not confirmation of healthy plants."}</p> : <ol>
          {records.map((entry) => <li key={entry.id}>
            <div className="root-record-heading"><strong>{date(entry.date)} · {entry.location || (lv ? "Galds nav zināms" : "Table unknown")}</strong><span>{entry.archived ? lv ? "Arhivēts cikls" : "Archived cycle" : lv ? "Aktīvs cikls" : "Active cycle"}</span></div>
            <p>{lv ? "Sēšanas izcelsme" : "Seeding origin"}: {origin(entry)}</p>
            <p>{lv ? "Reģistrētais zudums" : "Recorded loss"}: {entry.loss === undefined ? lv ? "nav norādīts" : "unspecified" : entry.loss}</p>
            {entry.tables.length > 1 ? <p className="root-statistics-note">{lv ? "Zudums reģistrēts visam diapazonam kopā, ne katram galdam atsevišķi." : "The loss is for the entire range, not for each table separately."}</p> : null}
            {entry.kind === "correction" ? <p>{lv ? "Vēsturiska zudumu korekcija bez strukturētas galda piesaistes." : "Legacy loss correction without a structured table link."}</p> : null}
            {entry.note ? <p className="root-record-note">{entry.note}</p> : null}
            <div className="hus-photo-strip">{entry.photos.map((photo) => <button key={photo.id} type="button" onClick={() => onViewPhoto(photo)} aria-label={`${lv ? "Atvērt foto" : "Open photo"}: ${entry.location ?? entry.hus}, ${date(entry.date)}`}>
              <Image src={husPhotoFileUrl(photo)} alt={photo.originalFileName} width={96} height={72} unoptimized />
            </button>)}</div>
            <button className="secondary-action" type="button" onClick={() => onOpenHus(entry.rowId)}>{lv ? "Atvērt avota ierakstu" : "Open source record"} · {entry.hus}</button>
          </li>)}
        </ol>}
      </section>
    </>}
  </section>;
}

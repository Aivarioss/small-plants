import type { GreenhouseSeedingOccupancy } from "@/lib/greenhouse-simulation";
import type { AppLanguage } from "@/lib/localization";

/** Count-only reservations do not imply a choice of physical A-table numbers. */
export function SeedingCapacityView({ occupancy, language }: { occupancy: GreenhouseSeedingOccupancy; language: AppLanguage }) {
  const lv = language === "lv";
  const unknownCount = occupancy.unknownRows.some((row) => row.reason === "unknownCount" || row.reason === "missingSowingTables");
  return <article className="greenhouse-row">
    <div>
      <strong>{lv ? "Sēšanas galdi A1–A13" : "Seeding tables A1–A13"}</strong>
      <span>{unknownCount ? lv ? "Ne vairāk kā " : "At most " : ""}{occupancy.freeTables}/{occupancy.capacity} {lv ? "brīvi" : "free"}</span>
    </div>
    <p>{lv ? "Aizņemti / rezervēti" : "Occupied / reserved"}: {unknownCount ? lv ? "vismaz " : "at least " : ""}{occupancy.usedTables}</p>
    <p>{lv ? "Brīvi" : "Free"}: {unknownCount ? lv ? "ne vairāk kā " : "at most " : ""}{occupancy.freeTables}</p>
    {occupancy.rows.map((row) => {
      const countUnknown = occupancy.unknownRows.some((entry) => entry.planRowId === row.planRowId &&
        (entry.reason === "unknownCount" || entry.reason === "missingSowingTables"));
      return <p key={row.planRowId}>{row.sectorName} — {countUnknown && !row.tableCount ? "?" :
        `${countUnknown ? lv ? "vismaz " : "at least " : ""}${row.tableCount}`} {lv ? "galdi" : "tables"}</p>;
    })}
    {!occupancy.rows.length ? <p>{lv ? "Nav sēšanas galdu rezervāciju šajā datumā" : "No seeding table reservations on this date"}</p> : null}
    {occupancy.unknownRows.map((row) => <p className="capacity-note" key={row.planRowId}>
      {row.sectorName}: {row.reason === "unknownRelease"
        ? lv ? "nav droši zināms galdu atbrīvošanas datums" : "table release date is uncertain"
        : lv ? "nav zināms nepieciešamais galdu skaits" : "required table count is unknown"}.
    </p>)}
  </article>;
}

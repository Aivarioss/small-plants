import { plannerConfig } from "@/lib/demo-data";
import { describeHusPlacement } from "@/lib/greenhouse-work-placement";
import { calculateBoxPlan, dateLabel, getTotalSow } from "@/lib/planning";
import { formatPrintHarvestBoxes } from "@/lib/localization";
import type { AppLanguage } from "@/lib/localization";
import type { SowingPlanRow } from "@/lib/types";

/** Read-only summary. Actual placement is entered solely as a dated Moving. */
export function HusPlacementDetails({ row, rows, language }: {
  row: SowingPlanRow; rows: SowingPlanRow[]; language: AppLanguage;
}) {
  const { date, actual, occupancy: placement, rowIds } = describeHusPlacement(row, rows, plannerConfig);
  return (
    <section className="placement-box">
      <div>
        <p className="eyebrow">{language === "lv" ? actual ? "Faktiskais izvietojums pēc retināšanas" : "Plānotais izvietojums (automātiski)"
          : actual ? "Actual placement after moving" : "Planned placement (automatic)"}</p>
        <strong>{placement?.rowLabel ?? (language === "lv" ? "Vieta nav zināma" : "Location unknown")}</strong>
      </div>
      <span>{language === "lv" ? "Rinda" : "Row"}: {rowIds.join(", ") || "—"}</span>
      <span>{language === "lv" ? "Galdi" : "Tables"}: {placement?.tables ?? "—"}</span>
      {placement?.tables ? <>
        <span>{language === "lv" ? "Renes" : "Troughs"}: {placement.tables * 6}</span>
        <span>{language === "lv" ? "Vidēji" : "Average"}: {(getTotalSow(row) / (placement.tables * 6)).toFixed(2)} {language === "lv" ? "stādi/renē" : "plants/trough"}</span>
      </> : null}
      <span>{language === "lv" ? "Datums" : "Date"}: {dateLabel(date)}</span>
      <span>{language === "lv" ? "Kopā sēts" : "Total sown"}: {getTotalSow(row).toLocaleString("lv-LV")}</span>
      <span>{language === "lv" ? "Kastītes" : "Boxes"}: {language === "lv" ? calculateBoxPlan(row).label : formatPrintHarvestBoxes(row, language)}</span>
      {!actual ? <p>{language === "lv"
        ? "Rinda ir aprēķināts plāns. Faktiskos galdus norādi HUS Moving ierakstā pēc retināšanas."
        : "The row is a calculated plan. Record actual tables in a Hus Moving entry after thinning."}</p> : null}
      {placement?.warnings?.map((warning) => <p className="capacity-note" key={warning}>{warning}</p>)}
    </section>
  );
}

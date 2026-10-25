import { orderHusCycles, husCyclePhase } from "@/lib/hus-cycle-selection";
import { calculatePlantBalance, compareSowingRowsByDate, dateLabel, getTotalSow } from "@/lib/planning";
import { formatPlants, formatCycleDays, t, type AppLanguage } from "@/lib/localization";
import type { SowingPlanRow } from "@/lib/types";

export function HusList({
  mode,
  language,
  today,
  onModeChange,
  onOpen,
  rows,
}: {
  mode: "active" | "archive";
  language: AppLanguage;
  today: string;
  onModeChange: (mode: "active" | "archive") => void;
  onOpen: (id: string) => void;
  rows: SowingPlanRow[];
}) {
  const groupedRows = Array.from(
    rows.reduce((groups, row) => {
      const group = groups.get(row.sectorName) ?? [];
      group.push(row);
      groups.set(row.sectorName, group);
      return groups;
    }, new Map<string, SowingPlanRow[]>()),
  )
    .map(([sectorName, group]) => ({
      sectorName,
      cycles: orderHusCycles(group, mode, today),
    }))
    .sort((a, b) => mode === "archive"
      ? (b.cycles[0].archivedAt ?? "").localeCompare(a.cycles[0].archivedAt ?? "") || a.sectorName.localeCompare(b.sectorName, "lv", { numeric: true })
      : compareSowingRowsByDate(a.cycles[0], b.cycles[0]));
  const phaseLabels = language === "lv"
    ? { current: "Pašlaik aug", future: "Plānots", finished: "Pabeigts" }
    : { current: "Growing now", future: "Planned", finished: "Finished" };

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Hus</p>
          <h2>{t("worksheet", language)}</h2>
        </div>
        <div className="segmented segmented--compact">
          <button className={mode === "active" ? "is-active" : ""} type="button" onClick={() => onModeChange("active")}>
            {language === "lv" ? "Aktīvie" : "Active"}
          </button>
          <button className={mode === "archive" ? "is-active" : ""} type="button" onClick={() => onModeChange("archive")}>
            {language === "lv" ? "Arhīvs" : "Archive"}
          </button>
        </div>
      </div>
      <div className="batch-list">
        {rows.length === 0 ? (
          <p className="empty-state">
            {mode === "archive"
              ? language === "lv" ? "Arhīvā vēl nav HUS ciklu." : "No archived HUS cycles yet."
              : language === "lv" ? "Hus ierakstu vēl nav." : "No Hus records yet."}
          </p>
        ) : null}
        {groupedRows.map(({ cycles, sectorName }) => {
          const row = cycles[0];
          const totalSow = getTotalSow(row);
          const balance = calculatePlantBalance(row);

          return (
            <article className="hus-card" key={sectorName}>
              <button className="batch-row" onClick={() => onOpen(row.id)} type="button">
                <span>
                  <strong>{sectorName}</strong>
                  <small>
                    {mode === "active" ? `${phaseLabels[husCyclePhase(row, today)]} · ` : ""}{row.variety} · {dateLabel(row.sowingDate)} - {dateLabel(row.harvestDate)}
                  </small>
                </span>
                <span>{formatPlants(totalSow, language)}</span>
                <span>{formatCycleDays(row.cycleLength, language)}</span>
                {mode === "archive" ? (
                  <span>
                    {language === "lv" ? "Arhivēts" : "Archived"} {row.archivedAt ? dateLabel(row.archivedAt.slice(0, 10)) : "—"} ·{" "}
                    {language === "lv" ? "Faktiski" : "Actual"} {formatPlants(balance.actualPlants, language)}
                  </span>
                ) : null}
                <span>{t("openWorksheet", language)}</span>
              </button>
              {cycles.length > 1 ? (
                <div className="previous-cycles">
                  {cycles.slice(1).map((cycle) => (
                    <button key={cycle.id} type="button" onClick={() => onOpen(cycle.id)}>
                      {mode === "active" ? `${phaseLabels[husCyclePhase(cycle, today)]} · ` : ""}{dateLabel(cycle.sowingDate)} - {dateLabel(cycle.harvestDate)}
                    </button>
                  ))}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

import type { AppLanguage } from "@/lib/localization";
import type { GreenhouseSimulationAlternative, SimulationNotice, SowingDateSimulationResult } from "@/lib/greenhouse-simulation";

export function SimulationResultView({ language, result }: { language: AppLanguage; result: SowingDateSimulationResult }) {
  const best = result.recommendation;
  const lv = language === "lv";
  const conclusion = result.status === "can" ? lv ? "Var sēt" : "Can sow"
    : result.status === "conditional" ? lv ? "Iespējams ar nosacījumu" : "Possible with conditions"
      : result.status === "insufficientData" ? lv ? "Vajadzīgs precizējums" : "Clarification needed"
        : lv ? "Nav iespējams" : "Not possible";
  return (
    <div className={"simulation-result simulation-result--" + result.status}>
      <h3>{result.targetSectorName} — {conclusion}</h3>
      {best ? <article className={"simulation-option simulation-option--" + best.tier} data-recommendation>
        <strong>{lv ? "Ieteicamais risinājums" : "Recommended solution"}</strong>
        <dl>
          <div><dt>{lv ? "Sēšana" : "Sowing"}</dt><dd>{formatDate(result.newSowingDate)}</dd></div>
          <div><dt>{lv ? "Sēšanas galdi" : "Seeding tables"}</dt><dd>{lv ? "Pietiek, vajag " : "Enough, need "}{best.seedingTableCount}</dd></div>
          <div><dt>{lv ? "Retināšana" : "Thinning"}</dt><dd>{formatDate(best.thinningDate)} ({best.cycleDay}{lv ? ". dienā" : "th day"})</dd></div>
          <div><dt>{lv ? "Augšanas vieta" : "Growing location"}</dt><dd>{location(best, lv)}</dd></div>
        </dl>
        {result.status === "conditional" ? <ul>{conditions(result).map((notice, index) => <li key={index}>{notice[language]}</li>)}</ul> : null}
      </article> : <p>{result.notices[0]?.[language] ?? (lv ? "Risinājums nav atrasts." : "No solution found.")}</p>}
      <p>Planting: {result.currentMoveOutDate === result.newMoveOutDate ? formatDate(result.newMoveOutDate)
        : formatDate(result.currentMoveOutDate) + " → " + formatDate(result.newMoveOutDate)}</p>
      <details className="simulation-details">
        <summary>{lv ? "Detalizēta pārbaude" : "Detailed check"}</summary>
        <p>{lv ? "Pārbaudīta sēšanas galdu pieejamība un augšanas izvietojums līdz Planting. Faktiskais Moving ir prioritārs; plānotajā retināšanas dienā sēšanas galdi paliek rezervēti, ja vien nav norādīts atsevišķs darbu secības nosacījums."
          : "Seeding availability and growing placement were checked through Planting. Actual Moving takes priority; planned thinning reserves seeding tables for that day unless an explicit work-order condition is stated."}</p>
        {best ? <dl>
          <div><dt>{lv ? "Sēšanas galdi" : "Seeding tables"}</dt><dd>{best.seedingTableCount}{best.seedingTables.length ? " · " + best.seedingTables.join(", ") : ""}</dd></div>
          <div><dt>{lv ? "Blīvums" : "Density"}</dt><dd>{best.plantsPerTrough} {lv ? "stādi/renē" : "plants/trough"}</dd></div>
          <div><dt>{lv ? "Galdi: ierastais / piedāvātais" : "Tables: usual / proposed"}</dt><dd>{best.normalTables} / {best.physicalTables}</dd></div>
          <div><dt>{lv ? "Plānotā darbu slodze" : "Planned workload"}</dt><dd>{best.workload.projectedLoad}</dd></div>
        </dl> : null}
        {best ? <p>{lv ? best.explanation : best.explanationEn}</p> : null}
        {result.notices.length ? <ul>{result.notices.map((notice, index) => <li key={index}>{notice[language]}</li>)}</ul>
          : <p>{lv ? "Pārbaudītajos datos nav atrasti neatrisināti ierobežojumi." : "No unresolved constraints were found in the checked data."}</p>}
      </details>
      <p className="capacity-note">{lv ? "Simulācija neko nesaglabā īstajā plānā." : "The simulation does not save anything to the real plan."}</p>
    </div>
  );
}

function location(option: GreenhouseSimulationAlternative, lv: boolean): string {
  return (option.wateringZone === "A" ? "A14–A26" : option.wateringZone + (lv ? " rinda" : " row")) +
    (option.usesExtraBlock && option.wateringZone !== "A" ? " + A14–A26" : "");
}

function conditions(result: SowingDateSimulationResult): SimulationNotice[] {
  const best = result.recommendation!;
  const changes = result.requiredChanges ?? [];
  const notices = best.notices.filter((notice) => !changes.some((change) => change.lv === notice.lv) &&
    !notice.en.includes("another HUS is also being seeded") && !notice.en.includes("Another HUS is also being thinned"));
  return [...new Map([...changes, ...notices.map((notice): SimulationNotice => /workload.*overload/i.test(notice.en) ? {
    lv: "Jāsaskaņo darba kapacitāte retināšanas dienā.", en: "Confirm labour capacity on the thinning day.",
  } : notice)].map((notice) => [notice.lv, notice])).values()];
}

function formatDate(date: string): string {
  return date.slice(8, 10) + "." + date.slice(5, 7) + "." + date.slice(0, 4);
}

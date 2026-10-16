import type { AppLanguage } from "@/lib/localization";
import type { GreenhouseSimulationAlternative, SowingDateSimulationResult } from "@/lib/greenhouse-simulation";

export function SimulationResultView({ language, result }: { language: AppLanguage; result: SowingDateSimulationResult }) {
  const best = result.recommendation;
  const lv = language === "lv";
  const conclusion = result.status === "can"
    ? lv ? result.newSowingDate < result.currentSowingDate ? "iespējams iesēt agrāk" : "atrasts risinājums"
      : result.newSowingDate < result.currentSowingDate ? "earlier seeding is possible" : "solution found"
    : result.status === "conditional" ? lv ? "nosacīts priekšlikums" : "conditional proposal"
      : result.status === "insufficientData" ? lv ? "vajadzīgs precizējums" : "clarification needed"
        : lv ? "risinājums nav atrasts" : "no solution found";
  return (
    <div className={"simulation-result simulation-result--" + result.status}>
      <h3>{result.targetSectorName} — {conclusion}</h3>
      {best ? (
        <SimulationOption alternative={best} language={language} sowingDate={result.newSowingDate} primary />
      ) : <p>{lv ? "Skati precīzos ierobežojumus sadaļā “Detalizēta pārbaude”." : "See the specific constraints under “Detailed check”."}</p>}
      <p>{lv ? "Planting" : "Planting"}: {formatDate(result.currentMoveOutDate)} → {formatDate(result.newMoveOutDate)}</p>
      {result.alternatives.length > 1 ? (
        <div className="simulation-alternatives">
          <h4>{lv ? "Citi risinājumi" : "Other solutions"}</h4>
          {result.alternatives.slice(1, 4).map((alternative, index) => (
            <SimulationOption key={index} alternative={alternative} language={language} sowingDate={result.newSowingDate} />
          ))}
        </div>
      ) : null}
      <details className="simulation-details">
        <summary>{lv ? "Detalizēta pārbaude" : "Detailed check"}</summary>
        <p>{best
          ? lv ? "Pārbaudīta sēšanas galdu pieejamība līdz retināšanai ieskaitot un augšanas izvietojums līdz Planting. Citu HUS rezervācijas un darba datumi saglabāti."
            : "Seeding tables were checked through the thinning day, and growing placement through Planting. Other HUS reservations and work dates are preserved."
          : lv ? "Pilnas pārbaudes pabeigšanai jānovērš zemāk norādītie ierobežojumi vai jāprecizē trūkstošie dati."
            : "Resolve the constraints below or clarify the missing data to complete the check."}</p>
        {result.notices.length ? <>
          <p>{lv ? "Pārbaudīto datumu ierobežojumi un priekšlikuma nosacījumi:" : "Constraints of the evaluated dates and proposal conditions:"}</p>
          <ul>{result.notices.map((notice, index) => <li key={index}>{notice[language]}</li>)}</ul>
        </>
          : <p>{lv ? "Pārbaudītajos datos nav atrasti neatrisināti ierobežojumi." : "No unresolved constraints were found in the checked data."}</p>}
      </details>
      <p className="capacity-note">{lv ? "Simulācija neko nesaglabā īstajā plānā." : "The simulation does not save anything to the real plan."}</p>
    </div>
  );
}

function SimulationOption({ alternative: option, language, sowingDate, primary = false }: {
  alternative: GreenhouseSimulationAlternative; language: AppLanguage; sowingDate: string; primary?: boolean;
}) {
  const lv = language === "lv";
  const location = option.wateringZone === "A" ? "A14–A26" : option.wateringZone + (lv ? " rinda" : " row");
  const density = option.densityClass === "normal" ? lv ? "normāls" : "normal"
    : option.densityClass === "slightlyCompressed" ? lv ? "neliels sablīvējums" : "slightly compressed"
      : lv ? "ārkārtas blīvums" : "exceptional density";
  return (
    <article className={"simulation-option simulation-option--" + option.tier} data-recommendation={primary || undefined}>
      <strong>{primary ? lv ? "Ieteicamais risinājums" : "Recommended solution"
        : option.tier === "preferred" ? lv ? "Vēlamais" : "Preferred"
          : option.tier === "compromise" ? lv ? "Kompromiss" : "Compromise" : lv ? "Saspringts" : "Strained"}
        {" · "}{option.status === "can" ? lv ? "Pārbaudīts risinājums" : "Verified solution" : lv ? "Nosacīts priekšlikums" : "Conditional proposal"}</strong>
      <dl>
        <div><dt>{lv ? "Sēšana" : "Seeding"}</dt><dd>{formatDate(sowingDate)}</dd></div>
        <div><dt>{lv ? "Sēšanas galdi" : "Seeding tables"}</dt><dd>{option.seedingTables.join(", ")}</dd></div>
        <div><dt>{lv ? "Retināšana" : "Thinning"}</dt><dd>{formatDate(option.thinningDate)} ({option.cycleDay}{lv ? ". diena" : "th day"})</dd></div>
        <div><dt>{lv ? "Augšanas vieta" : "Growing location"}</dt><dd>{location}{option.usesExtraBlock && option.wateringZone !== "A" ? " + A14–A26" : ""}</dd></div>
        <div><dt>{lv ? "Blīvums" : "Density"}</dt><dd>{option.plantsPerTrough} {lv ? "stādi/renē" : "plants/trough"} · {density}</dd></div>
        <div><dt>{lv ? "Galdi: ierastais / piedāvātais" : "Tables: usual / proposed"}</dt><dd>{option.normalTables} / {option.physicalTables}</dd></div>
        <div><dt>{lv ? "Plānotā darbu slodze" : "Planned workload"}</dt><dd>{option.workload.projectedLoad}</dd></div>
      </dl>
      <p>{lv ? option.explanation : option.explanationEn}</p>
      {option.notices.length ? <ul>{option.notices.map((notice, index) => <li key={index}>{notice[language]}</li>)}</ul> : null}
    </article>
  );
}

function formatDate(date: string): string {
  return date.slice(8, 10) + "." + date.slice(5, 7) + "." + date.slice(0, 4);
}

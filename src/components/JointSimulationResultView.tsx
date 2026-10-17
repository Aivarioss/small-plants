import type { AppLanguage } from "@/lib/localization";
import type { TwoHusSowingResult } from "@/lib/greenhouse-sowing-simulator";

export function JointSimulationResultView({ result, language }: { result: TwoHusSowingResult; language: AppLanguage }) {
  const lv = language === "lv";
  const conclusion = result.status === "can" ? lv ? "Abus HUS var sēt" : "Both HUS can be sown"
    : result.status === "conditional" ? lv ? "Iespējams ar nosacījumu" : "Possible with conditions"
      : result.status === "cannot" ? lv ? "Nav iespējams" : "Not possible"
        : result.status === "searchLimited" ? lv ? "Pārbaude nav pabeigta" : "Check incomplete"
          : lv ? "Vajadzīgs precizējums" : "Clarification needed";
  return <div className={"simulation-result simulation-result--" + result.status}>
    <h3>{conclusion}</h3>
    {result.plan ? <div className="joint-simulation-proposals">
      {result.proposals.map((proposal) => <article className="simulation-option" key={proposal.planRowId} data-joint-hus={proposal.planRowId}>
        <strong>{proposal.sectorName}</strong>
        <dl>
          <div><dt>{lv ? "Sēšana" : "Sowing"}</dt><dd>{formatDate(proposal.sowingDate)}</dd></div>
          <div><dt>{lv ? "Sēšanas galdi" : "Seeding tables"}</dt><dd>{lv ? "Pietiek, vajag " : "Enough, need "}{proposal.seedingTableCount}</dd></div>
          <div><dt>{lv ? "Retināšana" : "Thinning"}</dt><dd>{formatDate(proposal.thinningDate)} ({proposal.cycleDay}{lv ? ". dienā" : "th day"})</dd></div>
          <div><dt>{lv ? "Augšanas vieta" : "Growing location"}</dt><dd>{proposal.wateringZone === "A" ? "A14–A26" : proposal.wateringZone + (lv ? " rinda" : " row")}
            {proposal.physicalTables > 26 ? " + A14–A26" : ""}</dd></div>
          <div><dt>Planting</dt><dd>{formatDate(proposal.plantingDate)}</dd></div>
        </dl>
      </article>)}
    </div> : <p>{result.notices[0]?.[language] ?? (lv ? "Kopīgs risinājums nav atrasts." : "No joint solution found.")}</p>}
    {result.plan && result.status === "conditional" ? <ul>{result.notices.map((notice, index) => <li key={index}>{notice[language]}</li>)}</ul> : null}
    <details className="simulation-details">
      <summary>{lv ? "Detalizēta pārbaude" : "Detailed check"}</summary>
      <p>{result.plan ? lv ? "Abi HUS pārbaudīti kopā: sēšanas galdu aprite, augšanas vieta katrā dienā līdz Planting un faktiskie Moving. Plānotās rindas drīkst mainīt; faktisko izvietojumu nepārplāno."
        : "Both HUS were checked together: seeding-table turnover, growing space on every day through Planting, and actual Moving. Planned rows may change; actual placements are preserved."
        : lv ? "Kopīgu risinājumu nevar apstiprināt. Zemāk norādīti pārbaudes šķēršļi."
          : "A joint solution cannot be confirmed. The reasons are listed below."}</p>
      {result.proposals.map((proposal) => <p key={proposal.planRowId}>{proposal.sectorName}: {proposal.physicalTables} {lv ? "galdi" : "tables"}, {proposal.plantsPerTrough} {lv ? "stādi/renē" : "plants/trough"}; {lv ? "darbu slodze" : "workload"} {proposal.workload.projectedLoad}.</p>)}
      {result.notices.length ? <ul>{result.notices.map((notice, index) => <li key={index}>{notice[language]}</li>)}</ul>
        : <p>{lv ? "Pārbaudītajos datos nav atrasti neatrisināti ierobežojumi." : "No unresolved constraints were found in the checked data."}</p>}
    </details>
    <p className="capacity-note">{lv ? "Simulācija neko nesaglabā īstajā plānā." : "The simulation does not save anything to the real plan."}</p>
  </div>;
}

function formatDate(date: string): string {
  return date.slice(8, 10) + "." + date.slice(5, 7) + "." + date.slice(0, 4);
}

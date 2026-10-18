"use client";

import { useState } from "react";
import { plannerConfig } from "@/lib/demo-data";
import { selectableSowingSimulationRows, simulateGreenhouseSowing, simulateTwoHusSowing, type TwoHusSowingResult } from "@/lib/greenhouse-sowing-simulator";
import type { SowingDateSimulationResult } from "@/lib/greenhouse-simulation";
import type { AppLanguage } from "@/lib/localization";
import type { SowingPlanRow } from "@/lib/types";
import { SimulationResultView } from "./SimulationResultView";
import { JointSimulationResultView } from "./JointSimulationResultView";

type Preview = ({ mode: "single"; result: SowingDateSimulationResult } | { mode: "joint"; result: TwoHusSowingResult }) & { sourceRows: SowingPlanRow[] };

export function SowingSimulationPanel({ rows, language, asOfDate }: { rows: SowingPlanRow[]; language: AppLanguage; asOfDate: string }) {
  const lv = language === "lv";
  const selectable = selectableSowingSimulationRows(rows);
  const [requestedMode, setMode] = useState<"single" | "joint">("single");
  const mode = requestedMode === "joint" && selectable.length >= 2 ? "joint" : "single";
  const [firstId, setFirstId] = useState(selectable[0]?.id ?? "");
  const [secondId, setSecondId] = useState(selectable[1]?.id ?? "");
  const [dates, setDates] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const first = selectable.find((row) => row.id === firstId) ?? selectable[0];
  const second = selectable.find((row) => row.id === secondId && row.id !== first?.id) ?? selectable.find((row) => row.id !== first?.id);
  const currentPreview = preview?.sourceRows === rows ? preview : null;
  const sowingDate = (row?: SowingPlanRow) => row ? dates[row.id] ?? row.sowingDate : "";

  function calculate() {
    if (!first || !sowingDate(first)) return;
    if (mode === "single") setPreview({ mode, sourceRows: rows, result: simulateGreenhouseSowing(rows, plannerConfig, first.id, sowingDate(first), asOfDate) });
    else if (second && second.id !== first.id && sowingDate(second)) setPreview({ mode, sourceRows: rows, result: simulateTwoHusSowing(rows, plannerConfig, [
      { planRowId: first.id, sowingDate: sowingDate(first) }, { planRowId: second.id, sowingDate: sowingDate(second) },
    ], asOfDate) });
  }

  function dateInput(row: SowingPlanRow | undefined, label: string) {
    return <label>{label}<input type="date" value={sowingDate(row)} disabled={!row} onChange={(event) => {
      if (row) setDates({ ...dates, [row.id]: event.target.value });
      setPreview(null);
    }} /></label>;
  }

  return <section className="scenario-panel">
    <div className="panel-header"><div>
      <p className="eyebrow">{lv ? "Izmēģināt izmaiņu" : "Try a change"}</p>
      <h3>{lv ? "HUS sēšanas simulācija" : "HUS sowing simulation"}</h3>
    </div></div>
    <label className="scenario-mode">{lv ? "Simulācijas režīms" : "Simulation mode"}
      <select value={mode} onChange={(event) => { setMode(event.target.value as "single" | "joint"); setPreview(null); }}>
        <option value="single">{lv ? "Simulēt vienu HUS" : "Simulate one HUS"}</option>
        <option value="joint" disabled={selectable.length < 2}>{lv ? "Simulēt divus HUS" : "Simulate two HUS"}</option>
      </select>
    </label>
    <div className={"scenario-controls" + (mode === "joint" ? " scenario-controls--joint" : "")}>
      <label>{mode === "joint" ? lv ? "Pirmais HUS" : "First HUS" : lv ? "Izvēlies HUS" : "Choose HUS"}
        <select disabled={!first} value={first?.id ?? ""} onChange={(event) => { setFirstId(event.target.value); setPreview(null); }}>
          {selectable.map((row) => <option key={row.id} value={row.id}>{row.sectorName} · {row.sowingDate.slice(8, 10)}.{row.sowingDate.slice(5, 7)}</option>)}
        </select>
      </label>
      {dateInput(first, mode === "joint" ? lv ? "Pirmā HUS jaunā sēšana" : "First HUS new sowing" : lv ? "Jaunā sēšana" : "New seeding date")}
      {mode === "joint" ? <>
        <label>{lv ? "Otrais HUS" : "Second HUS"}<select value={second?.id ?? ""} onChange={(event) => { setSecondId(event.target.value); setPreview(null); }}>
          {selectable.filter((row) => row.id !== first?.id).map((row) => <option key={row.id} value={row.id}>{row.sectorName} · {row.sowingDate.slice(8, 10)}.{row.sowingDate.slice(5, 7)}</option>)}
        </select></label>
        {dateInput(second, lv ? "Otrā HUS jaunā sēšana" : "Second HUS new sowing")}
      </> : null}
      <button className="primary-action" type="button" onClick={calculate} disabled={!first || !sowingDate(first) || mode === "joint" && (!second || !sowingDate(second))}>
        {lv ? "Aprēķināt" : "Calculate"}
      </button>
    </div>
    {!first ? <p className="empty-state">{lv ? "Nav HUS ar vēl neizpildītu retināšanu." : "No HUS with pending thinning."}</p> : null}
    {currentPreview?.mode === "single" ? <SimulationResultView result={currentPreview.result} language={language} />
      : currentPreview?.mode === "joint" ? <JointSimulationResultView result={currentPreview.result} language={language} /> : null}
  </section>;
}

"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { plannerConfig } from "@/lib/demo-data";
import {
  addDays,
  balanceWorkload,
  buildGreenhouseSnapshot,
  calculateBoxPlan,
  calculateAvailability,
  countMainWork,
  calculateSowingPlan,
  calculateThinningPlan,
  createPlacementPlan,
  dateLabel,
  eachDate,
  generateWorksheetDays,
  generateWorkItemsForRows,
  getTotalSow,
  greenhouseRows,
  hasManualWorkMoves,
  isAllowedMove,
  toIsoDate,
} from "@/lib/planning";
import { candidateCycleLength, mockPlanImportService } from "@/lib/plan-import-service";
import {
  applyHusTemplateToDraft,
  calculateMoveOutDate,
  deriveCycleLength,
  operationalTotal,
  sectorTypeForOperationalTotal,
  standardHusTemplates,
  updateDraftCycleLength,
  updateDraftMoveOutDate,
  updateDraftSowingDate,
} from "@/lib/hus-templates";
import { SowingPlanApiConflictError } from "@/lib/repositories/api-sowing-plan-repository";
import { sowingPlanRepository } from "@/lib/repositories/sowing-plan-repository";
import type {
  ChangeHistoryEntry,
  ImportFieldKey,
  MainView,
  PlanImportCandidate,
  PlanImportResult,
  SectorType,
  SowingPlanDraft,
  SowingPlanRow,
  ViewMode,
  WorkItem,
  WorkloadBalanceProposal,
} from "@/lib/types";

const navItems: Array<{ id: MainView; label: string }> = [
  { id: "sowingPlan", label: "Plāns" },
  { id: "calendar", label: "Kalendārs" },
  { id: "hus", label: "Hus" },
];

const viewModes: Array<{ id: ViewMode; label: string }> = [
  { id: "month", label: "Mēnesis" },
  { id: "tenDays", label: "10 dienas" },
  { id: "today", label: "Šodien" },
];

const weekdayLabels = ["P", "O", "T", "C", "P", "S", "Sv"];

const initialDraft: SowingPlanDraft = {
  sectorName: "",
  requiredPlants: "3400",
  extraPlants: "144",
  variety: "",
  sowingDate: toIsoDate(new Date()),
  harvestDate: calculateMoveOutDate(toIsoDate(new Date()), 22),
  cycleLength: "22",
  cycleMode: "length",
  sectorType: 26,
  plantsPerBox: String(plannerConfig.defaultPlantsPerBox),
};

function calendarItemLabel(item: WorkItem) {
  const placementLabel =
    item.type === "thinning" && item.placement
      ? ` · ${item.placement.primaryRow ? `Rinda ${item.placement.primaryRow}` : "Nav rindas"} · ${item.placement.tables} galdi`
      : "";

  return `${item.title} · ${item.sectorName}${placementLabel} · ${compactNumber(item.plantCount)}`;
}

export function PlannerApp() {
  const [planRows, setPlanRows] = useState<SowingPlanRow[]>([]);
  const [repositoryMessage, setRepositoryMessage] = useState("Ielādē Supabase");
  const [activeView, setActiveView] = useState<MainView>("sowingPlan");
  const [viewMode, setViewMode] = useState<ViewMode>("month");
  const [anchorDate, setAnchorDate] = useState("2026-09-25");
  const [selectedDate, setSelectedDate] = useState("2026-09-25");
  const [selectedRowId, setSelectedRowId] = useState("");
  const [draft, setDraft] = useState<SowingPlanDraft>(initialDraft);
  const [moveErrors, setMoveErrors] = useState<Record<string, string>>({});
  const [importResult, setImportResult] = useState<PlanImportResult | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importMessage, setImportMessage] = useState("");
  const [balancePreview, setBalancePreview] = useState<WorkloadBalanceProposal[] | null>(null);
  const rowSaveChainsRef = useRef(new Map<string, Promise<SowingPlanRow>>());

  const workItems = useMemo(
    () =>
      generateWorkItemsForRows(planRows, plannerConfig).map((item) => {
        const row = planRows.find((candidate) => candidate.id === item.planRowId);
        if (item.type !== "thinning") {
          return item;
        }

        if (!row) {
          return item;
        }

        const placement = createPlacementPlan(row, planRows);
        const detailsWithoutStalePlacement = item.details.filter(
          (detail) => !detail.trim().startsWith("Rinda ") && !detail.trim().startsWith("Nav brīvas rindas"),
        );

        return {
          ...item,
          placement,
          capacityWarning: placement.warning,
          details: [
            ...detailsWithoutStalePlacement,
            `${placement.primaryRow ? `Rinda ${placement.primaryRow}` : "Nav brīvas rindas"} — ${placement.tables} galdi`,
          ],
        };
      }),
    [planRows],
  );
  const selectedRow = planRows.find((row) => row.id === selectedRowId) ?? planRows[0];
  const hasDemoRows = planRows.some((row) => row.source === "demo");
  const selectedDayItems = workItems
    .filter((item) => item.date === selectedDate)
    .sort((a, b) => a.sectorName.localeCompare(b.sectorName, "lv"));
  const calendarDays = getCalendarDays(anchorDate, viewMode);
  const upcomingItems = [...workItems]
    .filter((item) => item.date >= toIsoDate(new Date()))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 6);

  useEffect(() => {
    let cancelled = false;

    async function loadRows() {
      try {
        const loadedRows = await sowingPlanRepository.load();
        if (cancelled) {
          return;
        }

        setPlanRows(loadedRows);
        setSelectedRowId(loadedRows[0]?.id ?? "");
        setRepositoryMessage("Supabase aktīvs");
      } catch (error) {
        if (!cancelled) {
          setRepositoryMessage(error instanceof Error ? error.message : "Neizdevās ielādēt Supabase plānu");
        }
      }
    }

    void loadRows();
    return () => {
      cancelled = true;
    };
  }, []);

  async function reloadRows(message = "Supabase pārlādēts") {
    const loadedRows = await sowingPlanRepository.load();
    setPlanRows(loadedRows);
    setSelectedRowId((current) => (loadedRows.some((row) => row.id === current) ? current : loadedRows[0]?.id ?? ""));
    setRepositoryMessage(message);
  }

  async function addPlanRow(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const requiredPlants = Number(draft.requiredPlants);
    const extraPlants = Number(draft.extraPlants);
    const cycleLength = Number(draft.cycleLength) || deriveCycleLength(draft.sowingDate, draft.harvestDate);

    if (!draft.sectorName.trim() || !draft.variety.trim() || requiredPlants <= 0) {
      return;
    }

    const row: SowingPlanRow = {
      id: crypto.randomUUID(),
      sectorName: draft.sectorName.trim(),
      requiredPlants,
      extraPlants,
      variety: draft.variety.trim(),
      sowingDate: draft.sowingDate,
      harvestDate: draft.harvestDate,
      cycleLength,
      sectorType: draft.sectorType,
      plantsPerBox: plannerConfig.defaultPlantsPerBox,
      correction: 0,
      weekNumber: getIsoWeek(draft.sowingDate),
      status: "planned",
      changeHistory: [historyEntry("Rinda izveidota", "", "Manuāla ievade", "Sēšanas plāns")],
      source: "user",
    };

    setRepositoryMessage("Saglabā Supabase");
    try {
      const savedRow = await sowingPlanRepository.create(row);
      setPlanRows((current) => [savedRow, ...current]);
      setSelectedRowId(savedRow.id);
      setSelectedDate(savedRow.sowingDate);
      setAnchorDate(savedRow.sowingDate);
      setDraft(initialDraft);
      setActiveView("worksheet");
      setRepositoryMessage("Supabase saglabāts");
    } catch (error) {
      setRepositoryMessage(error instanceof Error ? error.message : "Neizdevās izveidot Hus Supabase");
    }
  }

  function updatePlanRow(id: string, patch: Partial<SowingPlanRow>, options?: { resetSchedule?: boolean }) {
    const previous = planRows.find((row) => row.id === id);
    if (!previous) {
      return;
    }

    const next = { ...previous, ...patch };
    const persistedRow = {
      ...next,
      adjustments: options?.resetSchedule ? undefined : sanitizeAdjustments(next),
      changeHistory: appendChangeHistory(previous, next, patch, options?.resetSchedule),
    };

    setPlanRows((current) => current.map((row) => (row.id === id ? persistedRow : row)));
    void persistRowUpdate(previous, persistedRow);
  }

  function persistRowUpdate(previous: SowingPlanRow, next: SowingPlanRow): Promise<SowingPlanRow> {
    setRepositoryMessage("Saglabā Supabase");
    const baseline = rowSaveChainsRef.current.get(previous.id) ?? Promise.resolve(previous);
    const operation = baseline
      .then((latestSavedRow) =>
        sowingPlanRepository.update({
          ...next,
          updatedAt: latestSavedRow.updatedAt ?? previous.updatedAt,
        }),
      )
      .then((savedRow) => {
        setPlanRows((current) => current.map((row) => (row.id === savedRow.id ? savedRow : row)));
        setRepositoryMessage("Supabase saglabāts");
        return savedRow;
      })
      .catch(async (error) => {
        rowSaveChainsRef.current.delete(previous.id);
        if (error instanceof SowingPlanApiConflictError) {
          setRepositoryMessage("Šis Hus ir mainīts citur. Dati pārlādēti; pārbaudi jaunāko versiju pirms atkārtotas izmaiņas.");
          await reloadRows("Šis Hus ir mainīts citur. Pārbaudi jaunāko versiju.");
          return next;
        }

        setRepositoryMessage(error instanceof Error ? error.message : "Neizdevās saglabāt Hus Supabase");
        return next;
      });

    rowSaveChainsRef.current.set(previous.id, operation);
    return operation;
  }

  function updateDateField(row: SowingPlanRow, field: "sowingDate" | "harvestDate", value: string) {
    const patch: Partial<SowingPlanRow> =
      field === "sowingDate"
        ? { sowingDate: value, cycleLength: deriveCycleLength(value, row.harvestDate), weekNumber: getIsoWeek(value) }
        : { harvestDate: value, cycleLength: deriveCycleLength(row.sowingDate, value) };

    if (field === "sowingDate" && hasManualWorkMoves(row)) {
      const reset = window.confirm("Sēšanas datums mainīts. Vai pārrēķināt šī Hus darba grafiku?");
      updatePlanRow(row.id, patch, { resetSchedule: reset });
      return;
    }

    updatePlanRow(row.id, patch, { resetSchedule: field === "harvestDate" });
  }

  function updateCycleLength(row: SowingPlanRow, cycleLength: number) {
    updatePlanRow(row.id, {
      cycleLength,
      harvestDate: calculateMoveOutDate(row.sowingDate, cycleLength),
      adjustments: undefined,
    }, { resetSchedule: true });
  }

  function deletePlanRow(id: string) {
    const row = planRows.find((candidate) => candidate.id === id);
    if (row && !window.confirm(`Dzēst rindu "${row.sectorName}"?`)) {
      return;
    }

    const remaining = planRows.filter((row) => row.id !== id);
    setPlanRows(remaining);
    setSelectedRowId(remaining[0]?.id ?? "");
    if (remaining.length === 0) {
      setActiveView("sowingPlan");
    }

    if (row && row.source !== "demo") {
      void deleteRowFromSupabase(row);
    }
  }

  async function deleteRowFromSupabase(row: SowingPlanRow) {
    setRepositoryMessage("Dzēš Supabase");
    try {
      await sowingPlanRepository.delete(row);
      setRepositoryMessage("Supabase saglabāts");
    } catch (error) {
      if (error instanceof SowingPlanApiConflictError) {
        await reloadRows("Šis Hus ir mainīts citur. Dzēšana apturēta; pārbaudi jaunāko versiju.");
        return;
      }

      setRepositoryMessage(error instanceof Error ? error.message : "Neizdevās dzēst Hus Supabase");
      await reloadRows("Dzēšana neizdevās. Supabase dati pārlādēti.");
    }
  }

  async function persistRowDiff(previousRows: SowingPlanRow[], nextRows: SowingPlanRow[]) {
    setRepositoryMessage("Saglabā Supabase");
    const previousById = new Map(previousRows.map((row) => [row.id, row]));
    const nextById = new Map(nextRows.map((row) => [row.id, row]));

    try {
      await Promise.all(
        nextRows.map(async (row) => {
          const previous = previousById.get(row.id);
          if (!previous) {
            const saved = await sowingPlanRepository.create(row);
            setPlanRows((current) => current.map((candidate) => (candidate.id === row.id ? saved : candidate)));
            return;
          }

          if (rowsDiffer(previous, row)) {
            await persistRowUpdate(previous, row);
          }
        }),
      );

      await Promise.all(
        previousRows
          .filter((row) => !nextById.has(row.id) && row.source !== "demo")
          .map((row) => sowingPlanRepository.delete(row)),
      );

      setRepositoryMessage("Supabase saglabāts");
    } catch (error) {
      if (error instanceof SowingPlanApiConflictError) {
        await reloadRows("Kāda rinda mainīta citur. Dati pārlādēti; pārbaudi jaunāko versiju.");
        return;
      }

      setRepositoryMessage(error instanceof Error ? error.message : "Neizdevās saglabāt Supabase");
    }
  }

  function deleteDemoRows() {
    const remaining = planRows.filter((row) => row.source !== "demo");
    setPlanRows(remaining);
    setSelectedRowId(remaining[0]?.id ?? "");
  }

  function moveWork(item: WorkItem, date: string) {
    const row = planRows.find((candidate) => candidate.id === item.planRowId);
    if (!row || item.fixed) {
      return;
    }

    if (!isAllowedMove(row, item.type, date)) {
      setMoveErrors((current) => ({
        ...current,
        [item.id]: "Šis datums nav atļautajā darba intervālā.",
      }));
      return;
    }

    const adjustmentKey =
      item.type === "thinning" ? "thinning" : item.type === "sideShoots" ? "sideShoots" : "sticks";
    updatePlanRow(row.id, {
      adjustments: {
        ...row.adjustments,
        [adjustmentKey]: date,
      },
    });
    setMoveErrors((current) => ({ ...current, [item.id]: "" }));
  }

  function moveFlexibleWorkRange(item: WorkItem, startDate: string, endDate: string) {
    const row = planRows.find((candidate) => candidate.id === item.planRowId);
    if (!row || item.scheduleKind !== "flexible") {
      return;
    }

    const dates = eachDate(startDate, endDate).filter((date) => isAllowedMove(row, item.type, date));
    if (dates.length === 0 || dates[0] !== startDate || dates.at(-1) !== endDate) {
      setMoveErrors((current) => ({
        ...current,
        [item.id]: "Šis periods nav atļautajā darba intervālā.",
      }));
      return;
    }

    const adjustmentKey = item.type === "sideShoots" ? "sideShoots" : "sticks";
    updatePlanRow(row.id, {
      adjustments: {
        ...row.adjustments,
        [adjustmentKey]: dates.length === 1 ? dates[0] : dates,
      },
    });
    setMoveErrors((current) => ({ ...current, [item.id]: "" }));
  }

  function updatePlacement(row: SowingPlanRow, patch: NonNullable<SowingPlanRow["placement"]>) {
    updatePlanRow(row.id, {
      placement: {
        ...row.placement,
        ...patch,
        manual: true,
      },
    });
  }

  async function importPlanFromFile(file: File) {
    setImportBusy(true);
    setImportMessage("");

    try {
      const result = await mockPlanImportService.analyzeImage(file);
      setImportResult({
        ...result,
        candidates: markImportDuplicates(result.candidates, planRows),
      });
      setImportMessage("Demo režīms: foto netiek analizēts ar īstu OCR/AI. Zemāk redzami pārbaudes kandidāti plūsmas testēšanai.");
    } finally {
      setImportBusy(false);
    }
  }

  function updateImportCandidate(id: string, field: ImportFieldKey, value: string) {
    setImportResult((current) => {
      if (!current) {
        return current;
      }

      const candidates = current.candidates.map((candidate) => {
        if (candidate.id !== id) {
          return candidate;
        }

        const numericFields: ImportFieldKey[] = ["requiredPlants", "weekNumber"];
        const nextValue = numericFields.includes(field) ? Number(value) : value;

        return {
          ...candidate,
          fields: {
            ...candidate.fields,
            [field]: {
              value: nextValue,
              confidence: 1,
              needsReview: false,
            },
          },
        } as PlanImportCandidate;
      });

      return {
        ...current,
        candidates: markImportDuplicates(candidates, planRows),
      };
    });
  }

  function updateDuplicateAction(id: string, duplicateAction: NonNullable<PlanImportCandidate["duplicateAction"]>) {
    setImportResult((current) =>
      current
        ? {
            ...current,
            candidates: current.candidates.map((candidate) =>
              candidate.id === id ? { ...candidate, duplicateAction } : candidate,
            ),
          }
        : current,
    );
  }

  function confirmImport() {
    if (!importResult) {
      return;
    }

    const needsReview = importResult.candidates.some((candidate) =>
      Object.values(candidate.fields).some((field) => field.needsReview),
    );
    if (needsReview) {
      setImportMessage("Pirms apstiprināšanas izlabo vai apstiprini izceltos laukus.");
      return;
    }

    const nextRows = applyImportCandidates(planRows, importResult.candidates);
    setPlanRows(nextRows);
    void persistRowDiff(planRows, nextRows);
    setImportResult(null);
    setImportMessage("Imports apstiprināts. Plāna rindas, darbi, kalendārs un stādu mājas noslodze ir pārrēķināta.");
    setActiveView("sowingPlan");
  }

  function previewWorkloadBalance() {
    setBalancePreview(balanceWorkload(planRows, plannerConfig));
  }

  function confirmWorkloadBalance() {
    if (!balancePreview) {
      return;
    }

    const nextRows = planRows.map((row) => {
      const proposals = balancePreview.filter((proposal) => proposal.planRowId === row.id);
      if (proposals.length === 0) {
        return row;
      }

      const adjustments = { ...row.adjustments };
      proposals.forEach((proposal) => {
        adjustments[proposal.type] = proposal.toDates.length === 1 ? proposal.toDates[0] : proposal.toDates;
      });

      return {
        ...row,
        adjustments,
        changeHistory: [
          ...(row.changeHistory ?? []),
          ...proposals.map((proposal) =>
            historyEntry(
              proposal.title,
              formatDateRange(proposal.fromDates),
              formatDateRange(proposal.toDates),
              "Darbi izlīdzināti kalendārā",
            ),
          ),
        ],
      };
    });

    setPlanRows(nextRows);
    void persistRowDiff(planRows, nextRows);
    setBalancePreview(null);
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">Privāts ražošanas plānotājs</p>
          <h1>Gurķu stādu cikli</h1>
        </div>
        <div className="topbar__stats">
          <span>{repositoryMessage}</span>
          <span>{planRows.length} plāna rindas</span>
          <strong>{workItems.length} darbi</strong>
          <form action="/api/auth/logout" method="post">
            <button className="secondary-action" type="submit">
              Iziet
            </button>
          </form>
        </div>
      </header>

      <nav className="main-nav" aria-label="Galvenie skati">
        {navItems.map((item) => (
          <button
            className={item.id === activeView ? "is-active" : ""}
            key={item.id}
            onClick={() => setActiveView(item.id)}
            type="button"
          >
            {item.label}
          </button>
        ))}
      </nav>

      {activeView === "sowingPlan" ? (
        <section className="layout-grid layout-grid--wide">
          <SowingPlanPanel
            draft={draft}
            hasDemoRows={hasDemoRows}
            onAdd={addPlanRow}
            onDelete={deletePlanRow}
            onDeleteDemo={deleteDemoRows}
            onConfirmImport={confirmImport}
            onDraftChange={setDraft}
            onImportActionChange={updateDuplicateAction}
            onImportCandidateChange={updateImportCandidate}
            onImportFile={importPlanFromFile}
            onOpenRow={(id) => {
              setSelectedRowId(id);
              setActiveView("worksheet");
            }}
            onUpdateDate={updateDateField}
            onUpdateRow={updatePlanRow}
            importBusy={importBusy}
            importMessage={importMessage}
            importResult={importResult}
            rows={planRows}
          />
        </section>
      ) : null}

      {activeView === "calendar" ? (
        <>
          <CapacityAlerts
            items={workItems}
            onOpen={(date) => {
              setSelectedDate(date);
              setActiveView("greenhouse");
            }}
          />
          <section className="layout-grid">
            <CalendarPanel
              anchorDate={anchorDate}
              balancePreview={balancePreview}
              calendarDays={calendarDays}
              onApplyBalance={confirmWorkloadBalance}
              onCancelBalance={() => setBalancePreview(null)}
              onPreviewBalance={previewWorkloadBalance}
              onSelectDate={setSelectedDate}
              onSetAnchorDate={setAnchorDate}
              selectedDate={selectedDate}
              viewMode={viewMode}
              workItems={workItems}
              onSetViewMode={setViewMode}
            />
            <DayDetails
              errors={moveErrors}
              items={selectedDayItems}
              onMove={moveWork}
              onMoveRange={moveFlexibleWorkRange}
              selectedDate={selectedDate}
            />
          </section>
          <MonthlyPrintPlan monthDate={anchorDate} onMonthChange={setAnchorDate} workItems={workItems} />
        </>
      ) : null}

      {activeView === "hus" ? (
        <HusList
          onOpen={(id) => {
            setSelectedRowId(id);
            setActiveView("worksheet");
          }}
          rows={planRows}
        />
      ) : null}

      {activeView === "greenhouse" ? (
        <GreenhousePanel
          date={selectedDate}
          onDateChange={setSelectedDate}
          rows={planRows}
        />
      ) : null}

      {activeView === "worksheet" && selectedRow ? (
        <WorksheetView
          onEdit={() => setActiveView("batch")}
          row={selectedRow}
          workItems={workItems.filter((item) => item.planRowId === selectedRow.id)}
        />
      ) : null}

      {activeView === "monthPlan" ? (
        <MonthlyPrintPlan
          monthDate={anchorDate}
          onMonthChange={setAnchorDate}
          workItems={workItems}
        />
      ) : null}

      {activeView === "batch" && selectedRow ? (
        <section className="layout-grid">
          <BatchEditor
            onUpdateCycleLength={updateCycleLength}
            onUpdateDate={updateDateField}
            onUpdatePlacement={updatePlacement}
            onUpdateRow={updatePlanRow}
            row={selectedRow}
            rows={planRows}
          />
          <BatchTimeline
            errors={moveErrors}
            items={workItems.filter((item) => item.planRowId === selectedRow.id)}
            onMove={moveWork}
            onMoveRange={moveFlexibleWorkRange}
            row={selectedRow}
            onOpenWorksheet={() => setActiveView("worksheet")}
          />
        </section>
      ) : null}

      {activeView === "batch" && !selectedRow ? (
        <section className="panel">
          <div className="panel-header">
            <div>
              <p className="eyebrow">Hus darba lapa</p>
              <h2>Nav izvēlēts Hus</h2>
            </div>
            <button className="primary-action" type="button" onClick={() => setActiveView("sowingPlan")}>
              Atvērt sēšanas plānu
            </button>
          </div>
        </section>
      ) : null}

      <section className="panel next-panel">
        <div className="panel-header">
          <div>
            <p className="eyebrow">Tuvākie darbi</p>
            <h2>Ātrā pārbaude</h2>
          </div>
        </div>
        <div className="upcoming-list">
          {upcomingItems.map((item) => (
            <span className={`work-chip work-chip--${item.color}`} key={item.id}>
              {dateLabel(item.date)} · {item.title} · {item.sectorName}
            </span>
          ))}
        </div>
      </section>
    </main>
  );
}

function SowingPlanPanel({
  draft,
  hasDemoRows,
  importBusy,
  importMessage,
  importResult,
  onAdd,
  onConfirmImport,
  onDelete,
  onDeleteDemo,
  onDraftChange,
  onImportActionChange,
  onImportCandidateChange,
  onImportFile,
  onOpenRow,
  onUpdateDate,
  onUpdateRow,
  rows,
}: {
  draft: SowingPlanDraft;
  hasDemoRows: boolean;
  importBusy: boolean;
  importMessage: string;
  importResult: PlanImportResult | null;
  onAdd: (event: FormEvent<HTMLFormElement>) => void;
  onConfirmImport: () => void;
  onDelete: (id: string) => void;
  onDeleteDemo: () => void;
  onDraftChange: (draft: SowingPlanDraft) => void;
  onImportActionChange: (id: string, action: NonNullable<PlanImportCandidate["duplicateAction"]>) => void;
  onImportCandidateChange: (id: string, field: ImportFieldKey, value: string) => void;
  onImportFile: (file: File) => void;
  onOpenRow: (id: string) => void;
  onUpdateDate: (row: SowingPlanRow, field: "sowingDate" | "harvestDate", value: string) => void;
  onUpdateRow: (id: string, patch: Partial<SowingPlanRow>) => void;
  rows: SowingPlanRow[];
}) {
  return (
    <section className="panel plan-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Sezonas pamats</p>
          <h2>Plāns</h2>
        </div>
        <div className="button-row">
          <label className="file-action">
            📷 Importēt plānu no foto
            <input
              accept="image/png,image/jpeg"
              capture="environment"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  onImportFile(file);
                  event.target.value = "";
                }
              }}
              type="file"
            />
          </label>
          {hasDemoRows ? (
            <button className="secondary-action" type="button" onClick={onDeleteDemo}>
              Dzēst demo datus
            </button>
          ) : null}
        </div>
      </div>

      {importBusy ? <p className="import-note">Apstrādā foto failu demo importa plūsmā...</p> : null}
      {importMessage ? <p className="import-note">{importMessage}</p> : null}
      {importResult ? (
        <ImportReviewPanel
          importResult={importResult}
          onActionChange={onImportActionChange}
          onChange={onImportCandidateChange}
          onConfirm={onConfirmImport}
        />
      ) : null}

      <form className="plan-form plan-form--quick" onSubmit={onAdd}>
        <div className="quick-entry-grid">
          <label>
            Hus
            <select
              onChange={(event) => onDraftChange(applyHusTemplateToDraft(draft, event.target.value))}
              required
              value={standardHusTemplates.some((template) => template.hus === draft.sectorName) ? draft.sectorName : ""}
            >
              <option value="">Izvēlies Hus</option>
              {standardHusTemplates.map((template) => (
                <option key={template.hus} value={template.hus}>
                  {template.hus}
                </option>
              ))}
            </select>
          </label>
          <label>
            Sēšana
            <input
              onChange={(event) => onDraftChange(updateDraftSowingDate(draft, event.target.value))}
              required
              type="date"
              value={draft.sowingDate}
            />
          </label>
          <div className="cycle-picker">
            <span>Cikls</span>
            <div className="segmented segmented--compact">
              {[21, 22, 23].map((cycleLength) => (
                <button
                  className={draft.cycleMode === "length" && Number(draft.cycleLength) === cycleLength ? "is-active" : ""}
                  key={cycleLength}
                  onClick={() => onDraftChange(updateDraftCycleLength(draft, cycleLength))}
                  type="button"
                >
                  {cycleLength}
                </button>
              ))}
              <button
                className={draft.cycleMode === "moveOut" ? "is-active" : ""}
                onClick={() => onDraftChange({ ...draft, cycleMode: "moveOut", cycleLength: String(deriveCycleLength(draft.sowingDate, draft.harvestDate)) })}
                type="button"
              >
                Cits
              </button>
            </div>
          </div>
          <label>
            Izvākšana
            <input
              onChange={(event) => onDraftChange(updateDraftMoveOutDate(draft, event.target.value))}
              required
              type="date"
              value={draft.harvestDate}
            />
          </label>
        </div>

        <div className="quick-entry-summary">
          <strong>
            {draft.variety || "Šķirne"} · {Number(draft.requiredPlants || 0).toLocaleString("lv-LV")} +{" "}
            {Number(draft.extraPlants || 0).toLocaleString("lv-LV")} →{" "}
            {operationalTotal(Number(draft.requiredPlants || 0), Number(draft.extraPlants || 0)).toLocaleString("lv-LV")} stādi
          </strong>
          <span>
            Izvākšana {shortDate(draft.harvestDate)} · {draft.cycleLength || "?"} dienu cikls
          </span>
        </div>

        <details className="advanced-fields">
          <summary>Mainīt parametrus</summary>
          <div className="advanced-fields__grid">
            <label>
              Hus nosaukums
              <input
                onChange={(event) => onDraftChange({ ...draft, sectorName: event.target.value })}
                placeholder="Hus 3"
                required
                value={draft.sectorName}
              />
            </label>
            <label>
              Agronoma sējamais skaits
              <input
                min="1"
                onChange={(event) => {
                  const requiredPlants = event.target.value;
                  const total = operationalTotal(Number(requiredPlants), Number(draft.extraPlants || 0));
                  onDraftChange({ ...draft, requiredPlants, sectorType: sectorTypeForOperationalTotal(total) });
                }}
                required
                type="number"
                value={draft.requiredPlants}
              />
            </label>
            <label>
              Darbinieka extra
              <input
                onChange={(event) => {
                  const extraPlants = event.target.value;
                  const total = operationalTotal(Number(draft.requiredPlants || 0), Number(extraPlants));
                  onDraftChange({ ...draft, extraPlants, sectorType: sectorTypeForOperationalTotal(total) });
                }}
                type="number"
                value={draft.extraPlants}
              />
            </label>
            <label>
              Šķirne
              <input
                onChange={(event) => onDraftChange({ ...draft, variety: event.target.value })}
                placeholder="Baltazsara"
                required
                value={draft.variety}
              />
            </label>
            <label>
              Sektora galdi
              <select
                value={draft.sectorType}
                onChange={(event) => onDraftChange({ ...draft, sectorType: Number(event.target.value) as SectorType })}
              >
                <option value={26}>26 galdi</option>
                <option value={39}>39 galdi</option>
              </select>
            </label>
          </div>
        </details>

        <button className="primary-action" type="submit">
          Pievienot Hus
        </button>
      </form>

      <div className="plan-table" role="table" aria-label="Plāna Hus rindas">
        <div className="plan-row plan-row--head" role="row">
          <span>Hus</span>
          <span>Agronoma sēja</span>
          <span>Extra</span>
          <span>Kopā sēt</span>
          <span>Šķirne</span>
          <span>Sēšana</span>
          <span>Izvākšana</span>
          <span>Darbības</span>
        </div>
        {rows.length === 0 ? <p className="empty-state">Plāna rindu vēl nav.</p> : null}
        {rows.map((row) => {
          const totalSow = getTotalSow(row);

          return (
            <div className="plan-row" role="row" key={row.id}>
              <input value={row.sectorName} onChange={(event) => onUpdateRow(row.id, { sectorName: event.target.value })} />
              <input
                min="1"
                type="number"
                value={row.requiredPlants}
                onChange={(event) => onUpdateRow(row.id, { requiredPlants: Number(event.target.value) })}
              />
              <input
                type="number"
                value={row.extraPlants}
                onChange={(event) => onUpdateRow(row.id, { extraPlants: Number(event.target.value) })}
              />
              <strong>{totalSow.toLocaleString("lv-LV")}</strong>
              <input value={row.variety} onChange={(event) => onUpdateRow(row.id, { variety: event.target.value })} />
              <input type="date" value={row.sowingDate} onChange={(event) => onUpdateDate(row, "sowingDate", event.target.value)} />
              <input type="date" value={row.harvestDate} onChange={(event) => onUpdateDate(row, "harvestDate", event.target.value)} />
              <span className="button-row">
                <button className="secondary-action" type="button" onClick={() => onOpenRow(row.id)}>
                  Atvērt Hus
                </button>
                <button className="danger-action" type="button" onClick={() => onDelete(row.id)}>
                  Dzēst
                </button>
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function ImportReviewPanel({
  importResult,
  onActionChange,
  onChange,
  onConfirm,
}: {
  importResult: PlanImportResult;
  onActionChange: (id: string, action: NonNullable<PlanImportCandidate["duplicateAction"]>) => void;
  onChange: (id: string, field: ImportFieldKey, value: string) => void;
  onConfirm: () => void;
}) {
  return (
    <section className="import-review">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Foto imports</p>
          <h3>Pārbaudīt atpazīto plānu</h3>
        </div>
        <span className="mock-badge">Demo/mock režīms · {importResult.fileName}</span>
      </div>
      <p className="import-note">
        Šīs rindas vēl nav pievienotas sezonas plānam. Izlabo izceltos laukus un tikai tad apstiprini importu.
      </p>
      <div className="import-table" role="table" aria-label="Atpazītā plāna pārbaude">
        <div className="import-row import-row--head" role="row">
          <span>Hus</span>
          <span>Stādi</span>
          <span>Šķirne</span>
          <span>Nedēļa</span>
          <span>Sēšana</span>
          <span>Izvākšana</span>
          <span>Dublikāti</span>
        </div>
        {importResult.candidates.map((candidate) => (
          <div className="import-row" key={candidate.id} role="row">
            <ReviewInput candidate={candidate} field="sectorName" onChange={onChange} />
            <ReviewInput candidate={candidate} field="requiredPlants" onChange={onChange} type="number" />
            <ReviewInput candidate={candidate} field="variety" onChange={onChange} />
            <ReviewInput candidate={candidate} field="weekNumber" onChange={onChange} type="number" />
            <ReviewInput candidate={candidate} field="sowingDate" onChange={onChange} type="date" />
            <ReviewInput candidate={candidate} field="harvestDate" onChange={onChange} type="date" />
            <div className="duplicate-cell">
              {candidate.duplicateOf ? (
                <>
                  <strong>Iespējams, šis Hus cikls jau eksistē.</strong>
                  <select
                    value={candidate.duplicateAction ?? "keepExisting"}
                    onChange={(event) =>
                      onActionChange(candidate.id, event.target.value as NonNullable<PlanImportCandidate["duplicateAction"]>)
                    }
                  >
                    <option value="keepExisting">Atstāt esošo</option>
                    <option value="replace">Aizvietot/atjaunināt</option>
                    <option value="createNew">Izveidot kā jaunu</option>
                  </select>
                </>
              ) : (
                <span>Jauna rinda</span>
              )}
            </div>
          </div>
        ))}
      </div>
      <button className="primary-action" type="button" onClick={onConfirm}>
        Apstiprināt un izveidot plānu
      </button>
    </section>
  );
}

function CapacityAlerts({ items, onOpen }: { items: WorkItem[]; onOpen: (date: string) => void }) {
  const warnings = items.filter((item) => item.capacityWarning);

  if (warnings.length === 0) {
    return null;
  }

  return (
    <section className="capacity-alerts no-print">
      {warnings.map((item) => (
        <button key={item.id} type="button" onClick={() => onOpen(item.date)}>
          ⚠ {item.sectorName} retināšanai {shortDate(item.date)} jāpārbauda galdu noslodze
        </button>
      ))}
    </section>
  );
}

function WorksheetView({
  onEdit,
  row,
  workItems,
}: {
  onEdit: () => void;
  row: SowingPlanRow;
  workItems: WorkItem[];
}) {
  const totalSow = getTotalSow(row);
  const worksheetDays = generateWorksheetDays(row, plannerConfig);
  const rings = workItems.find((item) => item.type === "rings");
  const sticks = workItems.find((item) => item.type === "sticks");

  return (
    <section className="print-host">
      <div className="panel-header no-print">
        <div>
          <h2>{row.sectorName}</h2>
        </div>
        <div className="button-row">
          <button className="secondary-action" type="button" onClick={onEdit}>
            Rediģēt
          </button>
          <button className="primary-action" type="button" onClick={() => window.print()}>
            Printēt
          </button>
        </div>
      </div>

      <article className="print-page worksheet-page">
        <header className="worksheet-header">
          <h1 className="print-only-title">{row.sectorName}</h1>
          <div className="worksheet-meta">
            <span><strong>Sēšana:</strong> {shortDate(row.sowingDate)}</span>
            <span><strong>Stādi:</strong> {totalSow.toLocaleString("lv-LV")}</span>
            <span><strong>Šķirne:</strong> {row.variety}</span>
            <span><strong>Izvākšana:</strong> {shortDate(row.harvestDate)}</span>
            <span><strong>Gredzeni:</strong> {rings ? shortDate(rings.date) : ""}</span>
            <span><strong>Kociņi:</strong> {sticks ? shortDate(sticks.date) : ""}</span>
          </div>
        </header>

        <table className="worksheet-table">
          <thead>
            <tr>
              <th>Day</th>
              <th>Date</th>
              <th>Water min</th>
              <th>Temp</th>
              <th>Plants out</th>
              <th>Div / Darbi</th>
            </tr>
          </thead>
          <tbody>
            {worksheetDays.map((day) => (
              <tr key={day.day}>
                <td>{day.day}</td>
                <td>{shortDate(day.date)}</td>
                <td aria-label="Water min" />
                <td aria-label="Temp" />
                <td aria-label="Plants out" />
                <td>{day.works.map((work) => work.title).join(" + ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </article>
    </section>
  );
}

function MonthlyPrintPlan({
  monthDate,
  onMonthChange,
  workItems,
}: {
  monthDate: string;
  onMonthChange: (date: string) => void;
  workItems: WorkItem[];
}) {
  const items = monthlyWorkItems(workItems, monthDate);

  return (
    <section className="print-host">
      <div className="panel panel-header no-print">
        <div>
          <p className="eyebrow">Drukājams kopsavilkums</p>
          <h2>Mēneša darba plāns</h2>
        </div>
        <div className="button-row month-controls">
          <label>
            Mēnesis
            <input
              type="month"
              value={monthInputValue(monthDate)}
              onChange={(event) => onMonthChange(`${event.target.value}-01`)}
            />
          </label>
          <button className="primary-action" type="button" onClick={() => window.print()}>
            Printēt mēnesi
          </button>
        </div>
      </div>

      <article className="print-page month-page">
        <header className="month-print-header">
          <h1>{monthTitle(monthDate)}</h1>
          <p>Kopējais darba plāns visiem Hus</p>
        </header>
        <table className="month-print-table">
          <thead>
            <tr>
              <th>Datums</th>
              <th>Hus</th>
              <th>Darbs</th>
              <th>Stādi</th>
              <th>Piezīmes</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td colSpan={5}>Šajā mēnesī nav ieplānotu darbu.</td>
              </tr>
            ) : null}
            {items.map((item) => (
              <tr key={item.id}>
                <td>{shortDate(item.date)}</td>
                <td>{item.sectorName}</td>
                <td>{item.title}</td>
                <td>{item.plantCount.toLocaleString("lv-LV")}</td>
                <td>{item.capacityWarning ? `Kapacitāte: ${item.capacityWarning}` : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </article>
    </section>
  );
}

function ReviewInput({
  candidate,
  field,
  onChange,
  type = "text",
}: {
  candidate: PlanImportCandidate;
  field: ImportFieldKey;
  onChange: (id: string, field: ImportFieldKey, value: string) => void;
  type?: "text" | "number" | "date";
}) {
  const value = candidate.fields[field];

  return (
    <label className={value.needsReview ? "needs-review" : ""}>
      <input
        min={type === "number" ? "1" : undefined}
        onChange={(event) => onChange(candidate.id, field, event.target.value)}
        type={type}
        value={String(value.value)}
      />
      {value.needsReview ? <small>Pārbaudi ({Math.round(value.confidence * 100)}%)</small> : null}
    </label>
  );
}

function CalendarPanel({
  anchorDate,
  balancePreview,
  calendarDays,
  onApplyBalance,
  onCancelBalance,
  onPreviewBalance,
  onSelectDate,
  onSetAnchorDate,
  onSetViewMode,
  selectedDate,
  viewMode,
  workItems,
}: {
  anchorDate: string;
  balancePreview: WorkloadBalanceProposal[] | null;
  calendarDays: ReturnType<typeof getCalendarDays>;
  onApplyBalance: () => void;
  onCancelBalance: () => void;
  onPreviewBalance: () => void;
  onSelectDate: (date: string) => void;
  onSetAnchorDate: (date: string) => void;
  onSetViewMode: (mode: ViewMode) => void;
  selectedDate: string;
  viewMode: ViewMode;
  workItems: WorkItem[];
}) {
  return (
    <div className="panel calendar-panel no-print">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Kopējais kalendārs</p>
          <h2>{calendarTitle(anchorDate, viewMode)}</h2>
        </div>
        <div className="calendar-controls">
          <button type="button" onClick={onPreviewBalance}>
            Izlīdzināt darbus
          </button>
          <button type="button" onClick={() => onSetAnchorDate(shiftAnchor(anchorDate, viewMode, -1))}>
            ←
          </button>
          <button
            type="button"
            onClick={() => {
              const today = toIsoDate(new Date());
              onSetAnchorDate(today);
              onSelectDate(today);
              onSetViewMode("today");
            }}
          >
            Šodien
          </button>
          <button type="button" onClick={() => onSetAnchorDate(shiftAnchor(anchorDate, viewMode, 1))}>
            →
          </button>
        </div>
      </div>

      {balancePreview ? (
        <BalancePreview proposals={balancePreview} onApply={onApplyBalance} onCancel={onCancelBalance} />
      ) : null}

      <div className="segmented" aria-label="Kalendāra skata režīms">
        {viewModes.map((mode) => (
          <button
            className={viewMode === mode.id ? "is-active" : ""}
            key={mode.id}
            onClick={() => onSetViewMode(mode.id)}
            type="button"
          >
            {mode.label}
          </button>
        ))}
      </div>

      <div className="calendar-grid">
        {weekdayLabels.map((day, index) => (
          <span className="weekday" key={`${day}-${index}`}>
            {day}
          </span>
        ))}
        {calendarDays.map((day) => {
          const dayItems = workItems.filter((item) => item.date === day.isoDate);
          const mainWorkload = countMainWork(dayItems, day.isoDate);
          const overloaded = mainWorkload > 1;
          const hasCapacityWarning = dayItems.some((item) => item.capacityWarning);

          return (
            <button
              className={[
                "calendar-day",
                day.inCurrentRange ? "" : "is-muted",
                day.isoDate === selectedDate ? "is-selected" : "",
                overloaded ? "is-overloaded" : "",
                hasCapacityWarning ? "has-capacity-warning" : "",
              ].join(" ")}
              key={day.isoDate}
              onClick={() => onSelectDate(day.isoDate)}
              type="button"
            >
              <span className="calendar-day__number">{day.dayNumber}</span>
              <span className="calendar-day__items">
                {dayItems.slice(0, 3).map((item) => (
                  <span className={`work-chip work-chip--${item.color}`} key={item.id}>
                    {calendarItemLabel(item)}
                  </span>
                ))}
              </span>
              {dayItems.length > 3 ? <span className="more">+{dayItems.length - 3}</span> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DayDetails({
  errors,
  items,
  onMove,
  onMoveRange,
  selectedDate,
}: {
  errors: Record<string, string>;
  items: WorkItem[];
  onMove: (item: WorkItem, date: string) => void;
  onMoveRange: (item: WorkItem, startDate: string, endDate: string) => void;
  selectedDate: string;
}) {
  return (
    <aside className="panel side-panel no-print">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Dienas darbi</p>
          <h2>{dateLabel(selectedDate)}</h2>
        </div>
        {countMainWork(items, selectedDate) > 1 ? <span className="overload-badge">Pārslodze</span> : null}
      </div>
      <div className="work-list">
        {items.length === 0 ? <p className="empty-state">Šajā dienā nav ieplānotu darbu.</p> : null}
        {items.map((item) => (
          <WorkItemCard errors={errors} item={item} key={item.id} onMove={onMove} onMoveRange={onMoveRange} />
        ))}
      </div>
    </aside>
  );
}

function BalancePreview({
  onApply,
  onCancel,
  proposals,
}: {
  onApply: () => void;
  onCancel: () => void;
  proposals: WorkloadBalanceProposal[];
}) {
  return (
    <section className="balance-preview">
      <div>
        <strong>Darbu izlīdzināšanas priekšskatījums</strong>
        <p>
          {proposals.length === 0
            ? "Nav atrasts labāks sadalījums, ko piedāvāt."
            : "Izmaiņas tiks saglabātas tikai pēc apstiprināšanas."}
        </p>
      </div>
      {proposals.length > 0 ? (
        <ul>
          {proposals.map((proposal) => (
            <li key={`${proposal.planRowId}-${proposal.type}`}>
              {proposal.title} {proposal.sectorName}: {formatDateRange(proposal.fromDates)} →{" "}
              {formatDateRange(proposal.toDates)}
              {proposal.warning ? <strong> {proposal.warning}</strong> : null}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="button-row">
        <button className="primary-action" disabled={proposals.length === 0} type="button" onClick={onApply}>
          Apstiprināt
        </button>
        <button className="secondary-action" type="button" onClick={onCancel}>
          Atcelt
        </button>
      </div>
    </section>
  );
}

function GreenhousePanel({
  date,
  onDateChange,
  rows,
}: {
  date: string;
  onDateChange: (date: string) => void;
  rows: SowingPlanRow[];
}) {
  const snapshot = buildGreenhouseSnapshot(rows, date);

  return (
    <section className="panel greenhouse-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Fiziskā kapacitāte</p>
          <h2>Stādu māja</h2>
        </div>
        <label className="inline-date greenhouse-date">
          Datums
          <input type="date" value={date} onChange={(event) => onDateChange(event.target.value)} />
        </label>
      </div>

      <div className="greenhouse-stats">
        <strong>Standarta kapacitāte: {snapshot.standardUsed}/78 galdi aizņemti</strong>
        <strong>Papildu: {snapshot.extraUsed}/13</strong>
      </div>

      <div className="greenhouse-grid">
        {snapshot.rows.map((row) => (
          <article className="greenhouse-row" key={row.rowId}>
            <div>
              <strong>{row.label}</strong>
              <span>{row.usedTables}/{row.capacity} galdi</span>
            </div>
            {row.assignment ? (
              <p>
                {row.assignment.sectorName} — līdz {dateLabel(row.assignment.harvestDate)} —
                {" "}
                {row.assignment.averagePlantsPerGutter.toFixed(1)} stādi/renē
              </p>
            ) : (
              <p>Brīva</p>
            )}
          </article>
        ))}
      </div>

      {snapshot.conflicts.map((conflict) => (
        <div className="capacity-warning" key={`${conflict.date}-${conflict.totalTables}`}>
          <strong>⚠️ Šajā periodā vienlaikus stādu mājā būs {conflict.overlapping.length} Hus cikli.</strong>
          <span>Kopā nepieciešami {conflict.totalTables} galdi; standarta kapacitāte 78, kopā ar papildu rindu 91.</span>
          <span>{conflict.extraCanCover ? "13 papildu galdi var nosegt pārklāšanos." : `Deficīts: ${conflict.deficit} galdi.`}</span>
          <ul>
            {conflict.overlapping.map((item) => (
              <li key={item.planRowId}>{item.sectorName}: {item.tables} galdi</li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function WorkItemCard({
  errors,
  item,
  onMove,
  onMoveRange,
}: {
  errors: Record<string, string>;
  item: WorkItem;
  onMove: (item: WorkItem, date: string) => void;
  onMoveRange: (item: WorkItem, startDate: string, endDate: string) => void;
}) {
  const workDates = item.scheduleKind === "flexible" ? flexibleItemDates(item) : [item.date];
  const rangeStart = workDates[0] ?? item.date;
  const rangeEnd = workDates.at(-1) ?? item.date;

  return (
    <article className={`work-card work-card--${item.color}`}>
      <div>
        <strong>{item.title}</strong>
        <span>
          {item.sectorName} · {item.plantCount.toLocaleString("lv-LV")} stādi · {item.cycleDay}. diena
        </span>
      </div>
      <ul>
        {item.details.map((detail) => (
          <li key={detail}>{detail}</li>
        ))}
      </ul>
      {item.fixed ? (
        <small>Fiksēts datums</small>
      ) : item.scheduleKind === "flexible" ? (
        <div className="range-fields">
          <label className="inline-date">
            No
            <input
              max={item.allowedDateRange?.end}
              min={item.allowedDateRange?.start}
              onChange={(event) => onMoveRange(item, event.target.value, rangeEnd)}
              type="date"
              value={rangeStart}
            />
          </label>
          <label className="inline-date">
            Līdz
            <input
              max={item.allowedDateRange?.end}
              min={item.allowedDateRange?.start}
              onChange={(event) => onMoveRange(item, rangeStart, event.target.value)}
              type="date"
              value={rangeEnd}
            />
          </label>
        </div>
      ) : (
        <label className="inline-date">
          Pārcelt
          <input
            max={item.allowedDateRange?.end}
            min={item.allowedDateRange?.start}
            onChange={(event) => onMove(item, event.target.value)}
            type="date"
            value={item.date}
          />
        </label>
      )}
      {item.capacityWarning ? <p className="capacity-note">{item.capacityWarning}</p> : null}
      {errors[item.id] ? <p className="form-error">{errors[item.id]}</p> : null}
    </article>
  );
}

function flexibleItemDates(item: WorkItem): string[] {
  return [item.date];
}

function HusList({ onOpen, rows }: { onOpen: (id: string) => void; rows: SowingPlanRow[] }) {
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
      cycles: group.slice().sort((a, b) => b.sowingDate.localeCompare(a.sowingDate)),
    }))
    .sort((a, b) => a.sectorName.localeCompare(b.sectorName, "lv", { numeric: true }));

  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Hus</p>
          <h2>Darba lapas</h2>
        </div>
      </div>
      <div className="batch-list">
        {rows.length === 0 ? <p className="empty-state">Hus ierakstu vēl nav.</p> : null}
        {groupedRows.map(({ cycles, sectorName }) => {
          const row = cycles[0];
          const totalSow = getTotalSow(row);

          return (
            <article className="hus-card" key={sectorName}>
              <button className="batch-row" onClick={() => onOpen(row.id)} type="button">
                <span>
                  <strong>{sectorName}</strong>
                  <small>
                    {row.variety} · {dateLabel(row.sowingDate)} - {dateLabel(row.harvestDate)}
                  </small>
                </span>
                <span>{totalSow.toLocaleString("lv-LV")} stādi</span>
                <span>{row.cycleLength} dienas</span>
                <span>Atvērt darba lapu</span>
              </button>
              {cycles.length > 1 ? (
                <div className="previous-cycles">
                  {cycles.slice(1).map((cycle) => (
                    <button key={cycle.id} type="button" onClick={() => onOpen(cycle.id)}>
                      {shortDate(cycle.sowingDate)} - {shortDate(cycle.harvestDate)}
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

function BatchEditor({
  onUpdateCycleLength,
  onUpdateDate,
  onUpdatePlacement,
  onUpdateRow,
  row,
  rows,
}: {
  onUpdateCycleLength: (row: SowingPlanRow, cycleLength: number) => void;
  onUpdateDate: (row: SowingPlanRow, field: "sowingDate" | "harvestDate", value: string) => void;
  onUpdatePlacement: (row: SowingPlanRow, patch: NonNullable<SowingPlanRow["placement"]>) => void;
  onUpdateRow: (id: string, patch: Partial<SowingPlanRow>) => void;
  row: SowingPlanRow;
  rows: SowingPlanRow[];
}) {
  const totalSow = getTotalSow(row);
  const availability = calculateAvailability(row);
  const placement = createPlacementPlan(row, rows);
  const boxPlan = calculateBoxPlan(row);

  return (
    <section className="panel form-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Hus dati</p>
          <h2>{row.sectorName}</h2>
        </div>
      </div>
      <label>
        Sektors
        <input value={row.sectorName} onChange={(event) => onUpdateRow(row.id, { sectorName: event.target.value })} />
      </label>
      <label>
        Šķirne
        <input value={row.variety} onChange={(event) => onUpdateRow(row.id, { variety: event.target.value })} />
      </label>
      <label>
        Nedēļas numurs
        <input
          min="1"
          type="number"
          value={row.weekNumber ?? getIsoWeek(row.sowingDate)}
          onChange={(event) => onUpdateRow(row.id, { weekNumber: Number(event.target.value) })}
        />
      </label>
      <label>
        Statuss
        <select
          value={row.status ?? "planned"}
          onChange={(event) => onUpdateRow(row.id, { status: event.target.value as SowingPlanRow["status"] })}
        >
          <option value="planned">Plānots</option>
          <option value="imported">Importēts</option>
          <option value="active">Aktīvs</option>
          <option value="done">Pabeigts</option>
        </select>
      </label>
      <label>
        Agronoma sējamais skaits
        <input
          min="1"
          type="number"
          value={row.requiredPlants}
          onChange={(event) => onUpdateRow(row.id, { requiredPlants: Number(event.target.value) })}
        />
      </label>
      <label>
        Darbinieka extra
        <input
          type="number"
          value={row.extraPlants}
          onChange={(event) => onUpdateRow(row.id, { extraPlants: Number(event.target.value) })}
        />
      </label>
      <div className="metric-inline">
        <span>Kopā sēt</span>
        <strong>{totalSow.toLocaleString("lv-LV")}</strong>
      </div>
      <label>
        Sēšanas datums
        <input type="date" value={row.sowingDate} onChange={(event) => onUpdateDate(row, "sowingDate", event.target.value)} />
      </label>
      <label>
        Izvākšanas datums
        <input type="date" value={row.harvestDate} onChange={(event) => onUpdateDate(row, "harvestDate", event.target.value)} />
      </label>
      <label>
        Previcure datums
        <input
          type="date"
          value={row.previcureDate ?? ""}
          onChange={(event) => onUpdateRow(row.id, { previcureDate: event.target.value || undefined })}
        />
      </label>
      <label>
        Cikla garums
        <input
          min="1"
          type="number"
          value={row.cycleLength}
          onChange={(event) => onUpdateCycleLength(row, Number(event.target.value))}
        />
      </label>
      <label>
        Sektora galdi
        <select
          value={row.sectorType}
          onChange={(event) => onUpdateRow(row.id, { sectorType: Number(event.target.value) as SectorType })}
        >
          <option value={26}>26 galdi</option>
          <option value={39}>39 galdi</option>
        </select>
      </label>
      <label>
        Zudumi / korekcija
        <input
          type="number"
          value={row.correction}
          onChange={(event) => onUpdateRow(row.id, { correction: Number(event.target.value) })}
        />
      </label>
      <div className={`availability availability--${availability.tone}`}>
        <span>Faktiski pieejams: {availability.availablePlants.toLocaleString("lv-LV")}</span>
        <strong>{availability.label}</strong>
      </div>
      <section className="placement-box">
        <div>
          <p className="eyebrow">Izvietojums pēc retināšanas</p>
          <strong>{placement.label}</strong>
        </div>
        <span>Kopā stādi: {totalSow.toLocaleString("lv-LV")}</span>
        <span>Retināšana: {dateLabel(placement.thinningDate)}</span>
        <span>Renes: {placement.gutters}</span>
        <span>Vidēji: {placement.averagePlantsPerGutter.toFixed(2)} stādi/renē</span>
        <span>Kastītes: {boxPlan.label}</span>
        <label>
          Rinda
          <select
            value={placement.primaryRow ?? ""}
            onChange={(event) =>
              onUpdatePlacement(row, { primaryRow: event.target.value as NonNullable<SowingPlanRow["placement"]>["primaryRow"] })
            }
          >
            <option value="">Automātiski</option>
            {greenhouseRows.map((greenhouseRow) => (
              <option key={greenhouseRow.id} value={greenhouseRow.id}>{greenhouseRow.id}</option>
            ))}
          </select>
        </label>
        <label>
          Izmantoti galdi
          <input
            min="1"
            max="39"
            type="number"
            value={placement.tables}
            onChange={(event) => onUpdatePlacement(row, { tables: Number(event.target.value) })}
          />
        </label>
        {placement.warning ? <p className="capacity-note">{placement.warning}</p> : null}
      </section>
      <section className="history-box">
        <div>
          <p className="eyebrow">Izmaiņu vēsture</p>
          <strong>{row.changeHistory?.length ?? 0} ieraksti</strong>
        </div>
        {row.changeHistory && row.changeHistory.length > 0 ? (
          <ul>
            {row.changeHistory.slice().reverse().map((entry) => (
              <li key={entry.id}>
                <time>{historyDateLabel(entry.timestamp)}</time>
                <span>
                  {entry.note} — {entry.field}: {entry.from || "—"} → {entry.to || "—"}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p>Šim Hus vēl nav reģistrētu labojumu.</p>
        )}
      </section>
    </section>
  );
}

function BatchTimeline({
  errors,
  items,
  onOpenWorksheet,
  onMove,
  onMoveRange,
  row,
}: {
  errors: Record<string, string>;
  items: WorkItem[];
  onOpenWorksheet: () => void;
  onMove: (item: WorkItem, date: string) => void;
  onMoveRange: (item: WorkItem, startDate: string, endDate: string) => void;
  row: SowingPlanRow;
}) {
  const totalSow = getTotalSow(row);
  const sowing = calculateSowingPlan(totalSow);
  const thinning = calculateThinningPlan(totalSow, row.sectorType);
  const availability = calculateAvailability(row);

  return (
    <section className="panel timeline-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Pilns darba cikls</p>
          <h2>Laika līnija</h2>
        </div>
        <div className="button-row no-print">
          <button className="secondary-action" type="button" onClick={onOpenWorksheet}>
            Atvērt darba lapu
          </button>
        </div>
      </div>
      <div className="summary-strip">
        <span>{sowing.label}</span>
        <span>{thinning.label}</span>
        <span>{row.cycleLength} dienu cikls</span>
        <span>{availability.label}</span>
      </div>
      <div className="timeline">
        {items.map((item) => (
          <div className="timeline-item" key={item.id}>
            <time>{dateLabel(item.date)}</time>
            <WorkItemCard errors={errors} item={item} onMove={onMove} onMoveRange={onMoveRange} />
          </div>
        ))}
      </div>
    </section>
  );
}

function markImportDuplicates(candidates: PlanImportCandidate[], rows: SowingPlanRow[]): PlanImportCandidate[] {
  return candidates.map((candidate) => {
    const duplicate = rows.find(
      (row) =>
        row.sectorName.trim().toLowerCase() === candidate.fields.sectorName.value.trim().toLowerCase() &&
        row.sowingDate === candidate.fields.sowingDate.value,
    );

    return {
      ...candidate,
      duplicateOf: duplicate?.id,
      duplicateAction: duplicate ? (candidate.duplicateOf === duplicate.id ? candidate.duplicateAction ?? "keepExisting" : "keepExisting") : "createNew",
    };
  });
}

function applyImportCandidates(rows: SowingPlanRow[], candidates: PlanImportCandidate[]): SowingPlanRow[] {
  return candidates.reduce((current, candidate) => {
    if (candidate.duplicateOf && candidate.duplicateAction === "keepExisting") {
      return current;
    }

    const importedRow = rowFromImportCandidate(candidate);

    if (candidate.duplicateOf && candidate.duplicateAction === "replace") {
      return current.map((row) =>
        row.id === candidate.duplicateOf
          ? {
              ...row,
              ...importedRow,
              id: row.id,
              changeHistory: [
                ...(row.changeHistory ?? []),
                historyEntry("Imports", row.sectorName, importedRow.sectorName, "Aizvietots no pārbaudīta foto importa"),
              ],
            }
          : row,
      );
    }

    return [importedRow, ...current];
  }, rows);
}

function rowFromImportCandidate(candidate: PlanImportCandidate): SowingPlanRow {
  const cycleLength = Math.max(1, candidateCycleLength(candidate));

  return {
    id: crypto.randomUUID(),
    sectorName: candidate.fields.sectorName.value.trim(),
    requiredPlants: Number(candidate.fields.requiredPlants.value),
    extraPlants: 0,
    variety: candidate.fields.variety.value.trim() || "Nav norādīta",
    weekNumber: Number(candidate.fields.weekNumber.value) || getIsoWeek(candidate.fields.sowingDate.value),
    sowingDate: candidate.fields.sowingDate.value,
    harvestDate: candidate.fields.harvestDate.value,
    cycleLength,
    sectorType: Number(candidate.fields.requiredPlants.value) > 26 * 6 * 28 ? 39 : 26,
    plantsPerBox: plannerConfig.defaultPlantsPerBox,
    correction: 0,
    status: "imported",
    changeHistory: [historyEntry("Rinda importēta", "", candidate.fields.sectorName.value, "Pārbaudīts foto importa rezultāts")],
    source: "import",
  };
}

function appendChangeHistory(
  previous: SowingPlanRow,
  next: SowingPlanRow,
  patch: Partial<SowingPlanRow>,
  resetSchedule?: boolean,
): ChangeHistoryEntry[] {
  const history = [...(previous.changeHistory ?? [])];
  const tracked: Array<[keyof SowingPlanRow, string]> = [
    ["sectorName", "Hus"],
    ["requiredPlants", "Nepieciešams"],
    ["extraPlants", "Extra"],
    ["variety", "Šķirne"],
    ["weekNumber", "Nedēļa"],
    ["sowingDate", "Sēšana"],
    ["harvestDate", "Izvākšana"],
    ["previcureDate", "Previcure"],
    ["cycleLength", "Cikls"],
    ["status", "Statuss"],
    ["correction", "Zudumi / korekcija"],
  ];

  tracked.forEach(([field, label]) => {
    if (field in patch && String(previous[field] ?? "") !== String(next[field] ?? "")) {
      history.push(historyEntry(label, String(previous[field] ?? ""), String(next[field] ?? ""), next.sectorName));
    }
  });

  if (patch.adjustments?.thinning && previous.adjustments?.thinning !== patch.adjustments.thinning) {
    history.push(
      historyEntry(
        "Retināšana",
        formatAdjustmentValue(previous.adjustments?.thinning) || "9. diena",
        formatAdjustmentValue(patch.adjustments.thinning),
        next.sectorName,
      ),
    );
  }

  if (resetSchedule && hasManualWorkMoves(previous)) {
    history.push(historyEntry("Darbu grafiks", "Manuāli pārcelts", "Pārrēķināts", next.sectorName));
  }

  return history;
}

function historyEntry(field: string, from: string, to: string, note: string): ChangeHistoryEntry {
  return {
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    field,
    from,
    to,
    note,
  };
}

function getIsoWeek(date: string): number {
  const value = new Date(`${date}T12:00:00`);
  const day = value.getDay() || 7;
  value.setDate(value.getDate() + 4 - day);
  const yearStart = new Date(value.getFullYear(), 0, 1, 12);
  return Math.ceil(((value.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

function sanitizeAdjustments(row: SowingPlanRow): SowingPlanRow["adjustments"] {
  const entries = Object.entries(row.adjustments ?? {}).filter(([key, value]) =>
    adjustmentValueToDates(value).every((date) =>
      isAllowedMove(row, key === "sideShoots" ? "sideShoots" : key === "thinning" ? "thinning" : "sticks", date),
    ),
  );
  return Object.fromEntries(entries) as SowingPlanRow["adjustments"];
}

function rowsDiffer(previous: SowingPlanRow, next: SowingPlanRow): boolean {
  return JSON.stringify(rowComparable(previous)) !== JSON.stringify(rowComparable(next));
}

function rowComparable(row: SowingPlanRow): Omit<SowingPlanRow, "updatedAt"> {
  const comparable = { ...row };
  delete comparable.updatedAt;
  return comparable;
}

function adjustmentValueToDates(value: string | string[] | undefined): string[] {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

function formatAdjustmentValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? formatDateRange(value) : value ?? "";
}

function getCalendarDays(anchorDate: string, viewMode: ViewMode) {
  if (viewMode === "month") {
    const anchor = new Date(`${anchorDate}T12:00:00`);
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1, 12);
    const startOffset = (first.getDay() + 6) % 7;
    const start = toIsoDate(addDate(first, -startOffset));
    return Array.from({ length: 42 }, (_, index) => {
      const isoDate = addDays(start, index);
      const value = new Date(`${isoDate}T12:00:00`);
      return {
        isoDate,
        dayNumber: value.getDate(),
        inCurrentRange: value.getMonth() === anchor.getMonth(),
      };
    });
  }

  const length = viewMode === "today" ? 1 : 10;
  return Array.from({ length }, (_, index) => {
    const isoDate = addDays(anchorDate, index);
    return {
      isoDate,
      dayNumber: new Date(`${isoDate}T12:00:00`).getDate(),
      inCurrentRange: true,
    };
  });
}

function addDate(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function shiftAnchor(anchorDate: string, viewMode: ViewMode, direction: -1 | 1): string {
  if (viewMode === "month") {
    const value = new Date(`${anchorDate}T12:00:00`);
    value.setMonth(value.getMonth() + direction);
    return toIsoDate(value);
  }

  const days = viewMode === "today" ? 1 : 10;
  return addDays(anchorDate, days * direction);
}

function calendarTitle(anchorDate: string, viewMode: ViewMode): string {
  const days = getCalendarDays(anchorDate, viewMode).filter((day) => day.inCurrentRange);
  if (viewMode === "month") {
    return new Intl.DateTimeFormat("lv-LV", { month: "long", year: "numeric" }).format(
      new Date(`${anchorDate}T12:00:00`),
    );
  }

  const first = days[0]?.isoDate ?? anchorDate;
  const last = days.at(-1)?.isoDate ?? anchorDate;
  return first === last ? dateLabel(first) : `${dateLabel(first)} - ${dateLabel(last)}`;
}

function monthlyWorkItems(workItems: WorkItem[], monthDate: string): WorkItem[] {
  const anchor = new Date(`${monthDate}T12:00:00`);
  const month = anchor.getMonth();
  const year = anchor.getFullYear();

  return workItems
    .filter((item) => {
      const date = new Date(`${item.date}T12:00:00`);
      return date.getFullYear() === year && date.getMonth() === month;
    })
    .sort((a, b) => a.date.localeCompare(b.date) || a.sectorName.localeCompare(b.sectorName, "lv"));
}

function shortDate(date: string): string {
  return new Intl.DateTimeFormat("lv-LV", {
    day: "2-digit",
    month: "2-digit",
  }).format(new Date(`${date}T12:00:00`));
}

function monthInputValue(date: string): string {
  return date.slice(0, 7);
}

function monthTitle(date: string): string {
  return new Intl.DateTimeFormat("lv-LV", {
    month: "long",
    year: "numeric",
  }).format(new Date(`${date}T12:00:00`)).toUpperCase();
}

function formatDateRange(dates: string[]): string {
  if (dates.length === 0) {
    return "";
  }

  if (dates.length === 1) {
    return shortDate(dates[0]);
  }

  return `${shortDate(dates[0])}-${shortDate(dates[dates.length - 1])}`;
}

function historyDateLabel(timestamp: string): string {
  return new Intl.DateTimeFormat("lv-LV", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function compactNumber(value: number): string {
  if (value >= 1000) {
    return `${Math.round(value / 1000)}k`;
  }
  return String(value);
}

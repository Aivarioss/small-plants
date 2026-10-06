"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { plannerConfig } from "@/lib/demo-data";
import {
  addDays,
  applyHusEventDelete,
  applyHusEventSave,
  balanceWorkload,
  buildGreenhouseSnapshot,
  calculateBoxPlan,
  calculateAvailability,
  calculatePlantBalance,
  continuousWorkPlanPrintRows,
  countMainWork,
  calculateSowingPlan,
  calculateThinningPlan,
  calculateWorkMaterialSummary,
  createPlacementPlan,
  dateLabel,
  eachDate,
  formatSowingTableSelection,
  generateWorksheetDaysFromWorkItems,
  generateWorkItemsForRows,
  getTotalSow,
  getCycleDay,
  groupMonthlyPrintRowsIntoDateGroups,
  greenhouseRows,
  hasManualWorkMoves,
  husEventTypeLabel,
  husEventTypes,
  isAllowedMove,
  parseSowingTableSelection,
  removePlantCorrection,
  sowingTableIds,
  signedPlantCorrectionAmount,
  toggleSowingTableSelection,
  toIsoDate,
  upsertPlantCorrection,
} from "@/lib/planning";
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
import {
  importCandidateToSowingPlanRow,
  importCandidateValidationErrors,
} from "@/lib/production-plan-import";
import { SowingPlanApiConflictError } from "@/lib/repositories/api-sowing-plan-repository";
import { sowingPlanRepository } from "@/lib/repositories/sowing-plan-repository";
import type {
  ChangeHistoryEntry,
  HusEventEntry,
  HusEventType,
  ImportFieldKey,
  MainView,
  PlantCorrectionEntry,
  PlantCorrectionReason,
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
];

const weekdayLabels = ["P", "O", "T", "C", "P", "S", "Sv"];

const initialDraft: SowingPlanDraft = {
  sectorName: "",
  greenhouseRequiredPlants: "",
  requiredPlants: "3400",
  extraPlants: "144",
  variety: "",
  sowingTables: "",
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
  const [repositoryError, setRepositoryError] = useState("");
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
  const [importPreviewUrl, setImportPreviewUrl] = useState("");
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
        setRepositoryError("");
      } catch (error) {
        if (!cancelled) {
          const message = error instanceof Error ? error.message : "Neizdevās ielādēt Supabase plānu";
          setRepositoryMessage(message);
          setRepositoryError(message);
        }
      }
    }

    void loadRows();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (importPreviewUrl) {
        URL.revokeObjectURL(importPreviewUrl);
      }
    };
  }, [importPreviewUrl]);

  async function reloadRows(message = "Supabase pārlādēts") {
    const loadedRows = await sowingPlanRepository.load();
    setPlanRows(loadedRows);
    setSelectedRowId((current) => (loadedRows.some((row) => row.id === current) ? current : loadedRows[0]?.id ?? ""));
    setRepositoryMessage(message);
  }

  async function addPlanRow(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const requiredPlants = Number(draft.requiredPlants);
    const greenhouseRequiredPlants = Number(draft.greenhouseRequiredPlants);
    const extraPlants = Number(draft.extraPlants);
    const cycleLength = Number(draft.cycleLength) || deriveCycleLength(draft.sowingDate, draft.harvestDate);

    if (!draft.sectorName.trim() || !draft.variety.trim() || requiredPlants <= 0) {
      return;
    }

    const row: SowingPlanRow = {
      id: crypto.randomUUID(),
      sectorName: draft.sectorName.trim(),
      greenhouseRequiredPlants: greenhouseRequiredPlants > 0 ? greenhouseRequiredPlants : undefined,
      requiredPlants,
      extraPlants,
      variety: draft.variety.trim(),
      sowingTables: draft.sowingTables.trim() || undefined,
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
    setRepositoryError("");
    try {
      const savedRow = await sowingPlanRepository.create(row);
      setPlanRows((current) => [savedRow, ...current]);
      setSelectedRowId(savedRow.id);
      setSelectedDate(savedRow.sowingDate);
      setAnchorDate(savedRow.sowingDate);
      setDraft(initialDraft);
      setActiveView("worksheet");
      setRepositoryMessage("Supabase saglabāts");
      setRepositoryError("");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Neizdevās izveidot Hus Supabase";
      setRepositoryMessage(message);
      setRepositoryError(message);
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
    setRepositoryError("");
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
        setRepositoryError("");
        return savedRow;
      })
      .catch(async (error) => {
        rowSaveChainsRef.current.delete(previous.id);
        const message = error instanceof Error ? error.message : "Neizdevās saglabāt Hus Supabase";
        if (error instanceof SowingPlanApiConflictError) {
          setRepositoryMessage("Šis Hus ir mainīts citur. Dati pārlādēti; pārbaudi jaunāko versiju pirms atkārtotas izmaiņas.");
          setRepositoryError("Šis Hus ir mainīts citur. Dati pārlādēti; pārbaudi jaunāko versiju pirms atkārtotas izmaiņas.");
          await reloadRows("Šis Hus ir mainīts citur. Pārbaudi jaunāko versiju.");
          return previous;
        }

        setRepositoryMessage(message);
        setRepositoryError(message);
        await reloadRows(message).catch(() => {
          setPlanRows((current) => current.map((row) => (row.id === previous.id ? previous : row)));
        });
        return previous;
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
    setImportResult(null);

    if (importPreviewUrl) {
      URL.revokeObjectURL(importPreviewUrl);
    }
    setImportPreviewUrl(URL.createObjectURL(file));

    try {
      const formData = new FormData();
      formData.append("image", file);

      const response = await fetch("/api/production-plan/extract", {
        body: formData,
        method: "POST",
      });
      const result = (await response.json().catch(() => null)) as (Partial<PlanImportResult> & { error?: string }) | null;

      if (!result) {
        setImportMessage("Neizdevās nolasīt plānu no foto.");
        return;
      }

      if (!Array.isArray(result.candidates)) {
        setImportMessage(result.error ?? "Neizdevās nolasīt plānu no foto.");
        return;
      }

      const importResult = result as PlanImportResult;
      setImportResult({
        ...importResult,
        candidates: markImportDuplicates(importResult.candidates, planRows),
      });
      setImportMessage(
        importResult.providerConfigured
          ? "Plāns nolasīts. Pārbaudi katru rindu pirms importa apstiprināšanas nākamajā posmā."
          : importResult.message ?? "Foto atpazīšanas providers vēl nav konfigurēts.",
      );
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

        const numericFields: ImportFieldKey[] = ["greenhouseRequiredPlants", "extraPlants", "requiredPlants", "weekNumber"];
        const nextValue = numericFields.includes(field) ? (value === "" ? null : Number(value)) : value;
        const fields = {
          ...candidate.fields,
          [field]: {
            value: nextValue,
            confidence: 1,
            needsReview: false,
          },
        } as PlanImportCandidate["fields"];
        const cycleLength =
          fields.sowingDate.value && fields.harvestDate.value
            ? deriveCycleLength(fields.sowingDate.value, fields.harvestDate.value)
            : null;
        const operationalTotal = Number(fields.requiredPlants.value || 0) + Number(fields.extraPlants.value || 0);

        return {
          ...candidate,
          fields,
          cycleLength,
          operationalTotal,
        } as PlanImportCandidate;
      });

      return {
        ...current,
        candidates: markImportDuplicates(candidates, planRows),
      };
    });
  }

  function updateImportCandidateSelection(id: string, selected: boolean) {
    setImportResult((current) =>
      current
        ? {
            ...current,
            candidates: current.candidates.map((candidate) =>
              candidate.id === id ? { ...candidate, selected } : candidate,
            ),
          }
        : current,
    );
  }

  function updateImportCandidateDuplicateAction(id: string, duplicateAction: NonNullable<PlanImportCandidate["duplicateAction"]>) {
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

  async function confirmProductionPlanImport() {
    if (!importResult) {
      return;
    }

    const selectedCandidates = importResult.candidates.filter((candidate) => candidate.selected);
    const importableCandidates = selectedCandidates.filter(
      (candidate) => !candidate.duplicateOf || candidate.duplicateAction === "replace",
    );
    const validationErrors = importableCandidates.flatMap((candidate) =>
      importCandidateValidationErrors(candidate).map((error) => `${candidate.fields.sectorName.value || candidate.id}: ${error}`),
    );

    if (validationErrors.length > 0) {
      setImportMessage(`Importu nevar apstiprināt: ${validationErrors.join(" ")}`);
      return;
    }

    if (importableCandidates.length === 0) {
      setImportMessage("Nav izvēlētas jaunas vai atjaunojamas rindas.");
      return;
    }

    setRepositoryMessage("Importē Supabase");
    setImportBusy(true);

    try {
      for (const candidate of importableCandidates) {
        const existingRow = candidate.duplicateOf ? planRows.find((row) => row.id === candidate.duplicateOf) : undefined;
        const row = importCandidateToSowingPlanRow(candidate, {
          existingRow,
          id: crypto.randomUUID(),
          now: new Date().toISOString(),
          plantsPerBox: plannerConfig.defaultPlantsPerBox,
        });

        if (existingRow) {
          await sowingPlanRepository.update(row);
        } else {
          await sowingPlanRepository.create(row);
        }
      }

      const skippedDuplicates = selectedCandidates.length - importableCandidates.length;
      await reloadRows(
        skippedDuplicates > 0
          ? `Imports pabeigts: ${importableCandidates.length} rindas, ${skippedDuplicates} dublikāti izlaisti`
          : `Imports pabeigts: ${importableCandidates.length} rindas`,
      );
      setImportResult(null);
      setImportMessage("Foto imports saglabāts Supabase.");
      setActiveView("sowingPlan");
    } catch (error) {
      if (error instanceof SowingPlanApiConflictError) {
        await reloadRows("Kāds Hus tika mainīts citur. Pārbaudi jaunāko versiju un mēģini importu vēlreiz.");
      }
      setImportMessage(error instanceof Error ? error.message : "Neizdevās saglabāt foto importu Supabase.");
      setRepositoryMessage(error instanceof Error ? error.message : "Neizdevās saglabāt foto importu Supabase");
    } finally {
      setImportBusy(false);
    }
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
        if (proposal.toDates.length === 0) {
          return;
        }

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

  function recalculateAutomaticPlan() {
    const rowsWithAdjustments = planRows.filter((row) => hasManualWorkMoves(row));

    if (rowsWithAdjustments.length === 0) {
      setRepositoryMessage("Plāns jau tiek rēķināts automātiski");
      return;
    }

    const confirmed = window.confirm(
      `Pārrēķināt darbu plānu no ${planRows.length} esošajām Hus rindām ar jauno scheduler algoritmu?\n\n` +
        "Tas nedzēsīs Hus/sēšanas datus. Tiks notīrīti saglabātie darba datumu pārcēlumi, lai kalendārs atkal tiktu ģenerēts automātiski.",
    );

    if (!confirmed) {
      return;
    }

    const nextRows = planRows.map((row) => {
      if (!hasManualWorkMoves(row)) {
        return row;
      }

      return {
        ...row,
        adjustments: undefined,
        changeHistory: [
          ...(row.changeHistory ?? []),
          historyEntry(
            "Darbu plāns pārrēķināts",
            formatAdjustmentSummary(row.adjustments),
            "Automātisks scheduler",
            "Notīrīti saglabātie darba datumu pārcēlumi",
          ),
        ],
      };
    });

    setBalancePreview(null);
    setPlanRows(nextRows);
    void persistRowDiff(planRows, nextRows);
    setRepositoryMessage(`Pārrēķina ${rowsWithAdjustments.length} Hus darbu datumus`);
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

      {repositoryError ? (
        <section className="repository-error no-print" role="alert">
          <div>
            <strong>Neizdevās saglabāt Supabase</strong>
            <code>{repositoryError}</code>
          </div>
          <div className="button-row">
            <button
              className="secondary-action secondary-action--small"
              type="button"
              onClick={() => void navigator.clipboard?.writeText(repositoryError)}
            >
              Kopēt kļūdu
            </button>
            <button className="secondary-action secondary-action--small" type="button" onClick={() => setRepositoryError("")}>
              Aizvērt
            </button>
          </div>
        </section>
      ) : null}

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
            onDraftChange={setDraft}
            onImportCandidateChange={updateImportCandidate}
            onImportConfirm={confirmProductionPlanImport}
            onImportDuplicateActionChange={updateImportCandidateDuplicateAction}
            onImportFile={importPlanFromFile}
            onImportSelectionChange={updateImportCandidateSelection}
            onOpenRow={(id) => {
              setSelectedRowId(id);
              setActiveView("worksheet");
            }}
            onUpdateDate={updateDateField}
            onUpdateRow={updatePlanRow}
            importBusy={importBusy}
            importMessage={importMessage}
            importPreviewUrl={importPreviewUrl}
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
              onRecalculatePlan={recalculateAutomaticPlan}
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
          <div className="calendar-print-source">
            <MonthlyPrintPlan
              onStartChange={setAnchorDate}
              startDate={printPlanStartDate(anchorDate, viewMode)}
              workItems={workItems}
            />
          </div>
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
          onUpdateRow={updatePlanRow}
          row={selectedRow}
          workItems={workItems.filter((item) => item.planRowId === selectedRow.id)}
        />
      ) : null}

      {activeView === "monthPlan" ? (
        <MonthlyPrintPlan
          onStartChange={setAnchorDate}
          startDate={printPlanStartDate(anchorDate, viewMode)}
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
    </main>
  );
}

function SowingPlanPanel({
  draft,
  hasDemoRows,
  importBusy,
  importMessage,
  importPreviewUrl,
  importResult,
  onAdd,
  onDelete,
  onDeleteDemo,
  onDraftChange,
  onImportCandidateChange,
  onImportConfirm,
  onImportDuplicateActionChange,
  onImportFile,
  onImportSelectionChange,
  onOpenRow,
  onUpdateDate,
  onUpdateRow,
  rows,
}: {
  draft: SowingPlanDraft;
  hasDemoRows: boolean;
  importBusy: boolean;
  importMessage: string;
  importPreviewUrl: string;
  importResult: PlanImportResult | null;
  onAdd: (event: FormEvent<HTMLFormElement>) => void;
  onDelete: (id: string) => void;
  onDeleteDemo: () => void;
  onDraftChange: (draft: SowingPlanDraft) => void;
  onImportCandidateChange: (id: string, field: ImportFieldKey, value: string) => void;
  onImportConfirm: () => void;
  onImportDuplicateActionChange: (id: string, duplicateAction: NonNullable<PlanImportCandidate["duplicateAction"]>) => void;
  onImportFile: (file: File) => void;
  onImportSelectionChange: (id: string, selected: boolean) => void;
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
            Nolasīt plānu
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

      {importPreviewUrl ? (
        <div className="import-preview">
          <div
            aria-label="Augšupielādētā plāna foto priekšskatījums"
            className="import-preview__image"
            role="img"
            style={{ backgroundImage: `url(${importPreviewUrl})` }}
          />
        </div>
      ) : null}
      {importBusy ? <p className="import-note">Nolasa plānu no foto...</p> : null}
      {importMessage ? <p className="import-note">{importMessage}</p> : null}
      {importResult ? (
        <ImportReviewPanel
          importResult={importResult}
          onChange={onImportCandidateChange}
          onConfirm={onImportConfirm}
          onDuplicateActionChange={onImportDuplicateActionChange}
          onSelectionChange={onImportSelectionChange}
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
            Siltumnīcai nepieciešams {draft.greenhouseRequiredPlants ? Number(draft.greenhouseRequiredPlants).toLocaleString("lv-LV") : "nav norādīts"} ·
            Agronoma sējamais {Number(draft.requiredPlants || 0).toLocaleString("lv-LV")} · Extra{" "}
            {Number(draft.extraPlants || 0).toLocaleString("lv-LV")} · Kopā sējams{" "}
            {operationalTotal(Number(draft.requiredPlants || 0), Number(draft.extraPlants || 0)).toLocaleString("lv-LV")}
          </span>
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
              Siltumnīcai nepieciešams
              <input
                min="1"
                onChange={(event) => onDraftChange({ ...draft, greenhouseRequiredPlants: event.target.value })}
                type="number"
                value={draft.greenhouseRequiredPlants}
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
            <SowingTablesPicker value={draft.sowingTables} onSave={(value) => onDraftChange({ ...draft, sowingTables: value })} />
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
          <span>Sēšanas galdi</span>
          <span>Nepieciešams</span>
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
              <SowingTablesPicker
                compact
                key={`${row.id}-${row.sowingTables ?? ""}`}
                value={row.sowingTables ?? ""}
                onSave={(value) => onUpdateRow(row.id, { sowingTables: value || undefined })}
              />
              <input
                min="1"
                type="number"
                value={row.greenhouseRequiredPlants ?? ""}
                onChange={(event) =>
                  onUpdateRow(row.id, {
                    greenhouseRequiredPlants: event.target.value ? Number(event.target.value) : undefined,
                  })
                }
              />
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
  onChange,
  onConfirm,
  onDuplicateActionChange,
  onSelectionChange,
}: {
  importResult: PlanImportResult;
  onChange: (id: string, field: ImportFieldKey, value: string) => void;
  onConfirm: () => void;
  onDuplicateActionChange: (id: string, duplicateAction: NonNullable<PlanImportCandidate["duplicateAction"]>) => void;
  onSelectionChange: (id: string, selected: boolean) => void;
}) {
  const selectedCount = importResult.candidates.filter((candidate) => candidate.selected).length;
  const importableCount = importResult.candidates.filter(
    (candidate) => candidate.selected && (!candidate.duplicateOf || candidate.duplicateAction === "replace"),
  ).length;

  return (
    <section className="import-review">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Foto imports</p>
          <h3>Pārbaudīt atpazīto plānu</h3>
        </div>
        <span className="mock-badge">
          {importResult.providerConfigured ? importResult.provider : "Providers nav konfigurēts"} · {importResult.fileName}
        </span>
      </div>
      <p className="import-note">
        Pārbaudi, vai OCR nav sajaucis “Siltumnīcai nepieciešams” un “Agronoma sējamais”. Saglabāšana notiek tikai pēc apstiprināšanas.
      </p>
      <div className="import-table" role="table" aria-label="Atpazītā plāna pārbaude">
        <div className="import-row import-row--head" role="row">
          <span>✓</span>
          <span>Hus</span>
          <span>Šķirne</span>
          <span>Siltumnīcai nepieciešams</span>
          <span>Agronoma sējamais</span>
          <span>+ Rezerve</span>
          <span>Kopā</span>
          <span>Sēšana</span>
          <span>Izvākšana</span>
          <span>Cikls</span>
          <span>Statuss</span>
          <span>Dublikāts</span>
        </div>
        {importResult.candidates.map((candidate) => (
          <div className="import-row" key={candidate.id} role="row">
            <label className="checkbox-cell">
              <input
                checked={candidate.selected}
                onChange={(event) => onSelectionChange(candidate.id, event.target.checked)}
                type="checkbox"
              />
            </label>
            <ReviewInput candidate={candidate} field="sectorName" onChange={onChange} />
            <ReviewInput candidate={candidate} field="variety" onChange={onChange} />
            <ReviewInput candidate={candidate} field="greenhouseRequiredPlants" onChange={onChange} type="number" />
            <ReviewInput candidate={candidate} field="requiredPlants" onChange={onChange} type="number" />
            <ReviewInput candidate={candidate} field="extraPlants" onChange={onChange} type="number" />
            <strong>{candidate.operationalTotal.toLocaleString("lv-LV")}</strong>
            <ReviewInput candidate={candidate} field="sowingDate" onChange={onChange} type="date" />
            <ReviewInput candidate={candidate} field="harvestDate" onChange={onChange} type="date" />
            <strong>{candidate.cycleLength ? `${candidate.cycleLength} dienas` : "⚠"}</strong>
            <div className="status-cell">
              {candidate.warnings.length > 0 || Object.values(candidate.fields).some((field) => field.needsReview) ? (
                <ul>
                  {[...candidate.warnings, ...fieldWarnings(candidate)].map((warning) => (
                    <li key={warning}>⚠ {warning}</li>
                  ))}
                </ul>
              ) : (
                <span>Gatavs pārbaudei</span>
              )}
              {candidate.duplicateOf ? <small>Iespējams dublikāts ar esošu Hus ciklu.</small> : null}
            </div>
            <div className="status-cell">
              {candidate.duplicateOf ? (
                <select
                  aria-label="Dublikāta darbība"
                  value={candidate.duplicateAction ?? "keepExisting"}
                  onChange={(event) =>
                    onDuplicateActionChange(candidate.id, event.target.value as NonNullable<PlanImportCandidate["duplicateAction"]>)
                  }
                >
                  <option value="keepExisting">Neimportēt dublikātu</option>
                  <option value="replace">Atjaunot esošo</option>
                </select>
              ) : (
                <span>Izveidot jaunu</span>
              )}
            </div>
          </div>
        ))}
      </div>
      {importResult.candidates.length === 0 ? <p className="empty-state">Nav nolasītu rindu pārbaudei.</p> : null}
      {importResult.candidates.length > 0 ? (
        <div className="import-actions">
          <span>
            Izvēlētas {selectedCount}; saglabās {importableCount}
          </span>
          <button className="primary-action" disabled={importableCount === 0} onClick={onConfirm} type="button">
            Apstiprināt importu
          </button>
        </div>
      ) : null}
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
  onUpdateRow,
  row,
  workItems,
}: {
  onEdit: () => void;
  onUpdateRow: (id: string, patch: Partial<SowingPlanRow>) => void;
  row: SowingPlanRow;
  workItems: WorkItem[];
}) {
  const [activeWorksheetTab, setActiveWorksheetTab] = useState<"works" | "worksheet">("works");
  const [correctionDialogOpen, setCorrectionDialogOpen] = useState(false);
  const [editingCorrection, setEditingCorrection] = useState<PlantCorrectionEntry | null>(null);
  const [eventDialogOpen, setEventDialogOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<HusEventEntry | null>(null);
  const totalSow = getTotalSow(row);
  const materials = calculateWorkMaterialSummary(row);
  const balance = calculatePlantBalance(row);
  const worksheetDays = generateWorksheetDaysFromWorkItems(row, workItems);
  const chronologicalWorkItems = [...workItems].sort(
    (left, right) => left.date.localeCompare(right.date) || left.title.localeCompare(right.title, "lv"),
  );

  function savePlantCorrection(entry: PlantCorrectionEntry) {
    onUpdateRow(row.id, {
      plantCorrections: upsertPlantCorrection(row.plantCorrections, entry),
    });
  }

  function deletePlantCorrection(entry: PlantCorrectionEntry) {
    if (!window.confirm(`Dzēst korekciju ${signedNumber(entry.amount)} (${plantCorrectionReasonLabel(entry.reason)})?`)) {
      return;
    }

    onUpdateRow(row.id, {
      plantCorrections: removePlantCorrection(row.plantCorrections, entry.id),
    });
  }

  function saveHusEvent(entry: HusEventEntry) {
    onUpdateRow(row.id, applyHusEventSave(row, entry));
  }

  function deleteHusEvent(entry: HusEventEntry) {
    const linkedMessage = entry.plantCorrectionId ? " Saistītā stādu korekcija arī tiks dzēsta." : "";
    if (!window.confirm(`Dzēst HUS žurnāla ierakstu?${linkedMessage}`)) {
      return;
    }

    onUpdateRow(row.id, applyHusEventDelete(row, entry.id));
  }

  function closeCorrectionDialog() {
    setCorrectionDialogOpen(false);
    setEditingCorrection(null);
  }

  function closeEventDialog() {
    setEventDialogOpen(false);
    setEditingEvent(null);
  }

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

      <div className="segmented worksheet-tabs no-print" aria-label="Hus skats">
        <button
          className={activeWorksheetTab === "works" ? "is-active" : ""}
          onClick={() => setActiveWorksheetTab("works")}
          type="button"
        >
          HUS info
        </button>
        <button
          className={activeWorksheetTab === "worksheet" ? "is-active" : ""}
          onClick={() => setActiveWorksheetTab("worksheet")}
          type="button"
        >
          Darba lapa
        </button>
      </div>

      {activeWorksheetTab === "works" ? (
        <div className="panel hus-work-panel no-print">
          <section className="plant-balance-box">
            <div className="hus-info-heading">
              <div>
                <p className="eyebrow">HUS info</p>
                <h3>{row.sectorName}</h3>
                <span>{row.variety}</span>
              </div>
              <strong className={balance.tone === "short" ? "danger-text" : ""}>{balance.label}</strong>
            </div>
            <div className="plant-balance-grid">
              <span>
                Siltumnīcai nepieciešams:{" "}
                {balance.requiredPlants === null ? "Nav norādīts" : balance.requiredPlants.toLocaleString("lv-LV")}
              </span>
              <span>Agronoma sējamais: {row.requiredPlants.toLocaleString("lv-LV")}</span>
              <span>Extra: {signedNumber(row.extraPlants)}</span>
              <span>Sākotnēji iesēts: {balance.initialPlants.toLocaleString("lv-LV")}</span>
              <span>Zudumi/korekcijas: {signedNumber(balance.correctionTotal)}</span>
              <span>Faktiski šobrīd: {balance.actualPlants.toLocaleString("lv-LV")}</span>
              <span>{balance.difference === null ? "Rezerve/trūkums: Nav aprēķināms" : balance.difference >= 0 ? `Rezerve: ${signedNumber(balance.difference)}` : `Trūkst: ${Math.abs(balance.difference)}`}</span>
            </div>
            <button
              className="secondary-action"
              type="button"
              onClick={() => {
                setEditingCorrection(null);
                setCorrectionDialogOpen(true);
              }}
            >
              + Reģistrēt izmaiņu
            </button>
            {row.plantCorrections && row.plantCorrections.length > 0 ? (
              <ul className="plant-correction-list">
                {row.plantCorrections.map((entry) => (
                  <li key={entry.id}>
                    <time>{shortDate(entry.date)}</time>
                    <span>{plantCorrectionReasonLabel(entry.reason)}{entry.note ? ` · ${entry.note}` : ""}</span>
                    <strong>{signedNumber(entry.amount)}</strong>
                    <span className="button-row">
                      <button
                        className="secondary-action secondary-action--small"
                        type="button"
                        onClick={() => {
                          setEditingCorrection(entry);
                          setCorrectionDialogOpen(true);
                        }}
                      >
                        Rediģēt
                      </button>
                      <button className="danger-action danger-action--small" type="button" onClick={() => deletePlantCorrection(entry)}>
                        Dzēst
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="empty-state">Stādu skaita korekcijas vēl nav reģistrētas.</p>
            )}
          </section>
          <section className="hus-journal-box">
            <div className="hus-info-heading">
              <div>
                <p className="eyebrow">HUS žurnāls</p>
                <h3>Notikumi</h3>
              </div>
              <button
                className="secondary-action"
                type="button"
                onClick={() => {
                  setEditingEvent(null);
                  setEventDialogOpen(true);
                }}
              >
                + Pievienot ierakstu
              </button>
            </div>
            {row.husEvents && row.husEvents.length > 0 ? (
              <ul className="hus-journal-list">
                {row.husEvents.map((entry) => (
                  <li key={entry.id}>
                    <div className="hus-journal-list__date">
                      <time>{shortDate(entry.eventDate)}</time>
                      <span>{getCycleDay(row, entry.eventDate)}. diena</span>
                    </div>
                    <div className="hus-journal-list__body">
                      <strong>{husEventTypeLabel(entry.eventType)}</strong>
                      {entry.location || entry.destinationLocation ? (
                        <span>
                          {entry.location || "—"}
                          {entry.destinationLocation ? ` → ${entry.destinationLocation}` : ""}
                        </span>
                      ) : null}
                      {typeof entry.plantChange === "number" && entry.plantChange !== 0 ? (
                        <em>{signedNumber(entry.plantChange)} stādi</em>
                      ) : null}
                      {entry.note ? <p>{entry.note}</p> : null}
                    </div>
                    <span className="button-row">
                      <button
                        className="secondary-action secondary-action--small"
                        type="button"
                        onClick={() => {
                          setEditingEvent(entry);
                          setEventDialogOpen(true);
                        }}
                      >
                        Rediģēt
                      </button>
                      <button className="danger-action danger-action--small" type="button" onClick={() => deleteHusEvent(entry)}>
                        Dzēst
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="empty-state">Šim Hus vēl nav žurnāla ierakstu.</p>
            )}
          </section>
          <div className="work-list">
            {chronologicalWorkItems.map((item) => (
              <article className={`hus-work-row work-card--${item.color}`} key={item.id}>
                <time>{shortDate(item.date)}</time>
                <div>
                  <strong>{item.title}</strong>
                  <span>
                    {item.cycleDay}. diena · {item.source === "manual" ? "Manuāli" : "Automātiski"}
                  </span>
                  {item.details.length > 0 ? (
                    <ul>
                      {item.details.map((detail) => (
                        <li key={detail}>{detail}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
          {correctionDialogOpen ? (
            <PlantCorrectionDialog
              entry={editingCorrection}
              onCancel={closeCorrectionDialog}
              onSave={(entry) => {
                savePlantCorrection(entry);
                closeCorrectionDialog();
              }}
            />
          ) : null}
          {eventDialogOpen ? (
            <HusEventDialog
              entry={editingEvent}
              onCancel={closeEventDialog}
              onSave={(entry) => {
                saveHusEvent(entry);
                closeEventDialog();
              }}
              row={row}
            />
          ) : null}
        </div>
      ) : null}

      <article className={`print-page worksheet-page ${activeWorksheetTab === "worksheet" ? "" : "screen-hidden"}`}>
        <header className="worksheet-header">
          <h1 className="print-only-title">{row.sectorName}</h1>
          <div className="worksheet-meta">
            <span><strong>Sēšana:</strong> {shortDate(row.sowingDate)}</span>
            <span><strong>Stādi:</strong> {totalSow.toLocaleString("lv-LV")}</span>
            <span><strong>Šķirne:</strong> {row.variety}</span>
            <span><strong>Izvākšana:</strong> {shortDate(row.harvestDate)}</span>
            <span><strong>Sēšanas galdi:</strong> {row.sowingTables || "Nav norādīti"}</span>
          </div>
          <div className="worksheet-needed">
            <strong>Nepieciešams</strong>
            <span>Sēšana: {materials.sowing}</span>
            <span>Sēšanas galdi: {materials.sowingTables}</span>
            <span>Retināšana: {materials.thinning}</span>
            <span>Izvākšana: {materials.harvest}</span>
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
  onStartChange,
  startDate,
  workItems,
}: {
  onStartChange: (date: string) => void;
  startDate: string;
  workItems: WorkItem[];
}) {
  const items = continuousWorkPlanPrintRows(workItems, startDate);
  const groups = groupMonthlyPrintRowsIntoDateGroups(items);

  return (
    <section className="print-host">
      <div className="panel panel-header no-print">
        <div>
          <p className="eyebrow">Drukājams kopsavilkums</p>
          <h2>Darba plāns</h2>
        </div>
        <div className="button-row month-controls">
          <label>
            Sākuma mēnesis
            <input
              type="month"
              value={monthInputValue(startDate)}
              onChange={(event) => onStartChange(`${event.target.value}-01`)}
            />
          </label>
          <button className="primary-action" type="button" onClick={() => window.print()}>
            Printēt darba plānu
          </button>
        </div>
      </div>

      <article className="print-page month-page">
        <header className="month-print-header">
          <h1>{workPlanPrintTitle(items)}</h1>
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
          {groups.length === 0 ? (
            <tbody>
              <tr>
                <td colSpan={5}>No izvēlētā sākuma datuma nav ieplānotu darbu.</td>
              </tr>
            </tbody>
          ) : null}
          {groups.map((group) => (
            <tbody className="month-print-date-group" key={group.date}>
              {group.rows.map((item) => (
                <tr className={item.startsNewDate ? "month-print-row--new-date" : ""} key={`${item.date}-${item.planRowId}`}>
                  <td>{item.showDate ? shortDate(item.date) : ""}</td>
                  <td>{item.sectorName}</td>
                  <td>{item.workTitle}</td>
                  <td>{item.plantCount.toLocaleString("lv-LV")}</td>
                  <td>{item.notes}</td>
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </article>
    </section>
  );
}

function SowingTablesPicker({
  compact = false,
  onSave,
  value,
}: {
  compact?: boolean;
  onSave: (value: string) => void;
  value: string;
}) {
  const [selected, setSelected] = useState<string[]>(() => parseSowingTableSelection(value));
  const [open, setOpen] = useState(false);
  const savedLabel = formatSowingTableSelection(parseSowingTableSelection(value));
  const draftLabel = formatSowingTableSelection(selected);

  function toggle(table: string) {
    setSelected((current) => toggleSowingTableSelection(current, table));
  }

  function openDialog() {
    setSelected(parseSowingTableSelection(value));
    setOpen(true);
  }

  function cancelDialog() {
    setSelected(parseSowingTableSelection(value));
    setOpen(false);
  }

  function saveDialog() {
    onSave(draftLabel);
    setOpen(false);
  }

  return (
    <div className={compact ? "sowing-tables sowing-tables--compact" : "sowing-tables"}>
      <span>Sēšanas galdi</span>
      <button className="sowing-tables__trigger" type="button" onClick={openDialog}>
        {savedLabel || "Norādīt"}
      </button>
      {open ? (
        <div className="dialog-backdrop" role="presentation">
          <section
            aria-modal="true"
            aria-label="Izvēlēties sēšanas galdus"
            className="sowing-tables-dialog"
            role="dialog"
          >
            <div>
              <p className="eyebrow">Sēšanas galdi</p>
              <h3>Izvēlies A1-A13</h3>
            </div>
            <div className="sowing-table-options" aria-label="Sēšanas galdi A1 līdz A13">
              {sowingTableIds.map((table) => (
                <button
                  className={selected.includes(table) ? "is-active" : ""}
                  key={table}
                  onClick={() => toggle(table)}
                  type="button"
                >
                  {table}
                </button>
              ))}
            </div>
            <strong className="sowing-tables__preview">{draftLabel || "Nav norādīti"}</strong>
            <div className="button-row">
              <button className="secondary-action" type="button" onClick={cancelDialog}>
                Atcelt
              </button>
              <button className="primary-action" type="button" onClick={saveDialog}>
                Saglabāt
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function PlantCorrectionDialog({
  entry,
  onCancel,
  onSave,
}: {
  entry: PlantCorrectionEntry | null;
  onCancel: () => void;
  onSave: (entry: PlantCorrectionEntry) => void;
}) {
  const [direction, setDirection] = useState<"loss" | "addition">(() => (entry && entry.amount > 0 ? "addition" : "loss"));
  const [amount, setAmount] = useState(() => (entry ? String(Math.abs(entry.amount)) : ""));
  const [date, setDate] = useState(() => entry?.date ?? new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState<PlantCorrectionReason>(entry?.reason ?? "thinning");
  const [note, setNote] = useState(entry?.note ?? "");
  const parsedAmount = Number(amount);
  const canSave = Number.isFinite(parsedAmount) && parsedAmount > 0 && Boolean(date) && (reason !== "other" || note.trim().length > 0);

  return (
    <div className="dialog-backdrop" role="presentation">
      <section aria-modal="true" aria-label="Reģistrēt stādu skaita izmaiņu" className="sowing-tables-dialog" role="dialog">
        <div>
          <p className="eyebrow">Stādu korekcija</p>
          <h3>{entry ? "Rediģēt izmaiņu" : "Reģistrēt izmaiņu"}</h3>
        </div>
        <div className="segmented segmented--compact" aria-label="Korekcijas veids">
          <button
            className={direction === "loss" ? "is-active" : ""}
            onClick={() => setDirection("loss")}
            type="button"
          >
            − Zudums
          </button>
          <button
            className={direction === "addition" ? "is-active" : ""}
            onClick={() => setDirection("addition")}
            type="button"
          >
            + Papildinājums
          </button>
        </div>
        <label>
          Daudzums
          <input
            autoFocus
            inputMode="numeric"
            min="1"
            placeholder="100"
            type="number"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        </label>
        <label>
          Datums
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </label>
        <label>
          Iemesls
          <select value={reason} onChange={(event) => setReason(event.target.value as PlantCorrectionReason)}>
            <option value="thinning">Retināšana</option>
            <option value="brownRoots">Brūnās saknes</option>
            <option value="damaged">Bojāti</option>
            <option value="other">Cits</option>
          </select>
        </label>
        {reason === "other" ? (
          <label>
            Piezīme
            <input maxLength={80} value={note} onChange={(event) => setNote(event.target.value)} />
          </label>
        ) : null}
        <div className="button-row">
          <button className="secondary-action" type="button" onClick={onCancel}>
            Atcelt
          </button>
          <button
            className="primary-action"
            disabled={!canSave}
            type="button"
            onClick={() =>
              onSave({
                id: entry?.id ?? crypto.randomUUID(),
                amount: signedPlantCorrectionAmount(direction, parsedAmount),
                date,
                note: note.trim() || undefined,
                reason,
              })
            }
          >
            Saglabāt
          </button>
        </div>
      </section>
    </div>
  );
}

function HusEventDialog({
  entry,
  onCancel,
  onSave,
  row,
}: {
  entry: HusEventEntry | null;
  onCancel: () => void;
  onSave: (entry: HusEventEntry) => void;
  row: SowingPlanRow;
}) {
  type PlantChangeMode = "none" | "loss" | "addition";
  const initialPlantChangeMode: PlantChangeMode =
    typeof entry?.plantChange !== "number" || entry.plantChange === 0
      ? "none"
      : entry.plantChange < 0
        ? "loss"
        : "addition";
  const [eventDate, setEventDate] = useState(() => entry?.eventDate ?? row.sowingDate);
  const [eventType, setEventType] = useState<HusEventType>(entry?.eventType ?? "observation");
  const [location, setLocation] = useState(entry?.location ?? "");
  const [destinationLocation, setDestinationLocation] = useState(entry?.destinationLocation ?? "");
  const [plantChangeMode, setPlantChangeMode] = useState<PlantChangeMode>(initialPlantChangeMode);
  const [plantChangeAmount, setPlantChangeAmount] = useState(() =>
    typeof entry?.plantChange === "number" && entry.plantChange !== 0 ? String(Math.abs(entry.plantChange)) : "",
  );
  const [note, setNote] = useState(entry?.note ?? "");
  const parsedPlantChangeAmount = plantChangeAmount.trim() === "" ? undefined : Number(plantChangeAmount);
  const plantChange =
    plantChangeMode === "none" || parsedPlantChangeAmount === undefined
      ? undefined
      : signedPlantCorrectionAmount(plantChangeMode === "loss" ? "loss" : "addition", parsedPlantChangeAmount);
  const canSave =
    Boolean(eventDate) &&
    Boolean(eventType) &&
    (plantChangeMode === "none" ||
      (Number.isFinite(parsedPlantChangeAmount) && parsedPlantChangeAmount !== undefined && parsedPlantChangeAmount > 0));

  return (
    <div className="dialog-backdrop" role="presentation">
      <section aria-modal="true" aria-label="HUS žurnāla ieraksts" className="sowing-tables-dialog" role="dialog">
        <div>
          <p className="eyebrow">HUS žurnāls</p>
          <h3>{entry ? "Rediģēt ierakstu" : "Pievienot ierakstu"}</h3>
          <span className="dialog-hint">
            {eventDate ? `${shortDate(eventDate)} · ${getCycleDay(row, eventDate)}. diena` : "Izvēlies datumu"}
          </span>
        </div>
        <label>
          Datums
          <input autoFocus type="date" value={eventDate} onChange={(event) => setEventDate(event.target.value)} />
        </label>
        <label>
          Notikums
          <select value={eventType} onChange={(event) => setEventType(event.target.value as HusEventType)}>
            {husEventTypes.map((type) => (
              <option key={type.value} value={type.value}>
                {type.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Vieta / No
          <input maxLength={80} placeholder="A7, C5, C1-C10" value={location} onChange={(event) => setLocation(event.target.value)} />
        </label>
        <label>
          Uz
          <input
            maxLength={80}
            placeholder="C1-C10"
            value={destinationLocation}
            onChange={(event) => setDestinationLocation(event.target.value)}
          />
        </label>
        <div className="plant-change-field">
          Stādu izmaiņa
          <div className="segmented segmented--compact plant-change-mode" aria-label="Stādu izmaiņas veids">
            <button
              className={plantChangeMode === "none" ? "is-active" : ""}
              onClick={() => setPlantChangeMode("none")}
              type="button"
            >
              Nav
            </button>
            <button
              className={plantChangeMode === "loss" ? "is-active" : ""}
              onClick={() => setPlantChangeMode("loss")}
              type="button"
            >
              − Zudums
            </button>
            <button
              className={plantChangeMode === "addition" ? "is-active" : ""}
              onClick={() => setPlantChangeMode("addition")}
              type="button"
            >
              + Papildinājums
            </button>
          </div>
        </div>
        {plantChangeMode !== "none" ? (
          <label>
            Daudzums
            <input
              inputMode="numeric"
              min="1"
              placeholder="32"
              type="number"
              value={plantChangeAmount}
              onChange={(event) => setPlantChangeAmount(event.target.value)}
            />
          </label>
        ) : null}
        <label>
          Piezīme
          <textarea maxLength={240} rows={3} value={note} onChange={(event) => setNote(event.target.value)} />
        </label>
        <div className="button-row">
          <button className="secondary-action" type="button" onClick={onCancel}>
            Atcelt
          </button>
          <button
            className="primary-action"
            disabled={!canSave}
            type="button"
            onClick={() =>
              onSave({
                id: entry?.id ?? crypto.randomUUID(),
                eventDate,
                eventType,
                location: location.trim() || undefined,
                destinationLocation: destinationLocation.trim() || undefined,
                plantChange,
                plantCorrectionId: entry?.plantCorrectionId,
                note: note.trim() || undefined,
                createdAt: entry?.createdAt,
                updatedAt: entry?.updatedAt,
              })
            }
          >
            Saglabāt
          </button>
        </div>
      </section>
    </div>
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
        value={value.value === null || value.value === undefined ? "" : String(value.value)}
      />
      {value.needsReview ? <small>Pārbaudi ({Math.round(value.confidence * 100)}%)</small> : null}
    </label>
  );
}

function fieldWarnings(candidate: PlanImportCandidate): string[] {
  return Object.entries(candidate.fields)
    .filter(([, field]) => field.needsReview)
    .map(([key, field]) => `${importFieldLabel(key as ImportFieldKey)} jāpārbauda (${Math.round(field.confidence * 100)}%).`);
}

function importFieldLabel(field: ImportFieldKey): string {
  const labels: Record<ImportFieldKey, string> = {
    extraPlants: "Rezerve",
    greenhouseRequiredPlants: "Siltumnīcai nepieciešams",
    harvestDate: "Izvākšana",
    requiredPlants: "Agronoma sējamais",
    sectorName: "Hus",
    sowingDate: "Sēšana",
    variety: "Šķirne",
    weekNumber: "Nedēļa",
  };

  return labels[field];
}

function CalendarPanel({
  anchorDate,
  balancePreview,
  calendarDays,
  onApplyBalance,
  onCancelBalance,
  onPreviewBalance,
  onRecalculatePlan,
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
  onRecalculatePlan: () => void;
  onSelectDate: (date: string) => void;
  onSetAnchorDate: (date: string) => void;
  onSetViewMode: (mode: ViewMode) => void;
  selectedDate: string;
  viewMode: ViewMode;
  workItems: WorkItem[];
}) {
  const rangeDays = calendarDays.filter((day) => day.inCurrentRange);

  return (
    <div className="panel calendar-panel no-print">
      <div className="panel-header">
        <div>
          <p className="eyebrow">Kopējais kalendārs</p>
          <h2>{calendarTitle(anchorDate, viewMode)}</h2>
        </div>
        <div className="calendar-controls">
          <button type="button" onClick={() => onSetAnchorDate(shiftAnchor(anchorDate, viewMode, -1))}>
            ←
          </button>
          <button
            type="button"
            onClick={() => {
              const today = toIsoDate(new Date());
              onSetAnchorDate(today);
              onSelectDate(today);
            }}
          >
            Šodien
          </button>
          <button type="button" onClick={() => onSetAnchorDate(shiftAnchor(anchorDate, viewMode, 1))}>
            →
          </button>
          <details className="calendar-actions">
            <summary>⋮ Plāna darbības</summary>
            <div>
              <button type="button" onClick={onRecalculatePlan}>
                Pārrēķināt plānu
              </button>
              <button type="button" onClick={onPreviewBalance}>
                Izlīdzināt darbus
              </button>
              <button type="button" onClick={() => window.print()}>
                Printēt darba plānu
              </button>
            </div>
          </details>
        </div>
      </div>

      {balancePreview ? (
        <BalancePreview proposals={balancePreview} onApply={onApplyBalance} onCancel={onCancelBalance} />
      ) : null}

      <div className="segmented calendar-view-toggle" aria-label="Kalendāra skata režīms">
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

      {viewMode === "month" ? (
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
      ) : (
        <div className="agenda-list">
          {rangeDays.map((day) => {
            const dayItems = workItems
              .filter((item) => item.date === day.isoDate)
              .sort((a, b) => a.title.localeCompare(b.title, "lv") || a.sectorName.localeCompare(b.sectorName, "lv"));
            const mainWorkload = countMainWork(dayItems, day.isoDate);
            const overloaded = mainWorkload > 1;

            return (
              <button
                className={[
                  "agenda-day",
                  day.isoDate === selectedDate ? "is-selected" : "",
                  overloaded ? "is-overloaded" : "",
                ].join(" ")}
                key={day.isoDate}
                onClick={() => onSelectDate(day.isoDate)}
                type="button"
              >
                <span className="agenda-day__date">
                  <strong>{shortDate(day.isoDate)}</strong>
                  <span>{weekdayName(day.isoDate)}</span>
                </span>
                <span className="agenda-day__items">
                  {dayItems.length === 0 ? <span className="empty-state">Nav darbu</span> : null}
                  {dayItems.map((item) => (
                    <span className={`agenda-work work-chip--${item.color}`} key={item.id}>
                      <strong>{item.title}</strong>
                      <span>{item.sectorName} · {item.plantCount.toLocaleString("lv-LV")}</span>
                    </span>
                  ))}
                </span>
              </button>
            );
          })}
        </div>
      )}
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
      <SowingTablesPicker
        key={`${row.id}-${row.sowingTables ?? ""}`}
        value={row.sowingTables ?? ""}
        onSave={(value) => onUpdateRow(row.id, { sowingTables: value || undefined })}
      />
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
        Siltumnīcai nepieciešams
        <input
          min="1"
          type="number"
          value={row.greenhouseRequiredPlants ?? ""}
          onChange={(event) =>
            onUpdateRow(row.id, {
              greenhouseRequiredPlants: event.target.value ? Number(event.target.value) : undefined,
            })
          }
        />
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

function appendChangeHistory(
  previous: SowingPlanRow,
  next: SowingPlanRow,
  patch: Partial<SowingPlanRow>,
  resetSchedule?: boolean,
): ChangeHistoryEntry[] {
  const history = [...(previous.changeHistory ?? [])];
  const tracked: Array<[keyof SowingPlanRow, string]> = [
    ["sectorName", "Hus"],
    ["greenhouseRequiredPlants", "Siltumnīcai nepieciešams"],
    ["requiredPlants", "Agronoma sējamais"],
    ["extraPlants", "Extra"],
    ["variety", "Šķirne"],
    ["weekNumber", "Nedēļa"],
    ["sowingTables", "Sēšanas galdi"],
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

  if ("plantCorrections" in patch) {
    const previousTotal = (previous.plantCorrections ?? []).reduce((sum, entry) => sum + entry.amount, 0);
    const nextTotal = (next.plantCorrections ?? []).reduce((sum, entry) => sum + entry.amount, 0);
    if (previousTotal !== nextTotal || (previous.plantCorrections ?? []).length !== (next.plantCorrections ?? []).length) {
      history.push(historyEntry("Stādu korekcijas", signedNumber(previousTotal), signedNumber(nextTotal), next.sectorName));
    }
  }

  if ("husEvents" in patch && (previous.husEvents ?? []).length !== (next.husEvents ?? []).length) {
    history.push(
      historyEntry(
        "HUS žurnāls",
        String((previous.husEvents ?? []).length),
        String((next.husEvents ?? []).length),
        next.sectorName,
      ),
    );
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
  const entries = Object.entries(row.adjustments ?? {}).filter(([key, value]) => {
    const dates = adjustmentValueToDates(value);
    return dates.length > 0 && dates.every((date) =>
      isAllowedMove(row, key === "sideShoots" ? "sideShoots" : key === "thinning" ? "thinning" : "sticks", date),
    );
  });
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

function formatAdjustmentSummary(adjustments: SowingPlanRow["adjustments"]): string {
  const parts = Object.entries(adjustments ?? {})
    .map(([type, value]) => `${workTypeLabel(type)}: ${formatAdjustmentValue(value)}`)
    .filter((value) => value.trim().length > 0);

  return parts.length > 0 ? parts.join("; ") : "Nav saglabātu pārcēlumu";
}

function workTypeLabel(type: string): string {
  if (type === "thinning") {
    return "Retināšana";
  }

  if (type === "sideShoots") {
    return "Pazares";
  }

  if (type === "sticks") {
    return "Kociņi";
  }

  return type;
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

function shortDate(date: string): string {
  return new Intl.DateTimeFormat("lv-LV", {
    day: "2-digit",
    month: "2-digit",
  }).format(new Date(`${date}T12:00:00`));
}

function weekdayName(date: string): string {
  return new Intl.DateTimeFormat("lv-LV", {
    weekday: "long",
  }).format(new Date(`${date}T12:00:00`));
}

function monthInputValue(date: string): string {
  return date.slice(0, 7);
}

function printPlanStartDate(anchorDate: string, viewMode: ViewMode): string {
  if (viewMode !== "month") {
    return anchorDate;
  }

  const anchor = new Date(`${anchorDate}T12:00:00`);
  return toIsoDate(new Date(anchor.getFullYear(), anchor.getMonth(), 1, 12));
}

function workPlanPrintTitle(items: ReturnType<typeof continuousWorkPlanPrintRows>): string {
  const first = items[0]?.date;
  const last = items.at(-1)?.date;

  if (!first || !last) {
    return "DARBA PLĀNS";
  }

  return `DARBA PLĀNS · ${printDateRange(first, last)}`;
}

function printDateRange(first: string, last: string): string {
  const firstDate = new Date(`${first}T12:00:00`);
  const lastDate = new Date(`${last}T12:00:00`);
  const firstYear = firstDate.getFullYear();
  const lastYear = lastDate.getFullYear();

  if (first === last) {
    return `${shortDate(first)}${firstYear}`;
  }

  if (firstYear === lastYear) {
    return `${shortDate(first)}–${shortDate(last)}${lastYear}`;
  }

  return `${shortDate(first)}${firstYear}–${shortDate(last)}${lastYear}`;
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

function signedNumber(value: number): string {
  return value > 0 ? `+${value.toLocaleString("lv-LV")}` : value.toLocaleString("lv-LV");
}

function plantCorrectionReasonLabel(reason: PlantCorrectionReason): string {
  const labels: Record<PlantCorrectionReason, string> = {
    brownRoots: "Brūnās saknes",
    damaged: "Bojāti",
    other: "Cits",
    thinning: "Retināšana",
  };

  return labels[reason];
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

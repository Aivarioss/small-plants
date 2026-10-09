"use client";

import Image from "next/image";
import { createContext, FormEvent, useContext, useEffect, useMemo, useRef, useState } from "react";
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
  countMainWork,
  calculateSowingPlan,
  calculateThinningPlan,
  clearOptimizerWorkAdjustments,
  compareSowingRowsByDate,
  createPlacementPlan,
  dateLabel,
  eachDate,
  formatSowingTableSelection,
  generateWorksheetDaysFromWorkItems,
  generateWorkItemsForRows,
  getBiologicalCycleDays,
  getCycleDay,
  getTotalSow,
  groupMonthlyPrintRowsIntoDateGroups,
  greenhouseRows,
  hasManualWorkMoves,
  isAllowedMove,
  defaultHusEventDate,
  parseHusEventMovementRows,
  parseSowingTableSelection,
  serializeHusEventMovementRows,
  sowingTableIds,
  toggleSowingTableSelection,
  toIsoDate,
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
import {
  formatCycleDay,
  formatCycleDays,
  formatPlants,
  formatPrintHarvestBoxes,
  formatPrintSowingPlan,
  formatPrintThinningPlan,
  formatReserveShortage,
  husEventTypeTitle,
  localizedWorkDetails,
  localizedMonthlyPrintRows,
  printLabel,
  printMaterialSummary,
  printWorkTitle,
  readStoredLanguage,
  t,
  writeStoredLanguage,
  type AppLanguage,
} from "@/lib/localization";
import { compressHusPhotoForUpload } from "@/lib/image-compression";
import {
  archiveRow,
  loadArchivedRows,
  restoreArchivedRow,
  SowingPlanApiConflictError,
} from "@/lib/repositories/api-sowing-plan-repository";
import { sowingPlanRepository } from "@/lib/repositories/sowing-plan-repository";
import type {
  ChangeHistoryEntry,
  ArchiveSnapshot,
  HusEventEntry,
  HusEventType,
  HusNoteEntry,
  HusPhotoEntry,
  ImportFieldKey,
  MainView,
  PlanImportCandidate,
  PlanImportResult,
  SectorType,
  SowingPlanDocument,
  SowingPlanDraft,
  SowingPlanRow,
  ViewMode,
  WorkItem,
  WorkloadBalanceProposal,
} from "@/lib/types";

const navItems: Array<{ id: MainView; labelKey: "plan" | "calendar" | "allHus" }> = [
  { id: "sowingPlan", labelKey: "plan" },
  { id: "calendar", labelKey: "calendar" },
  { id: "hus", labelKey: "allHus" },
];

const viewModes: Array<{ id: ViewMode; label: Record<AppLanguage, string> }> = [
  { id: "month", label: { lv: "Mēnesis", en: "Month" } },
  { id: "tenDays", label: { lv: "10 dienas", en: "10 days" } },
];

const weekdayLabels = ["P", "O", "T", "C", "P", "S", "Sv"];
const weekdayLabelsByLanguage: Record<AppLanguage, string[]> = {
  en: ["M", "T", "W", "T", "F", "S", "Su"],
  lv: weekdayLabels,
};

const LanguageContext = createContext<AppLanguage>("lv");

function useAppLanguage(): AppLanguage {
  return useContext(LanguageContext);
}

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

function calendarItemLabel(item: WorkItem, language: AppLanguage) {
  const placementLabel =
    item.type === "thinning" && item.placement
      ? ` · ${
          item.placement.primaryRow
            ? language === "lv" ? `Rinda ${item.placement.primaryRow}` : `Row ${item.placement.primaryRow}`
            : language === "lv" ? "Nav rindas" : "No row"
        } · ${item.placement.tables} ${language === "lv" ? "galdi" : "tables"}`
      : "";

  return `${printWorkTitle(item.type, language)} · ${item.sectorName}${placementLabel} · ${compactNumber(item.plantCount)}`;
}

export function PlannerApp() {
  const [planRows, setPlanRows] = useState<SowingPlanRow[]>([]);
  const [archivedRows, setArchivedRows] = useState<SowingPlanRow[]>([]);
  const [repositoryMessage, setRepositoryMessage] = useState("Ielādē Supabase");
  const [repositoryError, setRepositoryError] = useState("");
  const [activeView, setActiveView] = useState<MainView>("sowingPlan");
  const [husListMode, setHusListMode] = useState<"active" | "archive">("active");
  const [viewMode, setViewMode] = useState<ViewMode>("month");
  const [printLanguage, setPrintLanguage] = useState<AppLanguage>(() => readStoredLanguage());
  const [anchorDate, setAnchorDate] = useState("2026-09-25");
  const [selectedDate, setSelectedDate] = useState("2026-09-25");
  const [selectedRowId, setSelectedRowId] = useState("");
  const [draft, setDraft] = useState<SowingPlanDraft>(initialDraft);
  const [moveErrors, setMoveErrors] = useState<Record<string, string>>({});
  const [importResult, setImportResult] = useState<PlanImportResult | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const [importMessage, setImportMessage] = useState("");
  const [importPreviewUrl, setImportPreviewUrl] = useState("");
  const [planDocument, setPlanDocument] = useState<SowingPlanDocument | null>(null);
  const [planDocumentBusy, setPlanDocumentBusy] = useState(false);
  const [planDocumentMessage, setPlanDocumentMessage] = useState("");
  const [planDocumentViewerOpen, setPlanDocumentViewerOpen] = useState(false);
  const [husPhotoViewer, setHusPhotoViewer] = useState<HusPhotoEntry | null>(null);
  const [balancePreview, setBalancePreview] = useState<WorkloadBalanceProposal[] | null>(null);
  const rowSaveChainsRef = useRef(new Map<string, Promise<SowingPlanRow>>());

  useEffect(() => {
    writeStoredLanguage(printLanguage);
  }, [printLanguage]);

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
  const selectedArchivedRow = archivedRows.find((row) => row.id === selectedRowId);
  const selectedRow = planRows.find((row) => row.id === selectedRowId) ?? selectedArchivedRow ?? planRows[0];
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
    let cancelled = false;

    async function loadArchive() {
      try {
        const loadedRows = await loadArchivedRows();
        if (!cancelled) {
          setArchivedRows(loadedRows);
        }
      } catch (error) {
        if (!cancelled) {
          setRepositoryError(error instanceof Error ? error.message : "Neizdevās ielādēt HUS arhīvu");
        }
      }
    }

    void loadArchive();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadDocument() {
      try {
        const document = await fetchSowingPlanDocument();
        if (!cancelled) {
          setPlanDocument(document);
          setPlanDocumentMessage("");
        }
      } catch (error) {
        if (!cancelled) {
          setPlanDocumentMessage(error instanceof Error ? error.message : "Neizdevās ielādēt sēšanas plāna failu.");
        }
      }
    }

    void loadDocument();
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
      adjustmentSources: options?.resetSchedule ? undefined : sanitizeAdjustmentSources(next),
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

  async function archivePlanRow(row: SowingPlanRow, note?: string) {
    setRepositoryMessage("Arhivē Hus");
    setRepositoryError("");
    try {
      await rowSaveChainsRef.current.get(row.id);
      const archived = await archiveRow(row.id, note);
      await reloadRows("Hus arhivēts");
      setArchivedRows((current) => [archived, ...current.filter((candidate) => candidate.id !== archived.id)]);
      setSelectedRowId((current) => (current === row.id ? "" : current));
      setActiveView("hus");
      setHusListMode("archive");
      setRepositoryMessage("Hus arhivēts");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Neizdevās arhivēt Hus";
      setRepositoryMessage(message);
      setRepositoryError(message);
    }
  }

  async function restorePlanRow(row: SowingPlanRow) {
    setRepositoryMessage("Atjauno Hus");
    setRepositoryError("");
    try {
      const restored = await restoreArchivedRow(row.id);
      setArchivedRows((current) => current.filter((candidate) => candidate.id !== restored.id));
      setPlanRows((current) => [...current.filter((candidate) => candidate.id !== restored.id), restored]);
      setSelectedRowId(restored.id);
      setActiveView("worksheet");
      setHusListMode("active");
      setRepositoryMessage("Hus atjaunots");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Neizdevās atjaunot Hus";
      setRepositoryMessage(message);
      setRepositoryError(message);
    }
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
      adjustmentSources: {
        ...row.adjustmentSources,
        [adjustmentKey]: "manual",
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
      adjustmentSources: {
        ...row.adjustmentSources,
        [adjustmentKey]: "manual",
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

  async function uploadSowingPlanDocument(file: File) {
    setPlanDocumentBusy(true);
    setPlanDocumentMessage("");

    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await fetch("/api/sowing-plan-document", {
        body: formData,
        method: "POST",
      });
      const result = (await response.json().catch(() => null)) as { document?: SowingPlanDocument; error?: string } | null;

      if (!response.ok || !result?.document) {
        throw new Error(result?.error ?? "Neizdevās saglabāt sēšanas plāna failu.");
      }

      setPlanDocument(result.document);
      setPlanDocumentMessage(printLanguage === "lv" ? "Sēšanas plāns saglabāts." : "Seeding plan saved.");
    } catch (error) {
      setPlanDocumentMessage(error instanceof Error ? error.message : "Neizdevās saglabāt sēšanas plāna failu.");
    } finally {
      setPlanDocumentBusy(false);
    }
  }

  async function uploadHusMedia(
    rowId: string,
    input: { eventId?: string; files: File[]; note?: string; observationDate?: string },
  ) {
    setRepositoryMessage(printLanguage === "lv" ? "Saglabā HUS fotogrāfijas" : "Saving HUS photos");
    setRepositoryError("");
    const beforeCount = countHusMediaTarget([...planRows, ...archivedRows], rowId, input.eventId);

    try {
      const preparedFiles = await prepareHusPhotoFiles(input.files);
      const formData = new FormData();
      formData.append("rowId", rowId);
      if (input.eventId) {
        formData.append("eventId", input.eventId);
      }
      if (input.note?.trim()) {
        formData.append("note", input.note.trim());
      }
      if (input.observationDate) {
        formData.append("observationDate", input.observationDate);
      }
      preparedFiles.forEach((file) => formData.append("photos", file));

      const response = await fetch("/api/hus-media", {
        body: formData,
        method: "POST",
      });
      const result = (await response.json().catch(() => null)) as { note?: HusNoteEntry; photos?: HusPhotoEntry[]; error?: string } | null;

      if (!response.ok || !result) {
        throw new Error(result?.error ?? (printLanguage === "lv" ? "Neizdevās saglabāt HUS ierakstu." : "Could not save HUS entry."));
      }

      const update = (candidate: SowingPlanRow) =>
        candidate.id === rowId ? mergeHusMedia(candidate, result.note, result.photos ?? []) : candidate;
      setPlanRows((current) => current.map(update));
      setArchivedRows((current) => current.map(update));
      setRepositoryMessage(printLanguage === "lv" ? "HUS ieraksts saglabāts" : "HUS entry saved");
      setRepositoryError("");
    } catch (error) {
      if (isFetchFailure(error)) {
        const recovered = await reconcileHusMediaAfterFetchFailure(rowId, input.eventId, beforeCount);
        if (recovered) {
          setRepositoryMessage(
            printLanguage === "lv"
              ? "Foto saglabājās, bet savienojums pārtrūka. Dati pārlādēti."
              : "Photo was saved, but the connection dropped. Data reloaded.",
          );
          setRepositoryError("");
          return;
        }
      }
      const message = error instanceof Error ? error.message : printLanguage === "lv" ? "Neizdevās saglabāt HUS ierakstu." : "Could not save HUS entry.";
      setRepositoryMessage(message);
      setRepositoryError(message);
      throw error;
    }
  }

  async function reconcileHusMediaAfterFetchFailure(rowId: string, eventId: string | undefined, beforeCount: number): Promise<boolean> {
    try {
      const [activeRows, archiveRows] = await Promise.all([sowingPlanRepository.load(), loadArchivedRows()]);
      setPlanRows(activeRows);
      setArchivedRows(archiveRows);
      const afterCount = countHusMediaTarget([...activeRows, ...archiveRows], rowId, eventId);
      return afterCount > beforeCount;
    } catch {
      return false;
    }
  }

  async function deleteHusPhoto(photo: HusPhotoEntry) {
    setRepositoryMessage(printLanguage === "lv" ? "Dzēš HUS foto" : "Deleting HUS photo");
    setRepositoryError("");

    try {
      const response = await fetch(`/api/hus-media/photo/${photo.id}`, { method: "DELETE" });
      const result = (await response.json().catch(() => null)) as { error?: string; ok?: boolean; storageRemoved?: boolean } | null;
      if (!response.ok || !result?.ok) {
        throw new Error(result?.error ?? (printLanguage === "lv" ? "Neizdevās dzēst foto." : "Could not delete photo."));
      }

      const update = (candidate: SowingPlanRow) => removeHusPhoto(candidate, photo.id);
      setPlanRows((current) => current.map(update));
      setArchivedRows((current) => current.map(update));
      setHusPhotoViewer(null);
      setRepositoryMessage(
        result.storageRemoved === false
          ? printLanguage === "lv"
            ? "Foto noņemts no HUS. Storage tīrīšana jāatkārto vēlāk."
            : "Photo removed from HUS. Storage cleanup should be retried later."
          : printLanguage === "lv"
            ? "Foto dzēsts"
            : "Photo deleted",
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : printLanguage === "lv" ? "Neizdevās dzēst foto." : "Could not delete photo.";
      setRepositoryMessage(message);
      setRepositoryError(message);
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
        adjustmentSources: {
          ...row.adjustmentSources,
          ...Object.fromEntries(proposals.map((proposal) => [proposal.type, "optimizer"])),
        },
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
    const nextRows = planRows.map((row) => {
      const next = clearOptimizerWorkAdjustments(row);
      if (next === row) {
        return row;
      }

      return {
        ...next,
        changeHistory: [
          ...(next.changeHistory ?? []),
          historyEntry(
            "Darbu plāns pārrēķināts",
            formatAdjustmentSummary(row.adjustments),
            formatAdjustmentSummary(next.adjustments),
            "Notīrīti algoritma iesaldētie darba datumi",
          ),
        ],
      };
    });
    const changedRows = nextRows.filter((row, index) => rowsDiffer(planRows[index], row));

    if (changedRows.length === 0) {
      setRepositoryMessage("Plāns jau tiek rēķināts automātiski");
      return;
    }

    const confirmed = window.confirm(
      `Pārrēķināt darbu plānu no ${planRows.length} esošajām Hus rindām ar jauno scheduler algoritmu?\n\n` +
        "Tas nedzēsīs Hus/sēšanas datus vai manuāli pārceltos datumus. Tiks notīrīti tikai algoritma iesaldētie datumi.",
    );

    if (!confirmed) {
      return;
    }

    setBalancePreview(null);
    setPlanRows(nextRows);
    void persistRowDiff(planRows, nextRows);
    setRepositoryMessage(`Pārrēķina ${changedRows.length} Hus algoritma iesaldētos darba datumus`);
  }

  return (
    <LanguageContext.Provider value={printLanguage}>
    <main className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">{t("privatePlanner", printLanguage)}</p>
          <h1>{printLanguage === "lv" ? "Gurķu stādu cikli" : "Cucumber plant cycles"}</h1>
        </div>
        <div className="topbar__stats">
          <span>{repositoryMessage}</span>
          <span>{planRows.length} {t("plannedRows", printLanguage)}</span>
          <strong>{workItems.length} {t("work", printLanguage).toLowerCase()}</strong>
          <LanguageToggle language={printLanguage} onChange={setPrintLanguage} />
          <form action="/api/auth/logout" method="post">
            <button className="secondary-action" type="submit">
              {printLanguage === "lv" ? "Iziet" : "Logout"}
            </button>
          </form>
        </div>
      </header>

      {repositoryError ? (
        <section className="repository-error no-print" role="alert">
          <div>
            <strong>{printLanguage === "lv" ? "Neizdevās saglabāt Supabase" : "Could not save Supabase data"}</strong>
            <code>{repositoryError}</code>
          </div>
          <div className="button-row">
            <button
              className="secondary-action secondary-action--small"
              type="button"
              onClick={() => void navigator.clipboard?.writeText(repositoryError)}
            >
              {t("copyError", printLanguage)}
            </button>
            <button className="secondary-action secondary-action--small" type="button" onClick={() => setRepositoryError("")}>
              {printLanguage === "lv" ? "Aizvērt" : "Close"}
            </button>
          </div>
        </section>
      ) : null}

      <nav className="main-nav" aria-label={t("mainViews", printLanguage)}>
        {navItems.map((item) => (
          <button
            className={item.id === activeView ? "is-active" : ""}
            key={item.id}
            onClick={() => setActiveView(item.id)}
            type="button"
          >
            {t(item.labelKey, printLanguage)}
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
            onPlanDocumentView={() => {
              if (!planDocument) {
                return;
              }

              if (planDocument.contentType === "application/pdf") {
                window.open(planDocumentFileUrl(planDocument), "_blank", "noopener,noreferrer");
                return;
              }

              setPlanDocumentViewerOpen(true);
            }}
            onPlanDocumentUpload={uploadSowingPlanDocument}
            onUpdateDate={updateDateField}
            onUpdateRow={updatePlanRow}
            importBusy={importBusy}
            importMessage={importMessage}
            importPreviewUrl={importPreviewUrl}
            importResult={importResult}
            planDocument={planDocument}
            planDocumentBusy={planDocumentBusy}
            planDocumentMessage={planDocumentMessage}
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
              rows={planRows}
              selectedDate={selectedDate}
            />
          </section>
          <div className="calendar-print-source">
            <MonthlyPrintPlan
              onStartChange={setAnchorDate}
              printLanguage={printLanguage}
              rows={planRows}
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
          mode={husListMode}
          onModeChange={setHusListMode}
          rows={husListMode === "archive" ? archivedRows : planRows}
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
          onArchive={archivePlanRow}
          onUpdateRow={updatePlanRow}
          onRestore={restorePlanRow}
          onUploadHusMedia={uploadHusMedia}
          onViewPhoto={setHusPhotoViewer}
          printLanguage={printLanguage}
          readOnly={Boolean(selectedRow.archivedAt)}
          row={selectedRow}
          workItems={
            selectedRow.archivedAt
              ? selectedRow.archiveSnapshot?.workItems ?? []
              : workItems.filter((item) => item.planRowId === selectedRow.id)
          }
        />
      ) : null}

      {activeView === "monthPlan" ? (
        <MonthlyPrintPlan
          onStartChange={setAnchorDate}
          printLanguage={printLanguage}
          rows={planRows}
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
              <p className="eyebrow">{t("worksheet", printLanguage)}</p>
              <h2>{t("noHusSelected", printLanguage)}</h2>
            </div>
            <button className="primary-action" type="button" onClick={() => setActiveView("sowingPlan")}>
              {t("openPlan", printLanguage)}
            </button>
          </div>
        </section>
      ) : null}

      {planDocumentViewerOpen && planDocument ? (
        <SowingPlanDocumentViewer document={planDocument} onClose={() => setPlanDocumentViewerOpen(false)} />
      ) : null}
      {husPhotoViewer ? (
        <HusPhotoViewer
          photo={husPhotoViewer}
          onClose={() => setHusPhotoViewer(null)}
          onDelete={(photo) => void deleteHusPhoto(photo)}
        />
      ) : null}
    </main>
    </LanguageContext.Provider>
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
  onPlanDocumentUpload,
  onPlanDocumentView,
  onUpdateDate,
  onUpdateRow,
  planDocument,
  planDocumentBusy,
  planDocumentMessage,
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
  onPlanDocumentUpload: (file: File) => void;
  onPlanDocumentView: () => void;
  onUpdateDate: (row: SowingPlanRow, field: "sowingDate" | "harvestDate", value: string) => void;
  onUpdateRow: (id: string, patch: Partial<SowingPlanRow>) => void;
  planDocument: SowingPlanDocument | null;
  planDocumentBusy: boolean;
  planDocumentMessage: string;
  rows: SowingPlanRow[];
}) {
  const language = useAppLanguage();

  return (
    <section className="panel plan-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">{t("seasonBase", language)}</p>
          <h2>{t("plan", language)}</h2>
        </div>
        <div className="button-row">
          <label className="file-action">
            {t("importPlan", language)}
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
              {t("deleteDemoData", language)}
            </button>
          ) : null}
        </div>
      </div>

      <SowingPlanDocumentPanel
        busy={planDocumentBusy}
        document={planDocument}
        message={planDocumentMessage}
        onUpload={onPlanDocumentUpload}
        onView={onPlanDocumentView}
      />

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
      {importBusy ? <p className="import-note">{language === "lv" ? "Nolasa plānu no foto..." : "Reading plan from photo..."}</p> : null}
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
              <option value="">{t("chooseHus", language)}</option>
              {standardHusTemplates.map((template) => (
                <option key={template.hus} value={template.hus}>
                  {template.hus}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("seeding", language)}
            <input
              onChange={(event) => onDraftChange(updateDraftSowingDate(draft, event.target.value))}
              required
              type="date"
              value={draft.sowingDate}
            />
          </label>
          <div className="cycle-picker">
            <span>{t("cycle", language)}</span>
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
                {language === "lv" ? "Cits" : "Custom"}
              </button>
            </div>
          </div>
          <label>
            {t("moveOut", language)}
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
            {draft.variety || t("variety", language)} · {Number(draft.requiredPlants || 0).toLocaleString("lv-LV")} +{" "}
            {Number(draft.extraPlants || 0).toLocaleString("lv-LV")} →{" "}
            {formatPlants(operationalTotal(Number(draft.requiredPlants || 0), Number(draft.extraPlants || 0)), language)}
          </strong>
          <span>
            {t("greenhouseRequired", language)} {draft.greenhouseRequiredPlants ? Number(draft.greenhouseRequiredPlants).toLocaleString("lv-LV") : t("noTablesSet", language).toLowerCase()} ·
            {t("agronomistSowing", language)} {Number(draft.requiredPlants || 0).toLocaleString("lv-LV")} · {t("extra", language)}{" "}
            {Number(draft.extraPlants || 0).toLocaleString("lv-LV")} · {t("totalSow", language)}{" "}
            {operationalTotal(Number(draft.requiredPlants || 0), Number(draft.extraPlants || 0)).toLocaleString("lv-LV")}
          </span>
          <span>
            {t("moveOut", language)} {shortDate(draft.harvestDate)} · {draft.cycleLength || "?"} {language === "lv" ? "dienu cikls" : "day cycle"}
          </span>
        </div>

        <details className="advanced-fields">
          <summary>{t("changeDetails", language)}</summary>
          <div className="advanced-fields__grid">
            <label>
              {t("husName", language)}
              <input
                onChange={(event) => onDraftChange({ ...draft, sectorName: event.target.value })}
                placeholder="Hus 3"
                required
                value={draft.sectorName}
              />
            </label>
            <label>
              {t("greenhouseRequired", language)}
              <input
                min="1"
                onChange={(event) => onDraftChange({ ...draft, greenhouseRequiredPlants: event.target.value })}
                type="number"
                value={draft.greenhouseRequiredPlants}
              />
            </label>
            <label>
              {t("agronomistSowing", language)}
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
              {language === "lv" ? "Darbinieka extra" : "Worker extra"}
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
              {t("variety", language)}
              <input
                onChange={(event) => onDraftChange({ ...draft, variety: event.target.value })}
                placeholder="Baltazsara"
                required
                value={draft.variety}
              />
            </label>
            <SowingTablesPicker value={draft.sowingTables} onSave={(value) => onDraftChange({ ...draft, sowingTables: value })} />
            <label>
              {t("sectorTables", language)}
              <select
                value={draft.sectorType}
                onChange={(event) => onDraftChange({ ...draft, sectorType: Number(event.target.value) as SectorType })}
              >
                <option value={26}>26 {t("tables", language).toLowerCase()}</option>
                <option value={39}>39 {t("tables", language).toLowerCase()}</option>
              </select>
            </label>
          </div>
        </details>

        <button className="primary-action" type="submit">
          {t("addHus", language)}
        </button>
      </form>

      <div className="plan-table" role="table" aria-label={language === "lv" ? "Plāna Hus rindas" : "Plan Hus rows"}>
        <div className="plan-row plan-row--head" role="row">
          <span>Hus</span>
          <span>{t("seedingTables", language)}</span>
          <span>{t("greenhouseRequired", language)}</span>
          <span>{t("agronomistSowing", language)}</span>
          <span>{t("extra", language)}</span>
          <span>{t("totalSow", language)}</span>
          <span>{t("variety", language)}</span>
          <span>{t("seeding", language)}</span>
          <span>{t("moveOut", language)}</span>
          <span>{language === "lv" ? "Darbības" : "Actions"}</span>
        </div>
        {rows.length === 0 ? <p className="empty-state">{t("noPlanRows", language)}</p> : null}
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
                  {t("openHus", language)}
                </button>
                <button className="danger-action" type="button" onClick={() => onDelete(row.id)}>
                  {t("delete", language)}
                </button>
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function SowingPlanDocumentPanel({
  busy,
  document,
  message,
  onUpload,
  onView,
}: {
  busy: boolean;
  document: SowingPlanDocument | null;
  message: string;
  onUpload: (file: File) => void;
  onView: () => void;
}) {
  const language = useAppLanguage();
  const isImage = document?.contentType === "image/jpeg" || document?.contentType === "image/png";

  return (
    <section className="seeding-plan-document">
      <div className="seeding-plan-document__header">
        <div>
          <p className="eyebrow">{t("seedingPlanDocument", language)}</p>
          <h3>{t("seedingPlanDocument", language)}</h3>
        </div>
        <div className="button-row">
          {document ? (
            <button className="secondary-action" type="button" onClick={onView}>
              {t("view", language)}
            </button>
          ) : null}
          <label className="file-action">
            {document ? t("replace", language) : t("addPlanDocument", language)}
            <input
              accept="image/jpeg,image/png,application/pdf"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  onUpload(file);
                  event.target.value = "";
                }
              }}
              type="file"
            />
          </label>
        </div>
      </div>

      {document ? (
        <div className="seeding-plan-document__body">
          {isImage ? (
            <button className="seeding-plan-document__preview" type="button" onClick={onView}>
              <Image alt={document.originalFileName} height={84} src={planDocumentFileUrl(document)} unoptimized width={112} />
            </button>
          ) : (
            <button className="seeding-plan-document__pdf" type="button" onClick={onView}>
              PDF
            </button>
          )}
          <div>
            <strong>{document.originalFileName}</strong>
            <span>
              {formatFileSize(document.fileSizeBytes)} · {document.contentType === "application/pdf" ? "PDF" : "JPG/PNG"}
            </span>
          </div>
        </div>
      ) : (
        <p className="import-note">
          {language === "lv"
            ? "Saglabā agronoma sēšanas plāna foto vai PDF, lai tas būtu pieejams no telefona un datora."
            : "Save the agronomist seeding plan photo or PDF so it is available from phone and desktop."}
        </p>
      )}

      {busy ? <p className="import-note">{language === "lv" ? "Saglabā sēšanas plānu..." : "Saving seeding plan..."}</p> : null}
      {message ? <p className="import-note">{message}</p> : null}
    </section>
  );
}

function SowingPlanDocumentViewer({ document, onClose }: { document: SowingPlanDocument; onClose: () => void }) {
  const language = useAppLanguage();

  return (
    <div className="dialog-backdrop" role="presentation">
      <section aria-modal="true" aria-label={t("seedingPlanDocument", language)} className="plan-document-viewer" role="dialog">
        <div className="panel-header">
          <div>
            <p className="eyebrow">{t("seedingPlanDocument", language)}</p>
            <h3>{document.originalFileName}</h3>
          </div>
          <button className="secondary-action" type="button" onClick={onClose}>
            {language === "lv" ? "Aizvērt" : "Close"}
          </button>
        </div>
        <Image alt={document.originalFileName} height={900} src={planDocumentFileUrl(document)} unoptimized width={1200} />
      </section>
    </div>
  );
}

function HusPhotoStrip({ onView, photos }: { onView: (photo: HusPhotoEntry) => void; photos: HusPhotoEntry[] }) {
  if (photos.length === 0) {
    return null;
  }

  return (
    <div className="hus-photo-strip">
      {photos.map((photo) => (
        <button className="hus-photo-thumb" key={photo.id} type="button" onClick={() => onView(photo)}>
          <Image alt={photo.originalFileName} height={72} src={husPhotoFileUrl(photo)} unoptimized width={72} />
        </button>
      ))}
    </div>
  );
}

function HusPhotoViewer({
  onClose,
  onDelete,
  photo,
}: {
  onClose: () => void;
  onDelete: (photo: HusPhotoEntry) => void;
  photo: HusPhotoEntry;
}) {
  const language = useAppLanguage();

  return (
    <div className="dialog-backdrop" role="presentation">
      <section aria-modal="true" aria-label={photo.originalFileName} className="plan-document-viewer hus-photo-viewer" role="dialog">
        <div className="panel-header">
          <div>
            <p className="eyebrow">{language === "lv" ? "HUS fotogrāfija" : "HUS photo"}</p>
            <h3>{photo.originalFileName}</h3>
          </div>
          <button className="secondary-action" type="button" onClick={onClose}>
            {language === "lv" ? "Aizvērt" : "Close"}
          </button>
          <button
            className="danger-action"
            type="button"
            onClick={() => {
              if (window.confirm(language === "lv" ? "Dzēst šo foto?" : "Delete this photo?")) {
                onDelete(photo);
              }
            }}
          >
            {language === "lv" ? "Dzēst foto" : "Delete photo"}
          </button>
        </div>
        <Image alt={photo.originalFileName} height={900} src={husPhotoFileUrl(photo)} unoptimized width={1200} />
      </section>
    </div>
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
  const language = useAppLanguage();
  const selectedCount = importResult.candidates.filter((candidate) => candidate.selected).length;
  const importableCount = importResult.candidates.filter(
    (candidate) => candidate.selected && (!candidate.duplicateOf || candidate.duplicateAction === "replace"),
  ).length;

  return (
    <section className="import-review">
      <div className="panel-header">
        <div>
          <p className="eyebrow">{t("photoImport", language)}</p>
          <h3>{t("importDetectedPlan", language)}</h3>
        </div>
        <span className="mock-badge">
          {importResult.providerConfigured ? importResult.provider : language === "lv" ? "Providers nav konfigurēts" : "Provider not configured"} · {importResult.fileName}
        </span>
      </div>
      <p className="import-note">
        {language === "lv"
          ? "Pārbaudi, vai OCR nav sajaucis “Siltumnīcai nepieciešams” un “Agronoma sējamais”. Saglabāšana notiek tikai pēc apstiprināšanas."
          : "Check that OCR has not mixed up “Greenhouse required” and “Agronomist sowing”. Saving happens only after confirmation."}
      </p>
      <div className="import-table" role="table" aria-label="Atpazītā plāna pārbaude">
        <div className="import-row import-row--head" role="row">
          <span>✓</span>
          <span>Hus</span>
          <span>{t("variety", language)}</span>
          <span>{t("greenhouseRequired", language)}</span>
          <span>{t("agronomistSowing", language)}</span>
          <span>+ {language === "lv" ? "Rezerve" : "Reserve"}</span>
          <span>{t("total", language)}</span>
          <span>{t("seeding", language)}</span>
          <span>{t("moveOut", language)}</span>
          <span>{t("cycle", language)}</span>
          <span>{t("status", language)}</span>
          <span>{t("duplicate", language)}</span>
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
            <strong>{candidate.cycleLength ? formatCycleDays(candidate.cycleLength, language) : "⚠"}</strong>
            <div className="status-cell">
              {candidate.warnings.length > 0 || Object.values(candidate.fields).some((field) => field.needsReview) ? (
                <ul>
                  {[...candidate.warnings, ...fieldWarnings(candidate, language)].map((warning) => (
                    <li key={warning}>⚠ {warning}</li>
                  ))}
                </ul>
              ) : (
                <span>{t("importReady", language)}</span>
              )}
              {candidate.duplicateOf ? <small>{language === "lv" ? "Iespējams dublikāts ar esošu Hus ciklu." : "Possible duplicate of an existing Hus cycle."}</small> : null}
            </div>
            <div className="status-cell">
              {candidate.duplicateOf ? (
                <select
                  aria-label={language === "lv" ? "Dublikāta darbība" : "Duplicate action"}
                  value={candidate.duplicateAction ?? "keepExisting"}
                  onChange={(event) =>
                    onDuplicateActionChange(candidate.id, event.target.value as NonNullable<PlanImportCandidate["duplicateAction"]>)
                  }
                >
                  <option value="keepExisting">{t("deleteDuplicate", language)}</option>
                  <option value="replace">{language === "lv" ? "Atjaunot esošo" : "Update existing"}</option>
                </select>
              ) : (
                <span>{language === "lv" ? "Izveidot jaunu" : "Create new"}</span>
              )}
            </div>
          </div>
        ))}
      </div>
      {importResult.candidates.length === 0 ? <p className="empty-state">{t("noRowsForReview", language)}</p> : null}
      {importResult.candidates.length > 0 ? (
        <div className="import-actions">
          <span>
            {t("importSelected", language)} {selectedCount}; {language === "lv" ? "saglabās" : "will save"} {importableCount}
          </span>
          <button className="primary-action" disabled={importableCount === 0} onClick={onConfirm} type="button">
            {language === "lv" ? "Apstiprināt importu" : "Confirm import"}
          </button>
        </div>
      ) : null}
    </section>
  );
}

function CapacityAlerts({ items, onOpen }: { items: WorkItem[]; onOpen: (date: string) => void }) {
  const language = useAppLanguage();
  const warnings = items.filter((item) => item.capacityWarning);

  if (warnings.length === 0) {
    return null;
  }

  return (
    <section className="capacity-alerts no-print">
      {warnings.map((item) => (
        <button key={item.id} type="button" onClick={() => onOpen(item.date)}>
          ⚠ {item.sectorName} {printWorkTitle("thinning", language)} {shortDate(item.date)} {language === "lv" ? "jāpārbauda galdu noslodze" : "table load needs checking"}
        </button>
      ))}
    </section>
  );
}

function WorksheetView({
  onArchive,
  onEdit,
  onRestore,
  onUpdateRow,
  onUploadHusMedia,
  onViewPhoto,
  printLanguage,
  readOnly = false,
  row,
  workItems,
}: {
  onArchive: (row: SowingPlanRow, note?: string) => void;
  onEdit: () => void;
  onRestore: (row: SowingPlanRow) => void;
  onUpdateRow: (id: string, patch: Partial<SowingPlanRow>) => void;
  onUploadHusMedia: (
    rowId: string,
    input: { eventId?: string; files: File[]; note?: string; observationDate?: string },
  ) => Promise<void>;
  onViewPhoto: (photo: HusPhotoEntry) => void;
  printLanguage: AppLanguage;
  readOnly?: boolean;
  row: SowingPlanRow;
  workItems: WorkItem[];
}) {
  const [activeWorksheetTab, setActiveWorksheetTab] = useState<"works" | "worksheet">("works");
  const [eventDialogOpen, setEventDialogOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<HusEventEntry | null>(null);
  const [noteText, setNoteText] = useState("");
  const [noteObservationDate, setNoteObservationDate] = useState("");
  const [noteFiles, setNoteFiles] = useState<File[]>([]);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [mediaError, setMediaError] = useState("");
  const archiveSnapshot = readOnly ? row.archiveSnapshot : undefined;
  const viewRow = archiveSnapshot ? rowFromArchiveSnapshot(row, archiveSnapshot) : row;
  const husNotes = [...(viewRow.husNotes ?? [])].sort(
    (left, right) => (right.createdAt ?? "").localeCompare(left.createdAt ?? "") || (right.observationDate ?? "").localeCompare(left.observationDate ?? ""),
  );
  const husPhotos = viewRow.husPhotos ?? [];
  const totalSow = getTotalSow(viewRow);
  const materials = archiveSnapshot?.materials ?? printMaterialSummary(viewRow, printLanguage);
  const balance = archiveSnapshot?.plantBalance ?? calculatePlantBalance(viewRow);
  const worksheetDays = archiveSnapshot?.worksheetDays ?? generateWorksheetDaysFromWorkItems(viewRow, workItems);
  const displayedHusEvents = archiveSnapshot?.events ?? viewRow.husEvents ?? [];
  const chronologicalWorkItems = [...workItems].sort(
    (left, right) => left.date.localeCompare(right.date) || left.title.localeCompare(right.title, "lv"),
  );

  function saveHusEvents(entries: HusEventEntry[]) {
    const next = entries.reduce<Pick<SowingPlanRow, "husEvents" | "plantCorrections">>(
      (current, entry) => applyHusEventSave(current, entry),
      { husEvents: row.husEvents, plantCorrections: row.plantCorrections },
    );

    onUpdateRow(row.id, next);
  }

  function deleteHusEvent(entry: HusEventEntry) {
    if (readOnly) {
      return;
    }
    const linkedMessage = entry.plantCorrectionId
      ? printLanguage === "lv"
        ? " Saistītā stādu korekcija arī tiks dzēsta."
        : " The linked plant correction will also be deleted."
      : "";
    if (!window.confirm(`${printLanguage === "lv" ? "Dzēst HUS notikumu?" : "Delete HUS event?"}${linkedMessage}`)) {
      return;
    }

    onUpdateRow(row.id, applyHusEventDelete(row, entry.id));
  }

  function closeEventDialog() {
    setEventDialogOpen(false);
    setEditingEvent(null);
  }

  async function saveHusNote() {
    if (!noteText.trim() && noteFiles.length === 0) {
      setMediaError(printLanguage === "lv" ? "Pievieno piezīmi vai fotogrāfiju." : "Add a note or photo.");
      return;
    }

    setMediaBusy(true);
    setMediaError("");
    try {
      await onUploadHusMedia(row.id, {
        files: noteFiles,
        note: noteText,
        observationDate: noteObservationDate || undefined,
      });
      setNoteText("");
      setNoteObservationDate("");
      setNoteFiles([]);
    } catch (error) {
      setMediaError(error instanceof Error ? error.message : printLanguage === "lv" ? "Neizdevās saglabāt." : "Could not save.");
    } finally {
      setMediaBusy(false);
    }
  }

  async function saveEventPhotos(entry: HusEventEntry, files: File[]) {
    if (files.length === 0) {
      return;
    }

    setMediaBusy(true);
    setMediaError("");
    try {
      await onUploadHusMedia(row.id, { eventId: entry.id, files });
    } catch (error) {
      setMediaError(error instanceof Error ? error.message : printLanguage === "lv" ? "Neizdevās saglabāt foto." : "Could not save photo.");
    } finally {
      setMediaBusy(false);
    }
  }

  return (
    <section className="print-host">
      <div className="panel-header no-print">
        <div>
          <h2>{row.sectorName}</h2>
        </div>
        <div className="button-row">
          {!readOnly ? (
            <button className="secondary-action" type="button" onClick={onEdit}>
              {t("edit", printLanguage)}
            </button>
          ) : null}
          {!readOnly ? (
            <button
              className="secondary-action"
              type="button"
              onClick={() => {
                const note = window.prompt(
                  printLanguage === "lv"
                    ? `Arhivēt ${row.sectorName}? Piezīme (neobligāta):`
                    : `Archive ${row.sectorName}? Note (optional):`,
                  "",
                );
                if (note === null) {
                  return;
                }
                if (
                  window.confirm(
                    printLanguage === "lv"
                      ? `${viewRow.sectorName} tiks pārvietots uz arhīvu un vairs nebūs aktīvajā kalendārā. Turpināt?`
                      : `${viewRow.sectorName} will move to the archive and no longer appear in the active calendar. Continue?`,
                  )
                ) {
                  onArchive(row, note);
                }
              }}
            >
              {printLanguage === "lv" ? "Arhivēt" : "Archive"}
            </button>
          ) : (
            <button
              className="secondary-action"
              type="button"
              onClick={() => {
                if (window.confirm(printLanguage === "lv" ? `Atjaunot ${row.sectorName} aktīvajā plānā?` : `Restore ${row.sectorName} to the active plan?`)) {
                  onRestore(row);
                }
              }}
            >
              {printLanguage === "lv" ? "Atjaunot" : "Restore"}
            </button>
          )}
          <button className="primary-action" type="button" onClick={() => window.print()}>
            {t("print", printLanguage)}
          </button>
        </div>
      </div>

      <div className="segmented worksheet-tabs no-print" aria-label="Hus skats">
        <button
          className={activeWorksheetTab === "works" ? "is-active" : ""}
          onClick={() => setActiveWorksheetTab("works")}
          type="button"
        >
          {t("husInfo", printLanguage)}
        </button>
        <button
          className={activeWorksheetTab === "worksheet" ? "is-active" : ""}
          onClick={() => setActiveWorksheetTab("worksheet")}
          type="button"
        >
          {t("worksheet", printLanguage)}
        </button>
      </div>

      {activeWorksheetTab === "works" ? (
        <div className="panel hus-work-panel no-print">
          <section className="plant-balance-box">
            <div className="hus-info-heading">
              <div>
                <p className="eyebrow">{t("husInfo", printLanguage)}</p>
                <h3>{viewRow.sectorName}</h3>
                <span>{viewRow.variety}</span>
              </div>
              <strong className={balance.tone === "short" ? "danger-text" : ""}>{balance.label}</strong>
            </div>
            <div className="plant-balance-grid">
              <span>
                {t("greenhouseRequired", printLanguage)}:{" "}
                {balance.requiredPlants === null ? t("noTablesSet", printLanguage) : balance.requiredPlants.toLocaleString("lv-LV")}
              </span>
              <span>{t("agronomistSowing", printLanguage)}: {viewRow.requiredPlants.toLocaleString("lv-LV")}</span>
              <span>{t("extra", printLanguage)}: {signedNumber(viewRow.extraPlants)}</span>
              <span>{t("seededInitial", printLanguage)}: {balance.initialPlants.toLocaleString("lv-LV")}</span>
              <span>{printLanguage === "lv" ? "Zudumi/korekcijas" : "Losses/corrections"}: {signedNumber(balance.correctionTotal)}</span>
              <span>{t("currentActual", printLanguage)}: {balance.actualPlants.toLocaleString("lv-LV")}</span>
              <span>{formatReserveShortage(balance.difference, printLanguage)}</span>
              {row.archivedAt ? <span>{printLanguage === "lv" ? "Arhivēts" : "Archived"}: {dateLabel(row.archivedAt.slice(0, 10))}</span> : null}
              {row.archivedNote ? <span>{printLanguage === "lv" ? "Arhīva piezīme" : "Archive note"}: {row.archivedNote}</span> : null}
            </div>
          </section>
          <section className="hus-journal-box">
            <div className="hus-info-heading">
              <div>
                <p className="eyebrow">{t("husEvents", printLanguage)}</p>
                <h3>{printLanguage === "lv" ? "Notikumi" : "Events"}</h3>
              </div>
              {!readOnly ? (
                <button
                  className="secondary-action"
                  type="button"
                  onClick={() => {
                    setEditingEvent(null);
                    setEventDialogOpen(true);
                  }}
                >
                  {t("addEntry", printLanguage)}
                </button>
              ) : null}
            </div>
            {displayedHusEvents.length > 0 ? (
              <ul className="hus-journal-list">
                {displayedHusEvents.map((entry) => (
                  <li key={entry.id}>
                    <div className="hus-journal-list__date">
                      <time>{shortDate(entry.eventDate)}</time>
                      <span>{formatCycleDay(getCycleDay(viewRow, entry.eventDate), printLanguage)}</span>
                    </div>
                    <div className="hus-journal-list__body">
                      <strong>{husEventTypeTitle(entry.eventType, printLanguage)}</strong>
                      {entry.eventType === "move" && parseHusEventMovementRows(entry).length > 0 ? (
                        <div className="movement-lines">
                          {parseHusEventMovementRows(entry).map((movement, index) => (
                            <span key={`${entry.id}-movement-${index}`}>
                              {movement.from || "—"} → {movement.to || "—"}
                            </span>
                          ))}
                        </div>
                      ) : entry.location || entry.destinationLocation ? (
                        <span>
                          {entry.location || "—"}
                          {entry.destinationLocation ? ` → ${entry.destinationLocation}` : ""}
                        </span>
                      ) : null}
                      {typeof entry.plantChange === "number" && entry.plantChange !== 0 ? (
                        <em>{signedNumber(entry.plantChange)} {printLanguage === "lv" ? "stādi" : "plants"}</em>
                      ) : null}
                      {entry.note ? <p>{entry.note}</p> : null}
                      <HusPhotoStrip
                        onView={onViewPhoto}
                        photos={husPhotos.filter((photo) => photo.husEventId === entry.id)}
                      />
                      <label className="file-action file-action--small">
                        {printLanguage === "lv" ? "Pievienot foto" : "Add photo"}
                        <input
                          accept="image/jpeg,image/png"
                          disabled={mediaBusy}
                          multiple
                          onChange={(event) => {
                            const files = Array.from(event.target.files ?? []);
                            event.target.value = "";
                            void saveEventPhotos(entry, files);
                          }}
                          type="file"
                        />
                      </label>
                    </div>
                    <span className="button-row">
                      {isEditableHusEvent(entry) && !readOnly ? (
                        <button
                          className="secondary-action secondary-action--small"
                          type="button"
                          onClick={() => {
                            setEditingEvent(entry);
                            setEventDialogOpen(true);
                          }}
                        >
                          {t("edit", printLanguage)}
                        </button>
                      ) : null}
                      {!readOnly ? (
                        <button className="danger-action danger-action--small" type="button" onClick={() => deleteHusEvent(entry)}>
                          {t("delete", printLanguage)}
                        </button>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="empty-state">{t("noJournal", printLanguage)}</p>
            )}
          </section>
          <section className="hus-journal-box hus-media-box">
            <div className="hus-info-heading">
              <div>
                <p className="eyebrow">{printLanguage === "lv" ? "Piezīmes un fotogrāfijas" : "Notes and photos"}</p>
                <h3>{printLanguage === "lv" ? "Novērojumi" : "Observations"}</h3>
              </div>
            </div>
            <div className="hus-note-form">
              <label>
                {printLanguage === "lv" ? "Faktiskais datums" : "Observation date"}
                <input
                  type="date"
                  value={noteObservationDate}
                  onChange={(event) => setNoteObservationDate(event.target.value)}
                />
              </label>
              <label>
                {printLanguage === "lv" ? "Piezīme" : "Note"}
                <textarea
                  placeholder={printLanguage === "lv" ? "Brīva piezīme par šo Hus..." : "Free note for this Hus..."}
                  value={noteText}
                  onChange={(event) => setNoteText(event.target.value)}
                />
              </label>
              <label className="file-action">
                {printLanguage === "lv" ? "Pievienot fotogrāfijas" : "Add photos"}
                <input
                  accept="image/jpeg,image/png"
                  disabled={mediaBusy}
                  multiple
                  onChange={(event) => setNoteFiles(Array.from(event.target.files ?? []))}
                  type="file"
                />
              </label>
              {noteFiles.length > 0 ? (
                <span className="import-note">
                  {noteFiles.length} {printLanguage === "lv" ? "foto izvēlēti" : "photos selected"}
                </span>
              ) : null}
              <div className="button-row">
                <button className="primary-action" disabled={mediaBusy} type="button" onClick={() => void saveHusNote()}>
                  {t("save", printLanguage)}
                </button>
              </div>
              {mediaError ? <p className="dialog-error">{mediaError}</p> : null}
            </div>
            {husNotes.length > 0 ? (
              <ul className="hus-note-list">
                {husNotes.map((note) => (
                  <li key={note.id}>
                    <div>
                      <time>{note.observationDate ? shortDate(note.observationDate) : note.createdAt ? formatDateTime(note.createdAt) : "—"}</time>
                      {note.author ? <span>{note.author}</span> : null}
                    </div>
                    {note.note ? <p>{note.note}</p> : null}
                    <HusPhotoStrip onView={onViewPhoto} photos={note.photos ?? []} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="empty-state">{printLanguage === "lv" ? "Piezīmju vai fotogrāfiju vēl nav." : "No notes or photos yet."}</p>
            )}
          </section>
          <div className="work-list">
            {chronologicalWorkItems.map((item) => (
              <article className={`hus-work-row work-card--${item.color}`} key={item.id}>
                <time>{shortDate(item.date)}</time>
                <div>
                  <strong>{printWorkTitle(item.type, printLanguage)}</strong>
                  <span>
                    {formatCycleDay(item.cycleDay, printLanguage)} · {item.source === "manual" ? t("manual", printLanguage) : t("automatic", printLanguage)}
                  </span>
                  {localizedWorkDetails(item, viewRow, printLanguage).length > 0 ? (
                    <ul>
                      {localizedWorkDetails(item, viewRow, printLanguage).map((detail) => (
                        <li key={detail}>{detail}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
          {eventDialogOpen ? (
            <HusEventDialog
              entry={editingEvent}
              onCancel={closeEventDialog}
              onSave={(entries) => {
                saveHusEvents(entries);
                closeEventDialog();
              }}
              row={row}
            />
          ) : null}
        </div>
      ) : null}

      <article className={`print-page worksheet-page ${activeWorksheetTab === "worksheet" ? "" : "screen-hidden"}`}>
        <header className="worksheet-header">
          <h1 className="print-only-title">{viewRow.sectorName} · {printLabel(printLanguage, "worksheet")}</h1>
          <div className="worksheet-meta">
            <span><strong>{printLabel(printLanguage, "sowing")}:</strong> {shortDate(viewRow.sowingDate)}</span>
            <span><strong>{printLabel(printLanguage, "plants")}:</strong> {totalSow.toLocaleString("lv-LV")}</span>
            <span><strong>{printLabel(printLanguage, "variety")}:</strong> {viewRow.variety}</span>
            <span><strong>{printLabel(printLanguage, "planting")}:</strong> {shortDate(viewRow.harvestDate)}</span>
            <span><strong>{printLabel(printLanguage, "sowingTables")}:</strong> {materials.sowingTables}</span>
          </div>
          <div className="worksheet-needed">
            <strong>{printLabel(printLanguage, "needed")}</strong>
            <span>{printWorkTitle("sowing", printLanguage)}: {materials.sowing}</span>
            <span>{printLabel(printLanguage, "sowingTables")}: {materials.sowingTables}</span>
            <span>{printWorkTitle("thinning", printLanguage)}: {materials.thinning}</span>
            <span>{printWorkTitle("harvest", printLanguage)}: {materials.harvest}</span>
          </div>
        </header>

        <table className="worksheet-table">
          <thead>
            <tr>
              <th>{printLabel(printLanguage, "day")}</th>
              <th>{printLabel(printLanguage, "date")}</th>
              <th>Water min</th>
              <th>Temp</th>
              <th>Plants out</th>
              <th>{printLabel(printLanguage, "divWork")}</th>
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
                <td>{day.works.map((work) => printWorkTitle(work.type, printLanguage)).join(" + ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </article>
    </section>
  );
}

function rowFromArchiveSnapshot(row: SowingPlanRow, snapshot: ArchiveSnapshot): SowingPlanRow {
  const media = mergeSnapshotMedia(snapshot, row);

  return {
    ...row,
    adjustments: snapshot.workAdjustments,
    adjustmentSources: snapshot.workAdjustmentSources,
    archiveSnapshot: snapshot,
    archivedAt: row.archivedAt ?? snapshot.archivedAt,
    archivedNote: row.archivedNote ?? snapshot.archivedNote,
    cycleLength: snapshot.hus.cycleLength,
    extraPlants: snapshot.hus.extraPlants,
    greenhouseRequiredPlants: snapshot.hus.greenhouseRequiredPlants,
    harvestDate: snapshot.hus.harvestDate,
    husEvents: snapshot.events,
    husNotes: media.husNotes,
    husPhotos: media.husPhotos,
    id: snapshot.hus.id,
    placement: snapshot.tablePlacement,
    plantCorrections: snapshot.plantCorrections,
    requiredPlants: snapshot.hus.requiredPlants,
    sectorName: snapshot.hus.sectorName,
    sectorType: snapshot.hus.sectorType,
    sowingDate: snapshot.hus.sowingDate,
    sowingTables: snapshot.hus.sowingTables,
    status: snapshot.hus.status,
    variety: snapshot.hus.variety,
    weekNumber: snapshot.hus.weekNumber,
  };
}

function MonthlyPrintPlan({
  onStartChange,
  printLanguage,
  rows,
  startDate,
  workItems,
}: {
  onStartChange: (date: string) => void;
  printLanguage: AppLanguage;
  rows: SowingPlanRow[];
  startDate: string;
  workItems: WorkItem[];
}) {
  const items = localizedMonthlyPrintRows(
    workItems.filter((item) => item.date >= startDate),
    rows,
    printLanguage,
  );
  const groups = groupMonthlyPrintRowsIntoDateGroups(items);

  return (
    <section className="print-host">
      <div className="panel panel-header no-print">
        <div>
          <p className="eyebrow">{printLanguage === "lv" ? "Drukājams kopsavilkums" : "Printable summary"}</p>
          <h2>{t("workPlan", printLanguage)}</h2>
        </div>
        <div className="button-row month-controls">
          <label>
            {printLanguage === "lv" ? "Sākuma mēnesis" : "Start month"}
            <input
              type="month"
              value={monthInputValue(startDate)}
              onChange={(event) => onStartChange(`${event.target.value}-01`)}
            />
          </label>
          <button className="primary-action" type="button" onClick={() => window.print()}>
            {t("printWorkPlan", printLanguage)}
          </button>
        </div>
      </div>

      <article className="print-page month-page">
        <header className="month-print-header">
          <h1>{workPlanPrintTitle(items, printLanguage)}</h1>
          <p>{t("commonWorkPlanForAllHus", printLanguage)}</p>
        </header>
        <table className="month-print-table">
          <thead>
            <tr>
              <th>{printLabel(printLanguage, "date")}</th>
              <th>Hus</th>
              <th>{printLabel(printLanguage, "work")}</th>
              <th>{printLabel(printLanguage, "plants")}</th>
              <th>{printLabel(printLanguage, "notes")}</th>
            </tr>
          </thead>
          {groups.length === 0 ? (
            <tbody>
              <tr>
                <td colSpan={5}>
                  {printLanguage === "lv"
                    ? "No izvēlētā sākuma datuma nav ieplānotu darbu."
                    : "No work is planned from the selected start date."}
                </td>
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

function LanguageToggle({
  language,
  onChange,
}: {
  language: AppLanguage;
  onChange: (language: AppLanguage) => void;
}) {
  return (
    <div className="print-language-toggle">
      <span>{t("language", language)}:</span>
      <div className="segmented segmented--compact" aria-label={language === "lv" ? "Printa valoda" : "Print language"}>
        <button
          className={language === "lv" ? "is-active" : ""}
          onClick={() => onChange("lv")}
          type="button"
        >
          LV
        </button>
        <button
          className={language === "en" ? "is-active" : ""}
          onClick={() => onChange("en")}
          type="button"
        >
          EN
        </button>
      </div>
    </div>
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
  const language = useAppLanguage();
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
      <span>{t("seedingTables", language)}</span>
      <button className="sowing-tables__trigger" type="button" onClick={openDialog}>
        {savedLabel || (language === "lv" ? "Norādīt" : "Set")}
      </button>
      {open ? (
        <div className="dialog-backdrop" role="presentation">
          <section
            aria-modal="true"
            aria-label={language === "lv" ? "Izvēlēties sēšanas galdus" : "Choose seeding tables"}
            className="sowing-tables-dialog"
            role="dialog"
          >
            <div>
              <p className="eyebrow">{t("seedingTables", language)}</p>
              <h3>{t("selectTables", language)}</h3>
            </div>
            <div className="sowing-table-options" aria-label={language === "lv" ? "Sēšanas galdi A1 līdz A13" : "Seeding tables A1 to A13"}>
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
            <strong className="sowing-tables__preview">{draftLabel || t("noTablesSet", language)}</strong>
            <div className="button-row">
              <button className="secondary-action" type="button" onClick={cancelDialog}>
                {t("cancel", language)}
              </button>
              <button className="primary-action" type="button" onClick={saveDialog}>
                {t("save", language)}
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function isEditableHusEvent(entry: HusEventEntry): boolean {
  return entry.eventType === "move" || entry.eventType === "brownRoots" || entry.eventType === "other";
}

function editableHusEventType(type: HusEventType | undefined): "move" | "brownRoots" | "other" {
  return type === "move" || type === "brownRoots" || type === "other" ? type : "other";
}

type MovementDraftRow = {
  id: string;
  from: string;
  to: string;
};

type BrownRootsDraftRow = {
  id: string;
  location: string;
  amount: string;
};

function newDraftId(): string {
  return crypto.randomUUID();
}

function createMovementDraftRows(entry: HusEventEntry | null): MovementDraftRow[] {
  if (entry?.eventType !== "move") {
    return [{ id: newDraftId(), from: "", to: "" }];
  }

  const rows = parseHusEventMovementRows(entry).map((row) => ({ id: newDraftId(), from: row.from, to: row.to }));
  return rows.length > 0 ? rows : [{ id: newDraftId(), from: entry.location ?? "", to: entry.destinationLocation ?? "" }];
}

function createBrownRootsDraftRows(entry: HusEventEntry | null): BrownRootsDraftRow[] {
  if (entry?.eventType !== "brownRoots") {
    return [{ id: newDraftId(), location: "", amount: "" }];
  }

  return [
    {
      id: newDraftId(),
      location: entry.location ?? "",
      amount: typeof entry.plantChange === "number" && entry.plantChange !== 0 ? String(Math.abs(entry.plantChange)) : "0",
    },
  ];
}

function HusEventDialog({
  entry,
  onCancel,
  onSave,
  row,
}: {
  entry: HusEventEntry | null;
  onCancel: () => void;
  onSave: (entries: HusEventEntry[]) => void;
  row: SowingPlanRow;
}) {
  const language = useAppLanguage();
  const [eventDate, setEventDate] = useState(() => defaultHusEventDate(entry));
  const [eventType, setEventType] = useState<HusEventType>(() => editableHusEventType(entry?.eventType));
  const [movementRows, setMovementRows] = useState<MovementDraftRow[]>(() => createMovementDraftRows(entry));
  const [brownRootsRows, setBrownRootsRows] = useState<BrownRootsDraftRow[]>(() => createBrownRootsDraftRows(entry));
  const [moveLossAmount, setMoveLossAmount] = useState(() =>
    entry?.eventType === "move" && typeof entry.plantChange === "number" && entry.plantChange !== 0
      ? String(Math.abs(entry.plantChange))
      : "0",
  );
  const [otherLocation, setOtherLocation] = useState(entry?.eventType === "other" ? entry.location ?? "" : "");
  const [otherPlantChangeMode, setOtherPlantChangeMode] = useState<"none" | "loss" | "addition">(() => {
    if (entry?.eventType !== "other" || typeof entry.plantChange !== "number" || entry.plantChange === 0) {
      return "none";
    }

    return entry.plantChange < 0 ? "loss" : "addition";
  });
  const [otherPlantChangeAmount, setOtherPlantChangeAmount] = useState(() =>
    entry?.eventType === "other" && typeof entry.plantChange === "number" && entry.plantChange !== 0
      ? String(Math.abs(entry.plantChange))
      : "",
  );
  const [note, setNote] = useState(entry?.note ?? "");
  const parsedMoveLossAmount = moveLossAmount.trim() === "" ? undefined : Number(moveLossAmount);
  const parsedOtherAmount = otherPlantChangeAmount.trim() === "" ? undefined : Number(otherPlantChangeAmount);
  const cycleDay = eventDate ? getCycleDay(row, eventDate) : 0;
  const maxCycleDay = getBiologicalCycleDays(row);
  const dateOutsideCycle = Boolean(eventDate) && (cycleDay < 1 || cycleDay > maxCycleDay);
  const needsNote = eventType === "other";
  const cleanedMovementRows = movementRows.map((draft) => ({ from: draft.from.trim(), to: draft.to.trim() }));
  const validMovementRows = cleanedMovementRows.filter((draft) => draft.from || draft.to);
  const movementRowsComplete = validMovementRows.length > 0 && validMovementRows.every((draft) => draft.from && draft.to);
  const cleanedBrownRootsRows = brownRootsRows.map((draft) => ({
    location: draft.location.trim(),
    amount: draft.amount.trim() === "" ? undefined : Number(draft.amount),
  }));
  const validBrownRootsRows = cleanedBrownRootsRows.filter((draft) => draft.location || draft.amount !== undefined);
  const brownRootsRowsComplete =
    validBrownRootsRows.length > 0 &&
    validBrownRootsRows.every(
      (draft) => draft.location && draft.amount !== undefined && Number.isInteger(draft.amount) && draft.amount >= 0,
    );
  const moveLossValid =
    parsedMoveLossAmount !== undefined &&
    Number.isFinite(parsedMoveLossAmount) &&
    Number.isInteger(parsedMoveLossAmount) &&
    parsedMoveLossAmount >= 0;
  const otherAmountValid =
    otherPlantChangeMode === "none" ||
    (parsedOtherAmount !== undefined && Number.isFinite(parsedOtherAmount) && Number.isInteger(parsedOtherAmount) && parsedOtherAmount > 0);
  const otherPlantChange =
    otherPlantChangeMode === "none" || parsedOtherAmount === undefined
      ? undefined
      : otherPlantChangeMode === "loss"
        ? -Math.trunc(parsedOtherAmount)
        : Math.trunc(parsedOtherAmount);
  const movePlantChange =
    eventType === "move" && Number.isFinite(parsedMoveLossAmount) && parsedMoveLossAmount !== undefined && parsedMoveLossAmount > 0
      ? -Math.trunc(parsedMoveLossAmount)
      : undefined;
  const canSave =
    Boolean(eventDate) &&
    !dateOutsideCycle &&
    (eventType !== "move" || (movementRowsComplete && moveLossValid)) &&
    (eventType !== "brownRoots" || brownRootsRowsComplete) &&
    (!needsNote || note.trim().length > 0) &&
    otherAmountValid;

  function updateMovementRow(id: string, patch: Partial<MovementDraftRow>) {
    setMovementRows((current) => current.map((draft) => (draft.id === id ? { ...draft, ...patch } : draft)));
  }

  function updateBrownRootsRow(id: string, patch: Partial<BrownRootsDraftRow>) {
    setBrownRootsRows((current) => current.map((draft) => (draft.id === id ? { ...draft, ...patch } : draft)));
  }

  function numericValue(value: string): string {
    return value.replace(/\D/g, "");
  }

  function saveEntries() {
    if (eventType === "move") {
      const locations = serializeHusEventMovementRows(validMovementRows);
      onSave([
        {
          id: entry?.eventType === "move" ? entry.id : crypto.randomUUID(),
          eventDate,
          eventType,
          location: locations.location,
          destinationLocation: locations.destinationLocation,
          plantChange: movePlantChange,
          plantCorrectionId: entry?.eventType === "move" ? entry.plantCorrectionId : undefined,
          note: note.trim() || undefined,
          createdAt: entry?.eventType === "move" ? entry.createdAt : undefined,
          updatedAt: entry?.eventType === "move" ? entry.updatedAt : undefined,
        },
      ]);
      return;
    }

    if (eventType === "brownRoots") {
      onSave(
        validBrownRootsRows.map((draft, index) => ({
          id: entry?.eventType === "brownRoots" && index === 0 ? entry.id : crypto.randomUUID(),
          eventDate,
          eventType,
          location: draft.location,
          plantChange: draft.amount && draft.amount > 0 ? -Math.trunc(draft.amount) : undefined,
          plantCorrectionId: entry?.eventType === "brownRoots" && index === 0 ? entry.plantCorrectionId : undefined,
          note: note.trim() || undefined,
          createdAt: entry?.eventType === "brownRoots" && index === 0 ? entry.createdAt : undefined,
          updatedAt: entry?.eventType === "brownRoots" && index === 0 ? entry.updatedAt : undefined,
        })),
      );
      return;
    }

    onSave([
      {
        id: entry?.eventType === "other" ? entry.id : crypto.randomUUID(),
        eventDate,
        eventType,
        location: otherLocation.trim() || undefined,
        plantChange: otherPlantChange,
        plantCorrectionId: entry?.eventType === "other" ? entry.plantCorrectionId : undefined,
        note: note.trim() || undefined,
        createdAt: entry?.eventType === "other" ? entry.createdAt : undefined,
        updatedAt: entry?.eventType === "other" ? entry.updatedAt : undefined,
      },
    ]);
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section aria-modal="true" aria-label={t("husEvents", language)} className="sowing-tables-dialog" role="dialog">
        <div>
          <p className="eyebrow">{t("husEvents", language)}</p>
          <h3>{entry ? t("editEntry", language) : t("addEntry", language)}</h3>
          <span className="dialog-hint">
            {eventDate ? `${shortDate(eventDate)} · ${formatCycleDay(getCycleDay(row, eventDate), language)}` : t("chooseDate", language)}
          </span>
          {dateOutsideCycle ? (
            <span className="dialog-error">
              {language === "lv"
                ? `Datums ir ārpus HUS cikla (${formatCycleDay(1, language)}–${formatCycleDay(maxCycleDay, language)}).`
                : `Date is outside the Hus cycle (${formatCycleDay(1, language)}-${formatCycleDay(maxCycleDay, language)}).`}
            </span>
          ) : null}
        </div>
        <label>
          {t("date", language)}
          <input autoFocus type="date" value={eventDate} onChange={(event) => setEventDate(event.target.value)} />
        </label>
        <div className="segmented segmented--compact hus-event-type-picker" aria-label={language === "lv" ? "Notikuma veids" : "Event type"}>
          {(["move", "brownRoots", "other"] as const).map((type) => (
            <button
              className={eventType === type ? "is-active" : ""}
              key={type}
              onClick={() => {
                setEventType(type);
              }}
              type="button"
            >
              {husEventTypeTitle(type, language)}
            </button>
          ))}
        </div>
        {eventType === "move" ? (
          <div className="event-lines">
            <strong>{language === "lv" ? "Pārvietošanas rindas" : "Movement rows"}</strong>
            {movementRows.map((draft) => (
              <div className="event-line-grid event-line-grid--movement" key={draft.id}>
                <label>
                  {language === "lv" ? "No galda" : "From table"}
                  <input maxLength={40} placeholder="A7" value={draft.from} onChange={(event) => updateMovementRow(draft.id, { from: event.target.value })} />
                </label>
                <label>
                  {language === "lv" ? "Uz galdiem" : "To tables"}
                  <input maxLength={80} placeholder="C1-C10" value={draft.to} onChange={(event) => updateMovementRow(draft.id, { to: event.target.value })} />
                </label>
                <button
                  className="danger-action danger-action--small"
                  disabled={movementRows.length === 1}
                  type="button"
                  onClick={() => setMovementRows((current) => current.filter((row) => row.id !== draft.id))}
                >
                  {t("delete", language)}
                </button>
              </div>
            ))}
            <button
              className="secondary-action"
              type="button"
              onClick={() => setMovementRows((current) => [...current, { id: newDraftId(), from: "", to: "" }])}
            >
              + {language === "lv" ? "Pievienot galdu" : "Add table"}
            </button>
            <label>
              {language === "lv" ? "Kopā izņemtie stādi no visa HUS" : "Total removed plants from this Hus"}
              <input inputMode="numeric" pattern="[0-9]*" placeholder="0" type="text" value={moveLossAmount} onChange={(event) => setMoveLossAmount(numericValue(event.target.value))} />
            </label>
          </div>
        ) : null}
        {eventType === "brownRoots" ? (
          <div className="event-lines">
            <strong>{language === "lv" ? "Bojātie galdi" : "Damaged tables"}</strong>
            {brownRootsRows.map((draft) => (
              <div className="event-line-grid event-line-grid--roots" key={draft.id}>
                <label>
                  {language === "lv" ? "Galds" : "Table"}
                  <input maxLength={40} placeholder="C7" value={draft.location} onChange={(event) => updateBrownRootsRow(draft.id, { location: event.target.value })} />
                </label>
                <label>
                  {language === "lv" ? "Bojātie stādi" : "Damaged plants"}
                  <input inputMode="numeric" pattern="[0-9]*" placeholder="0" type="text" value={draft.amount} onChange={(event) => updateBrownRootsRow(draft.id, { amount: numericValue(event.target.value) })} />
                </label>
                <button
                  className="danger-action danger-action--small"
                  disabled={brownRootsRows.length === 1}
                  type="button"
                  onClick={() => setBrownRootsRows((current) => current.filter((row) => row.id !== draft.id))}
                >
                  {t("delete", language)}
                </button>
              </div>
            ))}
            <button
              className="secondary-action"
              type="button"
              onClick={() => setBrownRootsRows((current) => [...current, { id: newDraftId(), location: "", amount: "" }])}
            >
              + {language === "lv" ? "Pievienot galdu" : "Add table"}
            </button>
            <strong>
              {language === "lv" ? "Kopā bojāti" : "Total damaged"}:{" "}
              {validBrownRootsRows.reduce((sum, draft) => sum + (typeof draft.amount === "number" && draft.amount > 0 ? draft.amount : 0), 0)}{" "}
              {language === "lv" ? "stādi" : "plants"}
            </strong>
          </div>
        ) : null}
        {eventType === "other" ? (
          <div className="event-lines">
            <label>
              {language === "lv" ? "Galds / vieta" : "Table / location"}
              <input maxLength={80} placeholder="C6" value={otherLocation} onChange={(event) => setOtherLocation(event.target.value)} />
            </label>
            <div className="plant-change-field">
              {t("plantChange", language)}
              <div className="segmented segmented--compact plant-change-mode" aria-label={language === "lv" ? "Stādu izmaiņas veids" : "Plant change type"}>
                <button className={otherPlantChangeMode === "none" ? "is-active" : ""} onClick={() => setOtherPlantChangeMode("none")} type="button">
                  {language === "lv" ? "Nav" : "None"}
                </button>
                <button className={otherPlantChangeMode === "loss" ? "is-active" : ""} onClick={() => setOtherPlantChangeMode("loss")} type="button">
                  − {language === "lv" ? "Zudums" : "Loss"}
                </button>
                <button className={otherPlantChangeMode === "addition" ? "is-active" : ""} onClick={() => setOtherPlantChangeMode("addition")} type="button">
                  + {language === "lv" ? "Papildinājums" : "Addition"}
                </button>
              </div>
            </div>
            {otherPlantChangeMode !== "none" ? (
              <label>
                {t("amount", language)}
                <input inputMode="numeric" pattern="[0-9]*" placeholder="20" type="text" value={otherPlantChangeAmount} onChange={(event) => setOtherPlantChangeAmount(numericValue(event.target.value))} />
              </label>
            ) : null}
          </div>
        ) : null}
        <label>
          {t("notes", language)}
          <textarea maxLength={240} rows={3} value={note} onChange={(event) => setNote(event.target.value)} />
        </label>
        <div className="button-row">
          <button className="secondary-action" type="button" onClick={onCancel}>
            {t("cancel", language)}
          </button>
          <button
            className="primary-action"
            disabled={!canSave}
            type="button"
            onClick={saveEntries}
          >
            {t("save", language)}
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
  const language = useAppLanguage();
  const value = candidate.fields[field];

  return (
    <label className={value.needsReview ? "needs-review" : ""}>
      <input
        min={type === "number" ? "1" : undefined}
        onChange={(event) => onChange(candidate.id, field, event.target.value)}
        type={type}
        value={value.value === null || value.value === undefined ? "" : String(value.value)}
      />
      {value.needsReview ? <small>{language === "lv" ? "Pārbaudi" : "Review"} ({Math.round(value.confidence * 100)}%)</small> : null}
    </label>
  );
}

function fieldWarnings(candidate: PlanImportCandidate, language: AppLanguage): string[] {
  return Object.entries(candidate.fields)
    .filter(([, field]) => field.needsReview)
    .map(([key, field]) =>
      language === "lv"
        ? `${importFieldLabel(key as ImportFieldKey, language)} jāpārbauda (${Math.round(field.confidence * 100)}%).`
        : `${importFieldLabel(key as ImportFieldKey, language)} needs review (${Math.round(field.confidence * 100)}%).`,
    );
}

function importFieldLabel(field: ImportFieldKey, language: AppLanguage): string {
  const labels: Record<AppLanguage, Record<ImportFieldKey, string>> = {
    en: {
      extraPlants: "Reserve",
      greenhouseRequiredPlants: "Greenhouse required",
      harvestDate: "Planting",
      requiredPlants: "Agronomist sowing",
      sectorName: "Hus",
      sowingDate: "Seeding",
      variety: "Variety",
      weekNumber: "Week",
    },
    lv: {
      extraPlants: "Rezerve",
      greenhouseRequiredPlants: "Siltumnīcai nepieciešams",
      harvestDate: "Izvākšana",
      requiredPlants: "Agronoma sējamais",
      sectorName: "Hus",
      sowingDate: "Sēšana",
      variety: "Šķirne",
      weekNumber: "Nedēļa",
    },
  };

  return labels[language][field];
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
  const language = useAppLanguage();
  const rangeDays = calendarDays.filter((day) => day.inCurrentRange);

  return (
    <div className="panel calendar-panel no-print">
      <div className="panel-header">
        <div>
          <p className="eyebrow">{t("commonCalendar", language)}</p>
          <h2>{calendarTitle(anchorDate, viewMode, language)}</h2>
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
            {t("today", language)}
          </button>
          <button type="button" onClick={() => onSetAnchorDate(shiftAnchor(anchorDate, viewMode, 1))}>
            →
          </button>
          <details className="calendar-actions">
            <summary>{t("planActions", language)}</summary>
            <div>
              <button type="button" onClick={onRecalculatePlan}>
                {t("recalculatePlan", language)}
              </button>
              <button type="button" onClick={onPreviewBalance}>
                {language === "lv" ? "Izlīdzināt darbus" : "Balance work"}
              </button>
              <button type="button" onClick={() => window.print()}>
                {t("printWorkPlan", language)}
              </button>
            </div>
          </details>
        </div>
      </div>

      {balancePreview ? (
        <BalancePreview proposals={balancePreview} onApply={onApplyBalance} onCancel={onCancelBalance} />
      ) : null}

      <div className="segmented calendar-view-toggle" aria-label={t("calendarViewMode", language)}>
        {viewModes.map((mode) => (
          <button
            className={viewMode === mode.id ? "is-active" : ""}
            key={mode.id}
            onClick={() => onSetViewMode(mode.id)}
            type="button"
          >
            {mode.label[language]}
          </button>
        ))}
      </div>

      {viewMode === "month" ? (
        <div className="calendar-grid">
          {weekdayLabelsByLanguage[language].map((day, index) => (
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
                      {calendarItemLabel(item, language)}
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
              .sort((a, b) => printWorkTitle(a.type, language).localeCompare(printWorkTitle(b.type, language), "lv") || a.sectorName.localeCompare(b.sectorName, "lv"));
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
                  <span>{weekdayName(day.isoDate, language)}</span>
                </span>
                <span className="agenda-day__items">
                  {dayItems.length === 0 ? <span className="empty-state">{t("noWork", language)}</span> : null}
                  {dayItems.map((item) => (
                    <span className={`agenda-work work-chip--${item.color}`} key={item.id}>
                      <strong>{printWorkTitle(item.type, language)}</strong>
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
  rows,
  selectedDate,
}: {
  errors: Record<string, string>;
  items: WorkItem[];
  onMove: (item: WorkItem, date: string) => void;
  onMoveRange: (item: WorkItem, startDate: string, endDate: string) => void;
  rows: SowingPlanRow[];
  selectedDate: string;
}) {
  const language = useAppLanguage();
  const rowsById = new Map(rows.map((row) => [row.id, row]));

  return (
    <aside className="panel side-panel no-print">
      <div className="panel-header">
        <div>
          <p className="eyebrow">{t("dayWork", language)}</p>
          <h2>{dateLabel(selectedDate)}</h2>
        </div>
        {countMainWork(items, selectedDate) > 1 ? <span className="overload-badge">{t("overload", language)}</span> : null}
      </div>
      <div className="work-list">
        {items.length === 0 ? <p className="empty-state">{language === "lv" ? "Šajā dienā nav ieplānotu darbu." : "No work is planned for this day."}</p> : null}
        {items.map((item) => (
          <WorkItemCard errors={errors} item={item} key={item.id} onMove={onMove} onMoveRange={onMoveRange} row={rowsById.get(item.planRowId)} />
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
  const language = useAppLanguage();

  return (
    <section className="balance-preview">
      <div>
        <strong>{t("balancePreview", language)}</strong>
        <p>
          {proposals.length === 0
            ? t("noBetterBalance", language)
            : t("scheduleWillSaveAfterConfirm", language)}
        </p>
      </div>
      {proposals.length > 0 ? (
        <ul>
          {proposals.map((proposal) => (
            <li key={`${proposal.planRowId}-${proposal.type}`}>
              {printWorkTitle(proposal.type, language)} {proposal.sectorName}: {formatDateRange(proposal.fromDates)} →{" "}
              {formatDateRange(proposal.toDates)}
              {proposal.warning ? <strong> {proposal.warning}</strong> : null}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="button-row">
        <button className="primary-action" disabled={proposals.length === 0} type="button" onClick={onApply}>
          {t("confirm", language)}
        </button>
        <button className="secondary-action" type="button" onClick={onCancel}>
          {t("cancel", language)}
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
  const language = useAppLanguage();
  const snapshot = buildGreenhouseSnapshot(rows, date);

  return (
    <section className="panel greenhouse-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">{t("greenhouseCapacity", language)}</p>
          <h2>{t("greenhouse", language)}</h2>
        </div>
        <label className="inline-date greenhouse-date">
          {t("date", language)}
          <input type="date" value={date} onChange={(event) => onDateChange(event.target.value)} />
        </label>
      </div>

      <div className="greenhouse-stats">
        <strong>{language === "lv" ? "Standarta kapacitāte" : "Standard capacity"}: {snapshot.standardUsed}/78 {language === "lv" ? "galdi aizņemti" : "tables occupied"}</strong>
        <strong>{language === "lv" ? "Papildu" : "Extra"}: {snapshot.extraUsed}/13</strong>
      </div>

      <div className="greenhouse-grid">
        {snapshot.rows.map((row) => (
          <article className="greenhouse-row" key={row.rowId}>
            <div>
              <strong>{row.label}</strong>
              <span>{row.usedTables}/{row.capacity} {t("tables", language).toLowerCase()}</span>
            </div>
            {row.assignment ? (
              <p>
                {row.assignment.sectorName} — {language === "lv" ? "līdz" : "until"} {dateLabel(row.assignment.harvestDate)} —
                {" "}
                {row.assignment.averagePlantsPerGutter.toFixed(1)} {language === "lv" ? "stādi/renē" : "plants/trough"}
              </p>
            ) : (
              <p>{language === "lv" ? "Brīva" : "Free"}</p>
            )}
          </article>
        ))}
      </div>

      {snapshot.conflicts.map((conflict) => (
        <div className="capacity-warning" key={`${conflict.date}-${conflict.totalTables}`}>
          <strong>⚠️ {language === "lv" ? `Šajā periodā vienlaikus stādu mājā būs ${conflict.overlapping.length} Hus cikli.` : `${conflict.overlapping.length} Hus cycles are in the greenhouse at the same time in this period.`}</strong>
          <span>{language === "lv" ? `Kopā nepieciešami ${conflict.totalTables} galdi; standarta kapacitāte 78, kopā ar papildu rindu 91.` : `${conflict.totalTables} tables required; standard capacity is 78, or 91 with the extra row.`}</span>
          <span>{conflict.extraCanCover ? (language === "lv" ? "13 papildu galdi var nosegt pārklāšanos." : "13 extra tables can cover the overlap.") : language === "lv" ? `Deficīts: ${conflict.deficit} galdi.` : `Deficit: ${conflict.deficit} tables.`}</span>
          <ul>
            {conflict.overlapping.map((item) => (
              <li key={item.planRowId}>{item.sectorName}: {item.tables} {t("tables", language).toLowerCase()}</li>
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
  row,
}: {
  errors: Record<string, string>;
  item: WorkItem;
  onMove: (item: WorkItem, date: string) => void;
  onMoveRange: (item: WorkItem, startDate: string, endDate: string) => void;
  row?: SowingPlanRow;
}) {
  const language = useAppLanguage();
  const workDates = item.scheduleKind === "flexible" ? flexibleItemDates(item) : [item.date];
  const rangeStart = workDates[0] ?? item.date;
  const rangeEnd = workDates.at(-1) ?? item.date;
  const details = localizedWorkDetails(item, row, language);

  return (
    <article className={`work-card work-card--${item.color}`}>
      <div>
        <strong>{printWorkTitle(item.type, language)}</strong>
        <span>
          {item.sectorName} · {formatPlants(item.plantCount, language)} · {formatCycleDay(item.cycleDay, language)}
        </span>
      </div>
      <ul>
        {details.map((detail) => (
          <li key={detail}>{detail}</li>
        ))}
      </ul>
      {item.fixed ? (
        <small>{t("fixedDate", language)}</small>
      ) : item.scheduleKind === "flexible" ? (
        <div className="range-fields">
          <label className="inline-date">
            {language === "lv" ? "No" : "From"}
            <input
              max={item.allowedDateRange?.end}
              min={item.allowedDateRange?.start}
              onChange={(event) => onMoveRange(item, event.target.value, rangeEnd)}
              type="date"
              value={rangeStart}
            />
          </label>
          <label className="inline-date">
            {language === "lv" ? "Līdz" : "To"}
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
          {t("move", language)}
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

function HusList({
  mode,
  onModeChange,
  onOpen,
  rows,
}: {
  mode: "active" | "archive";
  onModeChange: (mode: "active" | "archive") => void;
  onOpen: (id: string) => void;
  rows: SowingPlanRow[];
}) {
  const language = useAppLanguage();
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
      cycles: group.slice().sort((a, b) =>
        mode === "archive"
          ? (b.archivedAt ?? "").localeCompare(a.archivedAt ?? "")
          : b.sowingDate.localeCompare(a.sowingDate),
      ),
    }))
    .sort((a, b) =>
      mode === "archive"
        ? (b.cycles[0].archivedAt ?? "").localeCompare(a.cycles[0].archivedAt ?? "") ||
          a.sectorName.localeCompare(b.sectorName, "lv", { numeric: true })
        : compareSowingRowsByDate(a.cycles[0], b.cycles[0]),
    );

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
                    {row.variety} · {dateLabel(row.sowingDate)} - {dateLabel(row.harvestDate)}
                  </small>
                </span>
                <span>{formatPlants(totalSow, language)}</span>
                <span>{formatCycleDays(row.cycleLength, language)}</span>
                {mode === "archive" ? (
                  <span>
                    {language === "lv" ? "Arhivēts" : "Archived"} {row.archivedAt ? shortDate(row.archivedAt.slice(0, 10)) : "—"} ·{" "}
                    {language === "lv" ? "Faktiski" : "Actual"} {formatPlants(balance.actualPlants, language)}
                  </span>
                ) : null}
                <span>{t("openWorksheet", language)}</span>
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
  const language = useAppLanguage();
  const totalSow = getTotalSow(row);
  const availability = calculateAvailability(row);
  const placement = createPlacementPlan(row, rows);
  const boxPlan = calculateBoxPlan(row);

  return (
    <section className="panel form-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">{t("husData", language)}</p>
          <h2>{row.sectorName}</h2>
        </div>
      </div>
      <label>
        {language === "lv" ? "Sektors" : "Sector"}
        <input value={row.sectorName} onChange={(event) => onUpdateRow(row.id, { sectorName: event.target.value })} />
      </label>
      <label>
        {t("variety", language)}
        <input value={row.variety} onChange={(event) => onUpdateRow(row.id, { variety: event.target.value })} />
      </label>
      <SowingTablesPicker
        key={`${row.id}-${row.sowingTables ?? ""}`}
        value={row.sowingTables ?? ""}
        onSave={(value) => onUpdateRow(row.id, { sowingTables: value || undefined })}
      />
      <label>
        {t("weekNumber", language)}
        <input
          min="1"
          type="number"
          value={row.weekNumber ?? getIsoWeek(row.sowingDate)}
          onChange={(event) => onUpdateRow(row.id, { weekNumber: Number(event.target.value) })}
        />
      </label>
      <label>
        {t("status", language)}
        <select
          value={row.status ?? "planned"}
          onChange={(event) => onUpdateRow(row.id, { status: event.target.value as SowingPlanRow["status"] })}
        >
          <option value="planned">{language === "lv" ? "Plānots" : "Planned"}</option>
          <option value="imported">{language === "lv" ? "Importēts" : "Imported"}</option>
          <option value="active">{language === "lv" ? "Aktīvs" : "Active"}</option>
          <option value="done">{t("done", language)}</option>
        </select>
      </label>
      <label>
        {t("greenhouseRequired", language)}
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
        {t("agronomistSowing", language)}
        <input
          min="1"
          type="number"
          value={row.requiredPlants}
          onChange={(event) => onUpdateRow(row.id, { requiredPlants: Number(event.target.value) })}
        />
      </label>
      <label>
        {language === "lv" ? "Darbinieka extra" : "Worker extra"}
        <input
          type="number"
          value={row.extraPlants}
          onChange={(event) => onUpdateRow(row.id, { extraPlants: Number(event.target.value) })}
        />
      </label>
      <div className="metric-inline">
        <span>{t("totalSow", language)}</span>
        <strong>{totalSow.toLocaleString("lv-LV")}</strong>
      </div>
      <label>
        {t("seedingDate", language)}
        <input type="date" value={row.sowingDate} onChange={(event) => onUpdateDate(row, "sowingDate", event.target.value)} />
      </label>
      <label>
        {t("moveOutDate", language)}
        <input type="date" value={row.harvestDate} onChange={(event) => onUpdateDate(row, "harvestDate", event.target.value)} />
      </label>
      <label>
        {language === "lv" ? "Previcure datums" : "Previcur date"}
        <input
          type="date"
          value={row.previcureDate ?? ""}
          onChange={(event) => onUpdateRow(row.id, { previcureDate: event.target.value || undefined })}
        />
      </label>
      <label>
        {t("cycleLength", language)}
        <input
          min="1"
          type="number"
          value={row.cycleLength}
          onChange={(event) => onUpdateCycleLength(row, Number(event.target.value))}
        />
      </label>
      <label>
        {t("sectorTables", language)}
        <select
          value={row.sectorType}
          onChange={(event) => onUpdateRow(row.id, { sectorType: Number(event.target.value) as SectorType })}
        >
          <option value={26}>26 {t("tables", language).toLowerCase()}</option>
          <option value={39}>39 {t("tables", language).toLowerCase()}</option>
        </select>
      </label>
      <div className={`availability availability--${availability.tone}`}>
        <span>{language === "lv" ? "Faktiski pieejams" : "Actually available"}: {availability.availablePlants.toLocaleString("lv-LV")}</span>
        <strong>{availability.label}</strong>
      </div>
      <section className="placement-box">
        <div>
          <p className="eyebrow">{language === "lv" ? "Izvietojums pēc retināšanas" : "Placement after moving"}</p>
          <strong>{placement.label}</strong>
        </div>
        <span>{t("total", language)} {t("plants", language).toLowerCase()}: {totalSow.toLocaleString("lv-LV")}</span>
        <span>{printWorkTitle("thinning", language)}: {dateLabel(placement.thinningDate)}</span>
        <span>{language === "lv" ? "Renes" : "Troughs"}: {placement.gutters}</span>
        <span>{language === "lv" ? "Vidēji" : "Average"}: {placement.averagePlantsPerGutter.toFixed(2)} {language === "lv" ? "stādi/renē" : "plants/trough"}</span>
        <span>{language === "lv" ? "Kastītes" : "Boxes"}: {language === "lv" ? boxPlan.label : formatPrintHarvestBoxes(row, language)}</span>
        <label>
          {language === "lv" ? "Rinda" : "Row"}
          <select
            value={placement.primaryRow ?? ""}
            onChange={(event) =>
              onUpdatePlacement(row, { primaryRow: event.target.value as NonNullable<SowingPlanRow["placement"]>["primaryRow"] })
            }
          >
            <option value="">{t("automatic", language)}</option>
            {greenhouseRows.map((greenhouseRow) => (
              <option key={greenhouseRow.id} value={greenhouseRow.id}>{greenhouseRow.id}</option>
            ))}
          </select>
        </label>
        <label>
          {language === "lv" ? "Izmantoti galdi" : "Tables used"}
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
          <p className="eyebrow">{t("changeHistory", language)}</p>
          <strong>{row.changeHistory?.length ?? 0} {language === "lv" ? "ieraksti" : "entries"}</strong>
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
          <p>{language === "lv" ? "Šim Hus vēl nav reģistrētu labojumu." : "This Hus has no registered changes yet."}</p>
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
  const language = useAppLanguage();
  const totalSow = getTotalSow(row);
  const sowing = calculateSowingPlan(totalSow);
  const thinning = calculateThinningPlan(totalSow, row.sectorType);
  const availability = calculateAvailability(row);

  return (
    <section className="panel timeline-panel">
      <div className="panel-header">
        <div>
          <p className="eyebrow">{t("workCycle", language)}</p>
          <h2>{language === "lv" ? "Laika līnija" : "Timeline"}</h2>
        </div>
        <div className="button-row no-print">
          <button className="secondary-action" type="button" onClick={onOpenWorksheet}>
            {t("openWorksheet", language)}
          </button>
        </div>
      </div>
      <div className="summary-strip">
        <span>{language === "lv" ? sowing.label : formatPrintSowingPlan(totalSow, language)}</span>
        <span>{language === "lv" ? thinning.label : formatPrintThinningPlan(row, language)}</span>
        <span>{row.cycleLength} {language === "lv" ? "dienu cikls" : "day cycle"}</span>
        <span>{availability.label}</span>
      </div>
      <div className="timeline">
        {items.map((item) => (
          <div className="timeline-item" key={item.id}>
            <time>{dateLabel(item.date)}</time>
            <WorkItemCard errors={errors} item={item} onMove={onMove} onMoveRange={onMoveRange} row={row} />
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

function sanitizeAdjustmentSources(row: SowingPlanRow): SowingPlanRow["adjustmentSources"] {
  const entries = Object.entries(row.adjustmentSources ?? {}).filter(([key]) => {
    const value = row.adjustments?.[key as keyof NonNullable<SowingPlanRow["adjustments"]>];
    return Array.isArray(value) ? value.length > 0 : Boolean(value);
  });

  return entries.length > 0 ? (Object.fromEntries(entries) as SowingPlanRow["adjustmentSources"]) : undefined;
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

function calendarTitle(anchorDate: string, viewMode: ViewMode, language: AppLanguage): string {
  const days = getCalendarDays(anchorDate, viewMode).filter((day) => day.inCurrentRange);
  if (viewMode === "month") {
    return new Intl.DateTimeFormat(language === "lv" ? "lv-LV" : "en-GB", { month: "long", year: "numeric" }).format(
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

async function fetchSowingPlanDocument(): Promise<SowingPlanDocument | null> {
  const response = await fetch("/api/sowing-plan-document");
  const result = (await response.json().catch(() => null)) as { document?: SowingPlanDocument | null; error?: string } | null;

  if (!response.ok) {
    throw new Error(result?.error ?? "Neizdevās ielādēt sēšanas plāna failu.");
  }

  return result?.document ?? null;
}

function planDocumentFileUrl(document: SowingPlanDocument): string {
  const version = encodeURIComponent(document.updatedAt ?? document.createdAt ?? document.id);
  return `/api/sowing-plan-document/file?v=${version}`;
}

function husPhotoFileUrl(photo: HusPhotoEntry): string {
  const version = encodeURIComponent(photo.createdAt ?? photo.id);
  return `/api/hus-media/photo/${photo.id}?v=${version}`;
}

async function prepareHusPhotoFiles(files: File[]): Promise<File[]> {
  const compressed: File[] = [];
  for (const file of files) {
    compressed.push(await compressHusPhotoForUpload(file));
  }
  return compressed;
}

function mergeHusMedia(row: SowingPlanRow, note: HusNoteEntry | undefined, photos: HusPhotoEntry[]): SowingPlanRow {
  const nextPhotos = upsertById([...(row.husPhotos ?? []), ...photos]);
  const nextNotes = note ? upsertById([...(row.husNotes ?? []), { ...note, photos: photos.filter((photo) => photo.husNoteId === note.id) }]) : row.husNotes;

  return {
    ...row,
    husNotes: nextNotes,
    husPhotos: nextPhotos,
  };
}

function removeHusPhoto(row: SowingPlanRow, photoId: string): SowingPlanRow {
  const husPhotos = (row.husPhotos ?? []).filter((photo) => photo.id !== photoId);
  const husNotes = (row.husNotes ?? [])
    .map((note) => ({
      ...note,
      photos: (note.photos ?? []).filter((photo) => photo.id !== photoId),
    }))
    .filter((note) => Boolean(note.note?.trim()) || (note.photos ?? []).length > 0);

  return {
    ...row,
    husNotes,
    husPhotos,
  };
}

function upsertById<T extends { id: string }>(items: T[]): T[] {
  return Array.from(new Map(items.map((item) => [item.id, item])).values());
}

function mergeSnapshotMedia(snapshot: ArchiveSnapshot, row: SowingPlanRow): Pick<SowingPlanRow, "husNotes" | "husPhotos"> {
  const photos = upsertById(row.husPhotos ?? []);
  const photosByNote = new Map<string, HusPhotoEntry[]>();
  photos.forEach((photo) => {
    if (photo.husNoteId) {
      photosByNote.set(photo.husNoteId, [...(photosByNote.get(photo.husNoteId) ?? []), photo]);
    }
  });

  return {
    husPhotos: photos,
    husNotes: upsertById(row.husNotes ?? []).map((note) => ({
      ...note,
      photos: photosByNote.get(note.id) ?? note.photos ?? [],
    })),
  };
}

function countHusMediaTarget(rows: SowingPlanRow[], rowId: string, eventId: string | undefined): number {
  const row = rows.find((candidate) => candidate.id === rowId);
  if (!row) {
    return 0;
  }

  if (eventId) {
    return (row.husPhotos ?? []).filter((photo) => photo.husEventId === eventId).length;
  }

  return (row.husNotes ?? []).length + (row.husPhotos ?? []).filter((photo) => !photo.husEventId).length;
}

function isFetchFailure(error: unknown): boolean {
  return error instanceof TypeError || (error instanceof Error && error.message.toLowerCase().includes("failed to fetch"));
}

function formatDateTime(timestamp: string): string {
  return new Intl.DateTimeFormat("lv-LV", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
  }).format(new Date(timestamp));
}

function formatFileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function weekdayName(date: string, language: AppLanguage = "lv"): string {
  return new Intl.DateTimeFormat(language === "lv" ? "lv-LV" : "en-GB", {
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

function workPlanPrintTitle(items: Array<{ date: string }>, language: AppLanguage): string {
  const first = items[0]?.date;
  const last = items.at(-1)?.date;
  const title = language === "lv" ? "DARBA PLĀNS" : "WORK PLAN";

  if (!first || !last) {
    return title;
  }

  return `${title} · ${printDateRange(first, last)}`;
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

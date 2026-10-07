import {
  calculateBoxPlan,
  calculateSowingPlan,
  calculateThinningPlan,
  type MonthlyPrintRow,
} from "./planning";
import type { HusEventType, PlantCorrectionReason, SowingPlanRow, WorkItem, WorkType } from "./types";

export type AppLanguage = "lv" | "en";
export type PrintLanguage = AppLanguage;

export const languageStorageKey = "small-plants:language";

type TextKey =
  | "addEntry"
  | "addHus"
  | "agronomistSowing"
  | "allHus"
  | "amount"
  | "automatic"
  | "balancePreview"
  | "boxes"
  | "cancel"
  | "calendar"
  | "calendarViewMode"
  | "capacity"
  | "changeDetails"
  | "changeHistory"
  | "chooseDate"
  | "chooseHus"
  | "commonCalendar"
  | "commonWorkPlanForAllHus"
  | "confirm"
  | "copyError"
  | "currentActual"
  | "cycle"
  | "cycleLength"
  | "date"
  | "day"
  | "dayWork"
  | "delete"
  | "deleteDemoData"
  | "deleteDuplicate"
  | "deleteRow"
  | "divWork"
  | "done"
  | "duplicate"
  | "edit"
  | "editEntry"
  | "extra"
  | "fixedDate"
  | "greenhouse"
  | "greenhouseCapacity"
  | "greenhouseRequired"
  | "husData"
  | "husInfo"
  | "husJournal"
  | "husName"
  | "importDetectedPlan"
  | "importPlan"
  | "importReady"
  | "importSelected"
  | "language"
  | "mainViews"
  | "manual"
  | "move"
  | "moveOut"
  | "moveOutDate"
  | "needed"
  | "noBetterBalance"
  | "noCorrections"
  | "noHusSelected"
  | "noJournal"
  | "noPlanRows"
  | "noRowsForReview"
  | "noTablesSet"
  | "noWork"
  | "noWorkFromStart"
  | "notes"
  | "openHus"
  | "openPlan"
  | "openWorksheet"
  | "overload"
  | "photoImport"
  | "plan"
  | "planActions"
  | "plannedRows"
  | "plantChange"
  | "plantCorrections"
  | "planting"
  | "plants"
  | "plantsOut"
  | "print"
  | "printLanguage"
  | "printWorkPlan"
  | "privatePlanner"
  | "quantity"
  | "recalculatePlan"
  | "recordChange"
  | "reserveShortageUnavailable"
  | "save"
  | "scheduleWillSaveAfterConfirm"
  | "sectorTables"
  | "seededInitial"
  | "sowing"
  | "seeding"
  | "seedingDate"
  | "seedingTables"
  | "sowingTables"
  | "selectTables"
  | "seasonBase"
  | "status"
  | "stillRequired"
  | "tables"
  | "today"
  | "total"
  | "totalSow"
  | "variety"
  | "weekNumber"
  | "work"
  | "workCycle"
  | "workPlan"
  | "worksheet";

const text: Record<AppLanguage, Record<TextKey, string>> = {
  lv: {
    addEntry: "+ Pievienot ierakstu",
    addHus: "Pievienot Hus",
    agronomistSowing: "Agronoma sējamais",
    allHus: "Hus",
    amount: "Daudzums",
    automatic: "Automātiski",
    balancePreview: "Darbu izlīdzināšanas priekšskatījums",
    boxes: "Kastītes",
    cancel: "Atcelt",
    calendar: "Kalendārs",
    calendarViewMode: "Kalendāra skata režīms",
    capacity: "Kapacitāte",
    changeDetails: "Mainīt parametrus",
    changeHistory: "Izmaiņu vēsture",
    chooseDate: "Izvēlies datumu",
    chooseHus: "Izvēlies Hus",
    commonCalendar: "Kopējais kalendārs",
    commonWorkPlanForAllHus: "Kopējais darba plāns visiem Hus",
    confirm: "Apstiprināt",
    copyError: "Kopēt kļūdu",
    currentActual: "Faktiski šobrīd",
    cycle: "Cikls",
    cycleLength: "Cikla garums",
    date: "Datums",
    day: "Diena",
    dayWork: "Dienas darbi",
    delete: "Dzēst",
    deleteDemoData: "Dzēst demo datus",
    deleteDuplicate: "Neimportēt dublikātu",
    deleteRow: "Dzēst",
    divWork: "Div / Darbi",
    done: "Pabeigts",
    duplicate: "Dublikāts",
    edit: "Rediģēt",
    editEntry: "Rediģēt ierakstu",
    extra: "Extra",
    fixedDate: "Fiksēts datums",
    greenhouse: "Stādu māja",
    greenhouseCapacity: "Fiziskā kapacitāte",
    greenhouseRequired: "Siltumnīcai nepieciešams",
    husData: "Hus dati",
    husInfo: "HUS info",
    husJournal: "HUS žurnāls",
    husName: "Hus nosaukums",
    importDetectedPlan: "Pārbaudīt atpazīto plānu",
    importPlan: "Nolasīt plānu",
    importReady: "Gatavs pārbaudei",
    importSelected: "Izvēlētas",
    language: "Valoda",
    mainViews: "Galvenie skati",
    manual: "Manuāli",
    move: "Pārcelt",
    moveOut: "Izvākšana",
    moveOutDate: "Izvākšanas datums",
    needed: "Nepieciešams",
    noBetterBalance: "Nav atrasts labāks sadalījums, ko piedāvāt.",
    noCorrections: "Stādu skaita korekcijas vēl nav reģistrētas.",
    noHusSelected: "Nav izvēlēts Hus",
    noJournal: "Šim Hus vēl nav žurnāla ierakstu.",
    noPlanRows: "Plāna rindu vēl nav.",
    noRowsForReview: "Nav nolasītu rindu pārbaudei.",
    noTablesSet: "Nav norādīti",
    noWork: "Nav darbu",
    noWorkFromStart: "No izvēlētā sākuma datuma nav ieplānotu darbu.",
    notes: "Piezīmes",
    openHus: "Atvērt Hus",
    openPlan: "Atvērt sēšanas plānu",
    openWorksheet: "Atvērt darba lapu",
    overload: "Pārslodze",
    photoImport: "Foto imports",
    plan: "Plāns",
    planActions: "⋮ Plāna darbības",
    plannedRows: "plāna rindas",
    plantChange: "Stādu izmaiņa",
    plantCorrections: "Stādu korekcija",
    planting: "Izvākšana",
    plants: "Stādi",
    plantsOut: "Plants out",
    print: "Printēt",
    printLanguage: "Valoda",
    printWorkPlan: "Printēt darba plānu",
    privatePlanner: "Privāts ražošanas plānotājs",
    quantity: "Daudzums",
    recalculatePlan: "Pārrēķināt plānu",
    recordChange: "+ Reģistrēt izmaiņu",
    reserveShortageUnavailable: "Rezerve/trūkums: Nav aprēķināms",
    save: "Saglabāt",
    scheduleWillSaveAfterConfirm: "Izmaiņas tiks saglabātas tikai pēc apstiprināšanas.",
    sectorTables: "Sektora galdi",
    seededInitial: "Sākotnēji iesēts",
    sowing: "Sēšana",
    seeding: "Sēšana",
    seedingDate: "Sēšanas datums",
    seedingTables: "Sēšanas galdi",
    sowingTables: "Sēšanas galdi",
    selectTables: "Izvēlies A1-A13",
    seasonBase: "Sezonas pamats",
    status: "Statuss",
    stillRequired: "Nepieciešams",
    tables: "Galdi",
    today: "Šodien",
    total: "Kopā",
    totalSow: "Kopā sējams",
    variety: "Šķirne",
    weekNumber: "Nedēļa",
    work: "Darbs",
    workCycle: "Pilns darba cikls",
    workPlan: "Darba plāns",
    worksheet: "Darba lapa",
  },
  en: {
    addEntry: "+ Add entry",
    addHus: "Add Hus",
    agronomistSowing: "Agronomist sowing",
    allHus: "Hus",
    amount: "Amount",
    automatic: "Automatic",
    balancePreview: "Work balancing preview",
    boxes: "Boxes",
    cancel: "Cancel",
    calendar: "Calendar",
    calendarViewMode: "Calendar view mode",
    capacity: "Capacity",
    changeDetails: "Change parameters",
    changeHistory: "Change history",
    chooseDate: "Choose date",
    chooseHus: "Choose Hus",
    commonCalendar: "Common calendar",
    commonWorkPlanForAllHus: "Common work plan for all Hus",
    confirm: "Confirm",
    copyError: "Copy error",
    currentActual: "Actual now",
    cycle: "Cycle",
    cycleLength: "Cycle length",
    date: "Date",
    day: "Day",
    dayWork: "Day work",
    delete: "Delete",
    deleteDemoData: "Delete demo data",
    deleteDuplicate: "Do not import duplicate",
    deleteRow: "Delete",
    divWork: "Div / Work",
    done: "Done",
    duplicate: "Duplicate",
    edit: "Edit",
    editEntry: "Edit entry",
    extra: "Extra",
    fixedDate: "Fixed date",
    greenhouse: "Greenhouse",
    greenhouseCapacity: "Physical capacity",
    greenhouseRequired: "Greenhouse required",
    husData: "Hus data",
    husInfo: "HUS info",
    husJournal: "HUS journal",
    husName: "Hus name",
    importDetectedPlan: "Review extracted plan",
    importPlan: "Read plan",
    importReady: "Ready for review",
    importSelected: "Selected",
    language: "Language",
    mainViews: "Main views",
    manual: "Manual",
    move: "Move",
    moveOut: "Planting",
    moveOutDate: "Planting date",
    needed: "Required",
    noBetterBalance: "No better distribution was found.",
    noCorrections: "No plant corrections have been registered yet.",
    noHusSelected: "No Hus selected",
    noJournal: "This Hus has no journal entries yet.",
    noPlanRows: "No plan rows yet.",
    noRowsForReview: "No extracted rows to review.",
    noTablesSet: "Not set",
    noWork: "No work",
    noWorkFromStart: "No work is planned from the selected start date.",
    notes: "Notes",
    openHus: "Open Hus",
    openPlan: "Open seeding plan",
    openWorksheet: "Open work sheet",
    overload: "Overload",
    photoImport: "Photo import",
    plan: "Plan",
    planActions: "⋮ Plan actions",
    plannedRows: "plan rows",
    plantChange: "Plant change",
    plantCorrections: "Plant correction",
    planting: "Planting",
    plants: "Plants",
    plantsOut: "Plants out",
    print: "Print",
    printLanguage: "Language",
    printWorkPlan: "Print work plan",
    privatePlanner: "Private production planner",
    quantity: "Quantity",
    recalculatePlan: "Recalculate plan",
    recordChange: "+ Register change",
    reserveShortageUnavailable: "Reserve/shortage: Cannot calculate",
    save: "Save",
    scheduleWillSaveAfterConfirm: "Changes will be saved only after confirmation.",
    sectorTables: "Sector tables",
    seededInitial: "Initially seeded",
    sowing: "Seeding",
    seeding: "Seeding",
    seedingDate: "Seeding date",
    seedingTables: "Seeding tables",
    sowingTables: "Seeding tables",
    selectTables: "Choose A1-A13",
    seasonBase: "Season base",
    status: "Status",
    stillRequired: "Required",
    tables: "Tables",
    today: "Today",
    total: "Total",
    totalSow: "Total to seed",
    variety: "Variety",
    weekNumber: "Week",
    work: "Work",
    workCycle: "Full work cycle",
    workPlan: "Work plan",
    worksheet: "Work sheet",
  },
};

const workTypeTitles: Record<AppLanguage, Record<WorkType, string>> = {
  lv: {
    addAgrofilm: "Uzlikt agroplēvi",
    animals: "Animals",
    disinfectTables: "Dezinficēt galdus",
    harvest: "Izvākšana",
    previcur: "Previcur",
    previcure: "Previcur",
    removeAgrofilm: "Noņemt agroplēvi",
    removeFilm: "Noņemt plēvi",
    rings: "Gredzeni",
    sideShoots: "Pazares",
    sowing: "Sēšana",
    sprayTables: "Nomiglot galdus",
    sticks: "Kociņi",
    thinning: "Retināšana",
  },
  en: {
    addAgrofilm: "Agroplastic on",
    animals: "Animals",
    disinfectTables: "Chlorine",
    harvest: "Planting",
    previcur: "Previcur",
    previcure: "Previcur",
    removeAgrofilm: "Agroplastic off",
    removeFilm: "Plastic off",
    rings: "Clips",
    sideShoots: "Pazar",
    sowing: "Seeding",
    sprayTables: "Spray HP",
    sticks: "Stick",
    thinning: "Moving",
  },
};

const plantCorrectionReasonLabels: Record<AppLanguage, Record<PlantCorrectionReason, string>> = {
  lv: {
    brownRoots: "Brūnās saknes",
    damaged: "Bojāti",
    other: "Cits",
    thinning: "Retināšana",
  },
  en: {
    brownRoots: "Brown roots",
    damaged: "Damaged",
    other: "Other",
    thinning: "Moving",
  },
};

const husEventTypeLabels: Record<AppLanguage, Record<HusEventType, string>> = {
  lv: {
    brownRoots: "Brūnās saknes",
    extraWatering: "Extra laistīšana",
    move: "Pārvietošana",
    observation: "Novērojums",
    other: "Cits",
    thinning: "Retināšana",
    treatment: "Apstrāde",
    watering: "Laistīšana",
  },
  en: {
    brownRoots: "Brown roots",
    extraWatering: "Extra watering",
    move: "Move",
    observation: "Observation",
    other: "Other",
    thinning: "Moving",
    treatment: "Treatment",
    watering: "Watering",
  },
};

const printWorkTypeOrder: WorkType[] = [
  "sowing",
  "removeFilm",
  "addAgrofilm",
  "removeAgrofilm",
  "animals",
  "thinning",
  "previcur",
  "disinfectTables",
  "previcure",
  "sideShoots",
  "sticks",
  "rings",
  "harvest",
  "sprayTables",
];

const majorPrintWorkTypes = new Set<WorkType>(["sowing", "thinning", "sideShoots", "sticks", "rings", "harvest"]);

export function t(key: TextKey, language: AppLanguage): string {
  return text[language][key] ?? text.lv[key];
}

export function normalizeLanguage(value: unknown): AppLanguage {
  return value === "en" ? "en" : "lv";
}

export function readStoredLanguage(): AppLanguage {
  if (typeof window === "undefined") {
    return "lv";
  }

  return normalizeLanguage(window.localStorage.getItem(languageStorageKey));
}

export function writeStoredLanguage(language: AppLanguage): void {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(languageStorageKey, language);
}

export function printLabel(language: AppLanguage, key: TextKey): string {
  return t(key, language);
}

export function printWorkTitle(type: WorkType, language: AppLanguage): string {
  return workTypeTitles[language][type] ?? workTypeTitles.lv[type];
}

export function plantCorrectionReasonTitle(reason: PlantCorrectionReason, language: AppLanguage): string {
  return plantCorrectionReasonLabels[language][reason] ?? plantCorrectionReasonLabels.lv[reason];
}

export function husEventTypeTitle(type: HusEventType, language: AppLanguage): string {
  return husEventTypeLabels[language][type] ?? husEventTypeLabels.lv[type];
}

export function formatPlants(value: number, language: AppLanguage): string {
  return language === "lv"
    ? `${value.toLocaleString("lv-LV")} stādi`
    : `${value.toLocaleString("lv-LV")} plants`;
}

export function formatCycleDays(value: number, language: AppLanguage): string {
  return language === "lv" ? `${value} dienas` : `${value} days`;
}

export function formatCycleDay(value: number, language: AppLanguage): string {
  return language === "lv" ? `${value}. diena` : `Day ${value}`;
}

export function formatReserveShortage(difference: number | null, language: AppLanguage): string {
  if (difference === null) {
    return t("reserveShortageUnavailable", language);
  }

  if (difference >= 0) {
    return language === "lv" ? `Rezerve: +${difference}` : `Reserve: +${difference}`;
  }

  return language === "lv" ? `Trūkst: ${Math.abs(difference)}` : `Shortage: ${Math.abs(difference)}`;
}

export function formatPrintSowingPlan(plantCount: number, language: AppLanguage): string {
  const plan = calculateSowingPlan(plantCount);

  if (language === "lv") {
    return plan.label;
  }

  const full = plan.fullTables === 1 ? "1 full table" : `${plan.fullTables} full tables`;
  const partial = plan.hasPartialTable ? ` + partial table 16x${plan.partialRowsWithReserve}` : "";
  return `${full}${partial}`;
}

export function formatPrintThinningPlan(row: SowingPlanRow, language: AppLanguage): string {
  const plan = calculateThinningPlan(row.requiredPlants + row.extraPlants, row.sectorType);
  const plants = plan.plantsPerGutterMin === plan.plantsPerGutterMax
    ? `${plan.plantsPerGutterMin}`
    : `${plan.plantsPerGutterMin}/${plan.plantsPerGutterMax}`;

  return language === "lv"
    ? `${plan.tables} galdi · ${plants} stādi renē`
    : `${plan.tables} tables · ${plants} plants/trough`;
}

export function formatPrintHarvestBoxes(row: SowingPlanRow, language: AppLanguage): string {
  const plan = calculateBoxPlan(row);

  if (language === "lv") {
    return plan.label;
  }

  if (plan.lastBoxPlants === 12) {
    return `${plan.totalBoxes} full boxes`;
  }

  return `${plan.fullBoxes} full boxes + 1 partial box with ${plan.lastBoxPlants} plants`;
}

export function printMaterialSummary(row: SowingPlanRow, language: AppLanguage) {
  return {
    harvest: formatPrintHarvestBoxes(row, language),
    sowing: formatPrintSowingPlan(row.requiredPlants + row.extraPlants, language),
    sowingTables: row.sowingTables || t("noTablesSet", language),
    thinning: formatPrintThinningPlan(row, language),
  };
}

export function localizedWorkDetails(item: WorkItem, row: SowingPlanRow | undefined, language: AppLanguage): string[] {
  if (language === "lv") {
    return item.details;
  }

  if (!row) {
    return item.details;
  }

  const materials = printMaterialSummary(row, language);

  switch (item.type) {
    case "sowing":
      return [materials.sowing, `${t("variety", language)}: ${row.variety}`, `${t("seedingTables", language)}: ${materials.sowingTables}`];
    case "thinning":
      return [
        materials.thinning,
        item.placement
          ? `${item.placement.primaryRow ? `Row ${item.placement.primaryRow}` : "No free row"} · ${item.placement.tables} tables`
          : "",
        item.allowedDateRange ? `Allowed only ${item.allowedDateRange.start} - ${item.allowedDateRange.end}` : "",
      ].filter(Boolean);
    case "sideShoots":
      return [`Not before biological day 17`, `Workload: ${localizedWorkload(item.workloadWeight)}`];
    case "sticks":
      return [`Flexible work near the end of the cycle`, `Workload: ${localizedWorkload(item.workloadWeight)}`];
    case "rings":
      return ["Automatically one day before planting"];
    case "harvest":
      return [materials.harvest];
    case "previcur":
    case "disinfectTables":
      return ["After moving"];
    case "removeFilm":
    case "addAgrofilm":
    case "removeAgrofilm":
      return ["Linked to seeding"];
    case "sprayTables":
      return ["After planting"];
    case "animals":
      return ["Every Thursday after agroplastic off until planting"];
    default:
      return item.details;
  }
}

export function localizedMonthlyPrintRows(
  workItems: WorkItem[],
  rows: SowingPlanRow[],
  language: AppLanguage,
): MonthlyPrintRow[] {
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const groups = new Map<string, WorkItem[]>();

  workItems.forEach((item) => {
    const key = `${item.date}:${item.planRowId}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  });

  return Array.from(groups.values())
    .map((items) => {
      const sorted = items.slice().sort((left, right) => printWorkTypeOrder.indexOf(left.type) - printWorkTypeOrder.indexOf(right.type));
      const first = sorted[0];
      const row = rowsById.get(first.planRowId);
      const major = sorted.filter((item) => majorPrintWorkTypes.has(item.type));
      const minor = sorted.filter((item) => !majorPrintWorkTypes.has(item.type));
      const capacityNotes = sorted
        .map((item) => item.capacityWarning)
        .filter((note): note is string => Boolean(note))
        .map((note) => (language === "lv" ? note : "Capacity warning"));
      const materialNotes = row ? major.flatMap((item) => monthlyMaterialNotes(item, row, language)) : [];
      const notes = [...materialNotes, ...minor.map((item) => printWorkTitle(item.type, language)), ...capacityNotes].join(" · ");

      return {
        date: first.date,
        planRowId: first.planRowId,
        plantCount: first.plantCount,
        sectorName: first.sectorName,
        workTitle: major.length > 0 ? major.map((item) => printWorkTitle(item.type, language)).join(" · ") : "—",
        notes,
      };
    })
    .sort(
      (left, right) =>
        left.date.localeCompare(right.date) ||
        left.sectorName.localeCompare(right.sectorName, "lv", { numeric: true }) ||
        left.workTitle.localeCompare(right.workTitle, "lv"),
    );
}

function monthlyMaterialNotes(item: WorkItem, row: SowingPlanRow, language: AppLanguage): string[] {
  if (item.type === "sowing") {
    return [formatPrintSowingPlan(item.plantCount, language)];
  }

  if (item.type === "thinning") {
    return [formatPrintThinningPlan(row, language)];
  }

  if (item.type === "harvest") {
    return [formatPrintHarvestBoxes(row, language)];
  }

  return [];
}

function localizedWorkload(workload: number): string {
  return workload % 1 === 0 ? workload.toFixed(0) : workload.toFixed(1);
}

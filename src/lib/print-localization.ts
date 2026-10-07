import {
  calculateBoxPlan,
  calculateSowingPlan,
  calculateThinningPlan,
  type MonthlyPrintRow,
} from "./planning";
import type { SowingPlanRow, WorkItem, WorkType } from "./types";

export type PrintLanguage = "lv" | "en";

type PrintLabelKey =
  | "amount"
  | "boxes"
  | "date"
  | "day"
  | "divWork"
  | "harvest"
  | "needed"
  | "notes"
  | "plants"
  | "planting"
  | "printLanguage"
  | "quantity"
  | "required"
  | "sowing"
  | "sowingTables"
  | "tables"
  | "variety"
  | "work"
  | "workPlan"
  | "worksheet";

const workTypeTitles: Record<PrintLanguage, Record<WorkType, string>> = {
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

const labels: Record<PrintLanguage, Record<PrintLabelKey, string>> = {
  lv: {
    amount: "Daudzums",
    boxes: "Kastītes",
    date: "Datums",
    day: "Diena",
    divWork: "Div / Darbi",
    harvest: "Izvākšana",
    needed: "Nepieciešams",
    notes: "Piezīmes",
    plants: "Stādi",
    planting: "Izvākšana",
    printLanguage: "Valoda",
    quantity: "Daudzums",
    required: "Nepieciešams",
    sowing: "Sēšana",
    sowingTables: "Sēšanas galdi",
    tables: "Galdi",
    variety: "Šķirne",
    work: "Darbs",
    workPlan: "Darba plāns",
    worksheet: "Darba lapa",
  },
  en: {
    amount: "Amount",
    boxes: "Boxes",
    date: "Date",
    day: "Day",
    divWork: "Div / Work",
    harvest: "Planting",
    needed: "Required",
    notes: "Notes",
    plants: "Plants",
    planting: "Planting",
    printLanguage: "Language",
    quantity: "Quantity",
    required: "Required",
    sowing: "Seeding",
    sowingTables: "Seeding tables",
    tables: "Tables",
    variety: "Variety",
    work: "Work",
    workPlan: "Work plan",
    worksheet: "Work sheet",
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

export function printLabel(language: PrintLanguage, key: PrintLabelKey): string {
  return labels[language][key];
}

export function printWorkTitle(type: WorkType, language: PrintLanguage): string {
  return workTypeTitles[language][type];
}

export function formatPrintSowingPlan(plantCount: number, language: PrintLanguage): string {
  const plan = calculateSowingPlan(plantCount);

  if (language === "lv") {
    return plan.label;
  }

  const full = plan.fullTables === 1 ? "1 full table" : `${plan.fullTables} full tables`;
  const partial = plan.hasPartialTable ? ` + partial table 16x${plan.partialRowsWithReserve}` : "";
  return `${full}${partial}`;
}

export function formatPrintThinningPlan(row: SowingPlanRow, language: PrintLanguage): string {
  const plan = calculateThinningPlan(row.requiredPlants + row.extraPlants, row.sectorType);
  const plants = plan.plantsPerGutterMin === plan.plantsPerGutterMax
    ? `${plan.plantsPerGutterMin}`
    : `${plan.plantsPerGutterMin}/${plan.plantsPerGutterMax}`;

  return language === "lv"
    ? `${plan.tables} galdi · ${plants} stādi renē`
    : `${plan.tables} tables · ${plants} plants/trough`;
}

export function formatPrintHarvestBoxes(row: SowingPlanRow, language: PrintLanguage): string {
  const plan = calculateBoxPlan(row);

  if (language === "lv") {
    return plan.label;
  }

  if (plan.lastBoxPlants === 12) {
    return `${plan.totalBoxes} full boxes`;
  }

  return `${plan.fullBoxes} full boxes + 1 partial box with ${plan.lastBoxPlants} plants`;
}

export function printMaterialSummary(row: SowingPlanRow, language: PrintLanguage) {
  return {
    harvest: formatPrintHarvestBoxes(row, language),
    sowing: formatPrintSowingPlan(row.requiredPlants + row.extraPlants, language),
    sowingTables: row.sowingTables || (language === "lv" ? "Nav norādīti" : "Not set"),
    thinning: formatPrintThinningPlan(row, language),
  };
}

export function localizedMonthlyPrintRows(
  workItems: WorkItem[],
  rows: SowingPlanRow[],
  language: PrintLanguage,
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

function monthlyMaterialNotes(item: WorkItem, row: SowingPlanRow, language: PrintLanguage): string[] {
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

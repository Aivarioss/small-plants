const TROUGHS_PER_TABLE = 6;
const PRIMARY_ROW_TABLES = 26;
const MAX_EXTRA_TABLES = 13;
const MAX_TOTAL_TABLES = PRIMARY_ROW_TABLES + MAX_EXTRA_TABLES;
const IDEAL_DENSITY = 25;
const COMFORTABLE_MIN = 24;
const COMFORTABLE_MAX = 26;
const SLIGHTLY_COMPRESSED_MAX = 28;
const EXCEPTIONAL_MAX = 35;

export type PlacementDensityClass = "normal" | "slightlyCompressed" | "exceptional";

export type GreenhouseTablePlacement = {
  plantCount: number;
  totalTables: number;
  primaryRowTables: number;
  extraTables: number;
  plantsPerTrough: number;
  densityClass: PlacementDensityClass;
  feasible: boolean;
  reason: string;
};

type PlacementCandidate = GreenhouseTablePlacement & {
  score: number;
};

export type GreenhousePlacementOptions = {
  maxTables?: number;
};

export function calculateGreenhouseTablePlacement(
  plantCount: number,
  options: GreenhousePlacementOptions = {},
): GreenhouseTablePlacement {
  const maxTables = clampTableLimit(options.maxTables ?? MAX_TOTAL_TABLES);

  if (!Number.isFinite(plantCount) || plantCount <= 0) {
    return placement(0, 1, "normal", true, "Nav derīga stādu skaita; rādām minimālu izvietojumu pārbaudei.");
  }

  const oneRowDensity = densityFor(plantCount, PRIMARY_ROW_TABLES);
  if (maxTables >= PRIMARY_ROW_TABLES && oneRowDensity <= SLIGHTLY_COMPRESSED_MAX && oneRowDensity > COMFORTABLE_MAX) {
    return placement(
      plantCount,
      PRIMARY_ROW_TABLES,
      "slightlyCompressed",
      true,
      "Ietilpst vienā 26 galdu rindā ar nelielu sablīvējumu; izvairāmies no neefektīva 26+1 vai 26+2 pārplūduma.",
    );
  }

  const candidates = Array.from({ length: maxTables }, (_, index) => index + 1)
    .map((tables) => candidateFor(plantCount, tables))
    .filter((candidate) => candidate.plantsPerTrough <= EXCEPTIONAL_MAX);

  const normal = candidates
    .filter((candidate) => candidate.densityClass === "normal")
    .sort(compareCandidates)[0];

  if (normal) {
    return withoutScore(normal);
  }

  const best = candidates.sort(compareCandidates)[0];

  if (best) {
    return withoutScore(best);
  }

  const overflowDensity = densityFor(plantCount, maxTables);

  return placement(
    plantCount,
    maxTables,
    "exceptional",
    false,
    `Pat ar pieejamajiem ${maxTables} galdiem blīvums būtu ${overflowDensity.toFixed(1)} stādi renē; tas pārsniedz 35 robežu.`,
  );
}

function candidateFor(plantCount: number, totalTables: number): PlacementCandidate {
  const plantsPerTrough = densityFor(plantCount, totalTables);
  const densityClass = classifyDensity(plantsPerTrough);
  const extraTables = Math.max(0, totalTables - PRIMARY_ROW_TABLES);
  const tinyOverflowPenalty = extraTables > 0 && extraTables <= 2 ? 6 : 0;
  const extraTablePenalty = extraTables > 0 ? 0.2 + extraTables * 0.01 : 0;
  const tableCountPenalty = totalTables <= PRIMARY_ROW_TABLES ? totalTables * 0.005 : 0;
  const compressionPenalty =
    densityClass === "exceptional" ? 12 : densityClass === "slightlyCompressed" ? 3 : 0;

  return {
    ...placement(plantCount, totalTables, densityClass, true, reasonFor(plantCount, totalTables, densityClass)),
    score:
      Math.abs(plantsPerTrough - IDEAL_DENSITY) +
      tinyOverflowPenalty +
      extraTablePenalty +
      tableCountPenalty +
      compressionPenalty,
  };
}

function compareCandidates(left: PlacementCandidate, right: PlacementCandidate): number {
  return (
    left.score - right.score ||
    left.extraTables - right.extraTables ||
    Math.abs(left.plantsPerTrough - IDEAL_DENSITY) - Math.abs(right.plantsPerTrough - IDEAL_DENSITY) ||
    left.totalTables - right.totalTables
  );
}

function placement(
  plantCount: number,
  totalTables: number,
  densityClass: PlacementDensityClass,
  feasible: boolean,
  reason: string,
): GreenhouseTablePlacement {
  return {
    plantCount,
    totalTables,
    primaryRowTables: Math.min(totalTables, PRIMARY_ROW_TABLES),
    extraTables: Math.max(0, totalTables - PRIMARY_ROW_TABLES),
    plantsPerTrough: Number(densityFor(plantCount, totalTables).toFixed(1)),
    densityClass,
    feasible,
    reason,
  };
}

function withoutScore(candidate: PlacementCandidate): GreenhouseTablePlacement {
  return {
    plantCount: candidate.plantCount,
    totalTables: candidate.totalTables,
    primaryRowTables: candidate.primaryRowTables,
    extraTables: candidate.extraTables,
    plantsPerTrough: candidate.plantsPerTrough,
    densityClass: candidate.densityClass,
    feasible: candidate.feasible,
    reason: candidate.reason,
  };
}

function clampTableLimit(maxTables: number): number {
  return Math.max(1, Math.min(MAX_TOTAL_TABLES, Math.floor(maxTables)));
}

function densityFor(plantCount: number, totalTables: number): number {
  return plantCount / (totalTables * TROUGHS_PER_TABLE);
}

function classifyDensity(plantsPerTrough: number): PlacementDensityClass {
  if (plantsPerTrough >= COMFORTABLE_MIN && plantsPerTrough <= COMFORTABLE_MAX) {
    return "normal";
  }

  if (plantsPerTrough <= SLIGHTLY_COMPRESSED_MAX) {
    return "slightlyCompressed";
  }

  return "exceptional";
}

function reasonFor(
  plantCount: number,
  totalTables: number,
  densityClass: PlacementDensityClass,
): string {
  const extraTables = Math.max(0, totalTables - PRIMARY_ROW_TABLES);
  const plantsPerTrough = densityFor(plantCount, totalTables);

  if (extraTables === 0 && totalTables < PRIMARY_ROW_TABLES) {
    return "Mazāks sektors: izvēlēts galdu skaits ap 25 stādiem renē, neizplešot līdz pilnai 26 galdu rindai.";
  }

  if (extraTables === 0 && plantsPerTrough <= SLIGHTLY_COMPRESSED_MAX && plantsPerTrough > COMFORTABLE_MAX) {
    return "Viss sektors ietilpst vienā 26 galdu rindā ar nelielu sablīvējumu; tas ir labāk nekā mazs pārplūdums uz citu rindu.";
  }

  if (extraTables > 0) {
    return "Liels sektors: izmantojam papildu galdus, lai nepārslogotu vienu rindu.";
  }

  if (densityClass === "normal") {
    return "Normāls izvietojums 24-26 stādi renē diapazonā.";
  }

  return "Ārkārtas blīvums; pārbaudi pieejamo kapacitāti pirms apstiprināšanas.";
}

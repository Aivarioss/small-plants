export function validateRow(row: unknown): string | null {
  if (!isRecord(row)) {
    return "Expected a row object.";
  }

  if (
    typeof row.id !== "string" ||
    typeof row.sectorName !== "string" ||
    typeof row.variety !== "string" ||
    typeof row.sowingDate !== "string" ||
    typeof row.harvestDate !== "string"
  ) {
    return "Every row must include id, Hus, variety, sowing date and move-out date.";
  }

  if (
    !Number.isFinite(Number(row.requiredPlants)) ||
    !Number.isFinite(Number(row.extraPlants)) ||
    !Number.isFinite(Number(row.cycleLength)) ||
    ![26, 39].includes(Number(row.sectorType))
  ) {
    return "Every row must include valid plant counts, cycle length and sector type.";
  }

  if (
    row.greenhouseRequiredPlants !== undefined &&
    row.greenhouseRequiredPlants !== null &&
    (!Number.isFinite(Number(row.greenhouseRequiredPlants)) || Number(row.greenhouseRequiredPlants) <= 0)
  ) {
    return "Greenhouse required plants must be a positive number when provided.";
  }

  return null;
}


function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

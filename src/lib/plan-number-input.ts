export function parsePlanNumber(text: string, min = 0, optional = false, max = Infinity):
  { valid: true; value: number | undefined } | { valid: false } {
  if (!text.trim()) return optional ? { valid: true, value: undefined } : { valid: false };
  const value = Number(text);
  return Number.isSafeInteger(value) && value >= min && value <= max ? { valid: true, value } : { valid: false };
}

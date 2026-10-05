import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("./PlannerApp.tsx", import.meta.url), "utf8");
const worksheetTableSource = source.slice(
  source.indexOf("<table className=\"worksheet-table\">"),
  source.indexOf("</table>", source.indexOf("<table className=\"worksheet-table\">")),
);

describe("worksheet print table structure", () => {
  it("does not span worksheet cells across day rows", () => {
    expect(worksheetTableSource).not.toMatch(/rowSpan|rowspan|colSpan|colspan/);
  });

  it("keeps empty handwritten worksheet cells present for print grid rendering", () => {
    const emptyCellMatches = worksheetTableSource.match(/className="worksheet-empty-cell"/g) ?? [];

    expect(emptyCellMatches).toHaveLength(3);
    expect(worksheetTableSource).toContain("aria-label=\"Water min\"><span");
    expect(worksheetTableSource).toContain("aria-label=\"Temp\"><span");
    expect(worksheetTableSource).toContain("aria-label=\"Plants out\"><span");
  });
});

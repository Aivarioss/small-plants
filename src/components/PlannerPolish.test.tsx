import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PlannerApp, GreenhousePanel, WorksheetView, DayDetails } from "./PlannerApp";
import { GreenhouseStatisticsPanel, type GreenhouseStatisticsSelection } from "./GreenhouseStatisticsPanel";
import { buildGreenhouseOccupancyDay } from "@/lib/greenhouse-simulation";
import { buildArchiveSnapshot } from "@/lib/hus-archive";
import { buildCalendarHistory } from "@/lib/calendar-history";
import { plannerConfig } from "@/lib/demo-data";
import { archiveConfirmation, formatWorkCount, formatBalanceHeading, formatHouseWarning } from "@/lib/localization";
import { workspaceMessage } from "@/lib/workspace-messages";
import type { SowingPlanRow } from "@/lib/types";

function fixture(): SowingPlanRow { return { id:"hus-1",sectorName:"Hus 1",source:"user",variety:"Synthetic",
  sowingDate:"2026-11-10",harvestDate:"2026-12-02",cycleLength:23,sectorType:39,plantsPerBox:30,
  requiredPlants:4947,extraPlants:144,greenhouseRequiredPlants:4757,correction:0,
  plantCorrections:[{id:"moving-loss",date:"2026-11-19",reason:"thinning",amount:-72}],
  husEvents:[{id:"moving",eventType:"move",eventDate:"2026-11-19",location:"A7",destinationLocation:"D1-D24, A14-A23",plantChange:-72,plantCorrectionId:"moving-loss"}],
}; }
const noop=()=>{};
const worksheet=(row:SowingPlanRow,language:"lv"|"en",readOnly=false)=>renderToStaticMarkup(<WorksheetView row={row} workItems={row.archiveSnapshot?.workItems ?? []}
  printLanguage={language} readOnly={readOnly} onEdit={noop} onArchive={noop} onRestore={noop} onUpdateRow={noop}
  onSaveHusEntries={async()=>{}} onUploadHusMedia={async()=>{}} onViewPhoto={noop} />);

describe("house warning and text polish",()=>{
  it("shows an incomplete Moving warning once, without changing occupancy or the event",()=>{
    const row=fixture(); row.husEvents![0].destinationLocation="D1-D24 unknown";
    const before=structuredClone(row), day=buildGreenhouseOccupancyDay([row],plannerConfig,"2026-11-19");
    expect(day.warnings.some(value=>value.includes("nevar droši interpretēt"))).toBe(true);
    const html=renderToStaticMarkup(<GreenhousePanel date="2026-11-19" rows={[row]} onDateChange={noop} />);
    expect(html.match(/nevar droši interpretēt/g)).toHaveLength(1);
    expect(buildGreenhouseOccupancyDay([row],plannerConfig,"2026-11-19")).toEqual(day);
    expect(row).toEqual(before);
  });
  it("retains a real physical collision with both HUS and the table, once",()=>{
    const first=fixture(), other={...fixture(),id:"other",sectorName:"Other HUS",husEvents:[{
      id:"other-moving",eventType:"move" as const,eventDate:"2026-11-19",location:"A8",destinationLocation:"D4"}]};
    const day=buildGreenhouseOccupancyDay([first,other],plannerConfig,"2026-11-19");
    expect(day.growing.overCapacity).toBe(true);
    const html=renderToStaticMarkup(<GreenhousePanel language="en" date="2026-11-19" rows={[first,other]} onDateChange={noop} />);
    expect(html.match(/growing-table conflict/g)).toHaveLength(1);
    expect(html).toContain("D4"); expect(html).toContain("Hus 1, Other HUS");
  });
  it("renders the English balance from unchanged numbers rather than the stored Latvian label",()=>{
    const row=fixture(),before=structuredClone(row), html=worksheet(row,"en");
    expect(html).toContain("Reserve 262 plants"); expect(html).not.toContain("Rezerve");
    expect(worksheet(row,"lv")).toContain("Rezerve 262 stādi"); expect(row).toEqual(before);
    expect(formatBalanceHeading(-20,"en")).toBe("Shortage 20 plants");
  });
  it("keeps frozen archive contents, calendar history, stored counts and events unchanged when displaying either language",()=>{
    const row=fixture(); const snapshot=buildArchiveSnapshot(row,[row],plannerConfig,"2026-12-03T00:00:00Z");
    snapshot.plantBalance.label="Rezerve 262 stādi"; snapshot.materials.thinning="Original archived placement";
    row.archivedAt=snapshot.archivedAt; row.archiveSnapshot=snapshot;
    const before=structuredClone(row), history=buildCalendarHistory([],[],[row],"2027-01-01");
    expect(worksheet(row,"en",true)).toContain("Reserve 262 plants"); worksheet(row,"lv",true);
    expect(row).toEqual(before);
    expect(buildCalendarHistory([],[],[row],"2027-01-01")).toEqual(history);
    expect(buildArchiveSnapshot(row,[row],plannerConfig,"2027-01-01T00:00:00Z")).toEqual(snapshot);
  });
  it("explains archive calendar history in both languages and uses readable localized counts/statuses",()=>{
    expect(archiveConfirmation("Hus 1","lv")).toContain("kalendārā saglabāsies tikai lasīšanai");
    expect(archiveConfirmation("Hus 1","en")).toContain("past calendar work will remain read-only");
    expect(formatWorkCount(186,"lv")).toBe("186 darbi"); expect(formatWorkCount(21,"lv")).toBe("21 darbs");
    expect(formatWorkCount(11,"lv")).toBe("11 darbi"); expect(formatWorkCount(1,"en")).toBe("1 task");
    expect(workspaceMessage("Izmaiņas saglabātas","en")).toBe("Changes saved");
    expect(workspaceMessage("Saving HUS photos","lv")).toBe("Saglabā HUS fotogrāfijas");
    expect(workspaceMessage("Saglabāšanas rezultāts nav apstiprināts. Pārlādē datus un pārbaudi rezultātu.","en")).toContain("has not been confirmed");
    const html=renderToStaticMarkup(<PlannerApp/>);
    expect(html).toContain("Ielādē plānu…"); expect(html).not.toContain("Supabase"); expect(html).not.toContain("144");
  });
  it("translates house notices while preserving HUS names, tables and real conflict information",()=>{
    const notice='Hus 8A: C rinda rezervēta pilnībā, arī ja izmantoti 24 no 26 galdiem.';
    expect(formatHouseWarning(notice,"lv")).toBe(notice);
    expect(formatHouseWarning(notice,"en")).toBe('Hus 8A: The whole C row is reserved even when 24 of 26 tables are used.');
    expect(formatHouseWarning('A7: sēšanas galda konflikts (Hus 8A, Hus 8B).',"en")).toBe('A7: seeding-table conflict (Hus 8A, Hus 8B).');
    expect(formatHouseWarning('Hus 1: Moving ieraksta galamērķi "unknown" nevar droši interpretēt kā augšanas galdus.',"en")).toContain('Moving destination "unknown" cannot be reliably interpreted');
  });
  it("renders dates in the selected language",()=>{
    const html=renderToStaticMarkup(<DayDetails errors={{}} language="en" items={[]} onMove={noop} onMoveRange={noop} rows={[]} selectedDate="2026-11-19"/>);
    expect(html).toContain("19 Nov 2026"); expect(html).not.toContain("19. nov.");
  });
  it("can remount statistics with the exact selected table and custom period, without persisting data",()=>{
    const row=fixture(); row.husEvents!.push({id:"roots",eventType:"brownRoots",eventDate:"2026-11-20",location:"D4",plantChange:-2});
    const selection:GreenhouseStatisticsSelection={preset:"custom",start:"2026-11-18",end:"2026-11-21",selected:"D4"};
    const before=structuredClone({row,selection});
    const render=()=>renderToStaticMarkup(<GreenhouseStatisticsPanel rows={[row]} archivedRows={[]} today="2026-11-22" language="en"
      selection={selection} onSelectionChange={noop} focusHistorySignal={1} onViewPhoto={noop} onOpenHus={noop}/>);
    const html=render(); expect(html).toContain("Table D4"); expect(html).toContain('value="2026-11-18"'); expect(html).toContain('value="2026-11-21"');
    expect(html).toContain('aria-pressed="true"'); expect(render()).toBe(html); expect({row,selection}).toEqual(before);
  });
});

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HusEntrySaveStatus } from "./HusEntrySaveStatus";
import type { HusEntrySaveProgress } from "@/lib/hus-entry-save";
const partial:HusEntrySaveProgress={phase:"failed",errorStage:"photos",eventsSaved:true,writeStarted:true,totalPhotos:3,confirmedPhotos:2,unconfirmedPhotos:1,pendingPhotos:0,completedUploads:2};
describe("partial HUS save status",()=>{
  it.each(["lv","en"] as const)("distinguishes a saved event from unconfirmed photos (%s)",language=>{
    const html=renderToStaticMarkup(<HusEntrySaveStatus progress={partial} language={language} mode="event"/>);
    expect(html).toContain(language==="lv"?"Notikums un stādu izmaiņas saglabātas":"Event and plant changes saved");
    expect(html).toContain(language==="lv"?"Foto apstiprināti: 2/3":"Photos confirmed: 2/3");
    expect(html).toContain(language==="lv"?"Nav apstiprināta saglabāšana: 1":"Saving unconfirmed: 1");
    expect(html).not.toContain(language==="lv"?"Foto saglabāti: 3/3":"Photos saved: 3/3");
    expect(html).toContain('role="status"');
  });
  it("does not claim that a newly added archive observation is saved when its photo batch is unconfirmed",()=>{
    const html=renderToStaticMarkup(<HusEntrySaveStatus progress={{...partial,confirmedPhotos:0,unconfirmedPhotos:3}} language="lv" mode="observation"/>);
    expect(html).toContain("Foto apstiprināti: 0/3");expect(html).not.toContain("Novērojums saglabāts");expect(html).not.toContain("Notikums un stādu izmaiņas saglabātas");
  });
  it("only says all photos are saved after the entire operation has completed",()=>{
    const html=renderToStaticMarkup(<HusEntrySaveStatus progress={{...partial,phase:"complete",errorStage:undefined,confirmedPhotos:3,unconfirmedPhotos:0}} language="en" mode="event"/>);
    expect(html).toContain("Photos saved: 3/3");
  });
  it("reports note-only archive saves as observations instead of zero-photo uploads",()=>{
    const saving={...partial,phase:"photos" as const,totalPhotos:0,confirmedPhotos:0,unconfirmedPhotos:0,completedUploads:0};
    const active=renderToStaticMarkup(<HusEntrySaveStatus progress={saving} language="en" mode="observation"/>);
    expect(active).toContain("Saving observation");expect(active).not.toContain("0/0");
    const failed=renderToStaticMarkup(<HusEntrySaveStatus progress={{...saving,phase:"failed"}} language="en" mode="observation"/>);
    expect(failed).toContain("Observation saving is unconfirmed");expect(failed).not.toContain("Photos confirmed");
  });
  it("explains preparation failures without claiming any record was saved",()=>{
    const html=renderToStaticMarkup(<HusEntrySaveStatus progress={{...partial,errorStage:"preparing",eventsSaved:false,writeStarted:false,failedFile:"broken.jpg",confirmedPhotos:0,unconfirmedPhotos:0}} language="lv" mode="event"/>);
    expect(html).toContain("broken.jpg");expect(html).toContain("saglabāšana netika sākta");expect(html).not.toContain("Notikums un stādu izmaiņas saglabātas");
  });
  it("describes a lost event acknowledgement without falsely declaring it absent or retrying a new event",()=>{
    const html=renderToStaticMarkup(<HusEntrySaveStatus progress={{...partial,errorStage:"events",eventsSaved:false,confirmedPhotos:0,unconfirmedPhotos:0}} language="en" mode="event"/>);
    expect(html).toContain("Event saving is unconfirmed");expect(html).toContain("Photos have not been sent");expect(html).toContain("this dialog");
  });
});

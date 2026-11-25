import { describe, expect, it, vi } from "vitest";
import { buildHusEntrySubmission, createHusEntrySaveOperation, persistHusEntries } from "./hus-entry-save";
import { eventPhotoUploads, HusPhotoTransferError, sendHusMedia } from "./hus-photo-transfer";
import { calculatePlantBalance } from "./planning";
import type { HusMediaUploadInput } from "./hus-photo-archive";
import type { HusEventEntry, SowingPlanRow } from "./types";

const files = [1,2,3].map(n => new File(["synthetic "+n], "roots-"+n+".jpg", { type:"image/jpeg" }));
const event={id:"new-event",eventType:"other" as const,eventDate:"2026-11-25",note:"Synthetic observation",plantChange:-5,plantCorrectionId:"one-loss"};
const row:SowingPlanRow={id:"test-row",sectorName:"Test HUS",sowingDate:"2026-11-03",harvestDate:"2026-11-25",cycleLength:23,
  requiredPlants:3400,extraPlants:100,variety:"Synthetic",sectorType:26,plantsPerBox:12,correction:0,source:"user",husEvents:[],plantCorrections:[]};
function fixture() {
  let stored=structuredClone(row);
  const repository={load:async()=>[structuredClone(stored)],update:vi.fn(async(next:SowingPlanRow)=>{stored=structuredClone(next);return structuredClone(stored);})};
  const saveEvents=vi.fn(async(entries:HusEventEntry[])=>{await persistHusEntries(row.id,entries,repository);});
  const preparePhoto=vi.fn(async(file:File)=>new File(["prepared "+file.name],file.name,{type:"image/jpeg"}));
  const operation=createHusEntrySaveOperation({entries:[event],media:eventPhotoUploads(event.id,files)});
  return {operation,saveEvents,preparePhoto,repository,stored:()=>stored};
}

describe("multiple photos on a newly saved HUS event",()=>{
  it("prepares every image before persisting the event or loss, and keeps it editable on preparation failure",async()=>{
    const f=fixture(),upload=vi.fn(),prepare=vi.fn(async(file:File)=>{if(file===files[2])throw Error("Cannot decode image");return file;});
    await expect(f.operation.save({saveEvents:f.saveEvents,upload,preparePhoto:prepare})).rejects.toThrow("decode");
    expect(f.saveEvents).not.toHaveBeenCalled();expect(upload).not.toHaveBeenCalled();
    expect(f.operation.progress).toMatchObject({phase:"failed",errorStage:"preparing",writeStarted:false,eventsSaved:false,failedFile:"roots-3.jpg",confirmedPhotos:0});
    expect(f.stored().husEvents).toEqual([]);expect(f.stored().plantCorrections).toEqual([]);
  });
  it("confirms valid photos even if another fails, and retries only the unconfirmed image without duplicating event/loss",async()=>{
    const f=fixture();let fail=true;
    const attempts:HusMediaUploadInput[]=[];
    const upload=vi.fn(async(input:HusMediaUploadInput)=>{attempts.push(input);if(input.files[0].name===files[1].name&&fail)throw Error("storage unavailable");});
    await expect(f.operation.save({saveEvents:f.saveEvents,upload,preparePhoto:f.preparePhoto})).rejects.toThrow("storage unavailable");
    expect(f.operation.progress).toMatchObject({phase:"failed",errorStage:"photos",eventsSaved:true,totalPhotos:3,confirmedPhotos:2,unconfirmedPhotos:1});
    expect(attempts.map(input=>input.eventId)).toEqual([event.id,event.id,event.id]);
    expect(new Set(attempts.map(input=>input.uploadId)).size).toBe(3);
    fail=false;await f.operation.save({saveEvents:f.saveEvents,upload,preparePhoto:f.preparePhoto});
    expect(attempts).toHaveLength(4);expect(attempts[3].uploadId).toBe(attempts[1].uploadId);
    expect(attempts[3].files[0]).toBe(attempts[1].files[0]);expect(f.preparePhoto).toHaveBeenCalledTimes(3);
    expect(f.saveEvents).toHaveBeenCalledTimes(1);expect(f.repository.update).toHaveBeenCalledTimes(1);
    expect(f.stored().husEvents).toHaveLength(1);expect(f.stored().plantCorrections).toHaveLength(1);
    expect(calculatePlantBalance(f.stored()).correctionTotal).toBe(-5);
    expect(f.operation.progress).toMatchObject({phase:"complete",confirmedPhotos:3,unconfirmedPhotos:0});
  });
  it("automatically retries a lost response using the same upload identity and exact prepared bytes",async()=>{
    const f=fixture();const server=new Map<string,File>();let loseReply=true;
    const calls:HusMediaUploadInput[]=[];
    const upload=async(input:HusMediaUploadInput)=>{
      calls.push(input);server.set(input.uploadId!,input.files[0]);
      if(loseReply){loseReply=false;throw new HusPhotoTransferError("reply lost",true);}
    };
    await f.operation.save({saveEvents:f.saveEvents,preparePhoto:f.preparePhoto,upload});
    expect(calls).toHaveLength(4);expect(calls[0].uploadId).toBe(calls[1].uploadId);
    expect(calls[0].files[0]).toBe(calls[1].files[0]);expect(server.size).toBe(3);
    expect(f.operation.progress.confirmedPhotos).toBe(3);expect(f.preparePhoto).toHaveBeenCalledTimes(3);
    expect(f.saveEvents).toHaveBeenCalledTimes(1);expect(f.stored().plantCorrections).toHaveLength(1);
  });
  it("never reports success after an undefined rejection",async()=>{
    const f=fixture();await expect(f.operation.save({saveEvents:f.saveEvents,upload:async()=>{throw undefined;}})).rejects.toThrow("unconfirmed");
    expect(f.operation.progress).toMatchObject({phase:"failed",confirmedPhotos:0,unconfirmedPhotos:3});
  });
  it("shares repeated clicks even during preparation and waits for event confirmation before sending photos",async()=>{
    const f=fixture();let release!:()=>void;const wait=new Promise<void>(resolve=>{release=resolve;});
    const prepare=vi.fn(async(file:File)=>{await wait;return file;}),upload=vi.fn(async()=>{});
    const deps={saveEvents:f.saveEvents,preparePhoto:prepare,upload};
    const one=f.operation.save(deps),two=f.operation.save(deps);expect(one).toBe(two);expect(f.saveEvents).not.toHaveBeenCalled();
    release();await Promise.all([one,two]);expect(f.saveEvents).toHaveBeenCalledTimes(1);expect(upload).toHaveBeenCalledTimes(3);
    expect(f.stored().plantCorrections).toHaveLength(1);
  });
  it("does not send any image until a lost event response has been reconciled, and reuses the original IDs",async()=>{
    const f=fixture();let stored=structuredClone(row);let lost=true;
    const repository={load:async()=>[structuredClone(stored)],update:vi.fn(async(next:SowingPlanRow)=>{stored=next;if(lost){lost=false;throw new TypeError("Failed to fetch");}return next;})};
    const saveEvents=async(entries:HusEventEntry[])=>{await persistHusEntries(row.id,entries,repository);};
    const upload=vi.fn(async()=>{expect(stored.husEvents?.[0].id).toBe(event.id);});
    await f.operation.save({saveEvents,upload,preparePhoto:f.preparePhoto});
    expect(repository.update).toHaveBeenCalledTimes(1);expect(upload).toHaveBeenCalledTimes(3);expect(stored.plantCorrections).toHaveLength(1);
  });
  it("splits each damaged table's photos while retaining their own event and correction identities",()=>{
    const result=buildHusEntrySubmission({entry:null,eventType:"brownRoots",eventDate:"2026-11-20",readOnly:false,note:"Synthetic",
      otherLocation:"",validMovementRows:[],validBrownRootsRows:[{id:"C7",location:"C7",amount:2},{id:"C8",location:"C8",amount:3}],
      photos:[{target:"C7",file:files[0]},{target:"C7",file:files[1]},{target:"C8",file:files[2]}]});
    expect(result.entries.map(entry=>entry.plantChange)).toEqual([-2,-3]);
    expect(result.media.map(input=>[input.eventId,input.files.length])).toEqual([["C7",1],["C7",1],["C8",1]]);
    expect(new Set(result.entries.map(entry=>entry.plantCorrectionId)).size).toBe(2);
  });
  it("preserves a single archived observation batch and never writes production events on retry",async()=>{
    const result=buildHusEntrySubmission({entry:null,eventType:"other",eventDate:"2026-11-25",readOnly:true,note:"Synthetic archived note",
      otherLocation:"C7",validMovementRows:[],validBrownRootsRows:[],photos:files.map(file=>({target:"entry",file}))});
    expect(result.entries).toEqual([]);expect(result.media).toHaveLength(1);
    const op=createHusEntrySaveOperation(result),saveEvents=vi.fn(), notes=new Set<string>();let fail=true;
    const upload=async(input:HusMediaUploadInput)=>{notes.add(input.uploadId!);if(fail)throw Error("unknown response");};
    await expect(op.save({saveEvents,upload})).rejects.toThrow("unknown response");
    fail=false;await op.save({saveEvents,upload});expect(saveEvents).not.toHaveBeenCalled();expect(notes.size).toBe(1);
  });
  it("keeps every event photo request below one MiB for ten prepared 500-KiB images",async()=>{
    const large=Array.from({length:10},(_,index)=>new File([new Uint8Array(500*1024)],index+".jpg",{type:"image/jpeg"}));
    const op=createHusEntrySaveOperation({entries:[event],media:eventPhotoUploads(event.id,large)});
    const sizes:number[]=[];const seen=new Set<string>();
    const request=vi.fn(async(_url:unknown,init?:RequestInit)=>{
      const body=init!.body as FormData,images=body.getAll("photos") as File[];expect(images).toHaveLength(1);
      const uploadId=String(body.get("uploadId"));expect(seen.has(uploadId)).toBe(false);seen.add(uploadId);
      sizes.push((await new Request("https://synthetic.invalid",{method:"POST",body}).arrayBuffer()).byteLength);
      return new Response(JSON.stringify({photos:[{id:uploadId,sowingPlanRowId:row.id,husEventId:event.id,originalFileName:images[0].name,
        contentType:images[0].type,fileSizeBytes:images[0].size}]}),{status:200});
    });
    await op.save({saveEvents:async()=>{},upload:async input=>{await sendHusMedia(row.id,input,request as typeof fetch);}});
    expect(sizes).toHaveLength(10);expect(Math.max(...sizes)).toBeLessThan(1024*1024);expect(op.progress.confirmedPhotos).toBe(10);
  });
});

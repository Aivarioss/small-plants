import { describe, expect, it, vi } from "vitest";
import { confirmHusMediaResponse, HusPhotoTransferError, sendHusMedia } from "./hus-photo-transfer";
const file=new File(["synthetic"],"roots.jpg",{type:"image/jpeg"});
const input={eventId:"event",uploadId:"11111111-1111-4111-8111-111111111111",files:[file]};
const photo={id:"photo",sowingPlanRowId:"row",husEventId:"event",originalFileName:file.name,fileSizeBytes:file.size,contentType:file.type};
describe("photo request confirmation",()=>{
  it.each([null,{}, {photos:[]},{photos:[{...photo,sowingPlanRowId:"other"}]},{photos:[{...photo,husEventId:"other"}]},
    {photos:[{...photo,originalFileName:"different.jpg"}]},{photos:[{...photo,fileSizeBytes:999}]},{photos:[photo,photo]}])("refuses missing, partial, mismatched and duplicate acknowledgements",value=>{
    expect(()=>confirmHusMediaResponse(value,"row",input)).toThrow("not been fully confirmed");
  });
  it("accepts the exact event's photo and only confirms note-only saves with a returned note",()=>{
    expect(confirmHusMediaResponse({photos:[photo]},"row",input).photos).toHaveLength(1);
    expect(()=>confirmHusMediaResponse({photos:[]},"row",{files:[],note:"Observation"})).toThrow();
    expect(confirmHusMediaResponse({photos:[],note:{id:"note",sowingPlanRowId:"row"}},"row",{files:[],note:"Observation"}).note?.id).toBe("note");
  });
  it("requires archive photos to reference the returned observation of the same HUS",()=>{
    const archived={...photo,husEventId:undefined,husNoteId:"note"};
    const request={files:[file],note:"Observation"};
    expect(()=>confirmHusMediaResponse({photos:[archived]},"row",request)).toThrow("observation link");
    expect(confirmHusMediaResponse({photos:[archived],note:{id:"note",sowingPlanRowId:"row"}},"row",request).photos).toHaveLength(1);
    expect(()=>confirmHusMediaResponse({photos:[archived],note:{id:"note",sowingPlanRowId:"other"}},"row",request)).toThrow("observation link");
  });
  it.each([401,413,500])("gives a truthful error for non-JSON HTTP %s responses",async status=>{
    const request=vi.fn().mockResolvedValue(new Response("unreadable response",{status}));
    await expect(sendHusMedia("row",input,request)).rejects.toBeInstanceOf(HusPhotoTransferError);
    try{await sendHusMedia("row",input,request);}catch(error){expect((error as HusPhotoTransferError).retryable).toBe(status>=500);}
  });
  it("treats a lost connection and an incomplete success as unconfirmed, eligible for safe retry",async()=>{
    await expect(sendHusMedia("row",input,vi.fn().mockRejectedValue(new TypeError("Failed to fetch")))).rejects.toMatchObject({retryable:true});
    await expect(sendHusMedia("row",input,vi.fn().mockResolvedValue(new Response(JSON.stringify({photos:[]}))))).rejects.toMatchObject({retryable:true});
  });
});

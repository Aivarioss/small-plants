import { describe, expect, it } from "vitest";
import { parsePlanNumber } from "./plan-number-input";

describe("plan count input", () => {
  it.each(["", " ", "-", "1.5", "NaN", "Infinity", "9007199254740992"])("does not publish an unfinished or invalid count: %s", text => {
    expect(parsePlanNumber(text,1)).toEqual({valid:false});
  });
  it("allows deliberate zero extra, positive counts, and optional clearing only where permitted", () => {
    expect(parsePlanNumber("0")).toEqual({ valid:true, value:0 });
    expect(parsePlanNumber("0",1)).toEqual({ valid:false });
    expect(parsePlanNumber("3500",1)).toEqual({ valid:true, value:3500 });
    expect(parsePlanNumber("",1,true)).toEqual({ valid:true, value:undefined });
    expect(parsePlanNumber("-10")).toEqual({ valid:false });
    expect(parsePlanNumber("54",1,false,53)).toEqual({ valid:false });
  });
});

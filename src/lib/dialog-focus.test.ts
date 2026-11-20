import { describe, expect, it, vi } from "vitest";
import { bindDialogFocus } from "./dialog-focus";

// A small DOM stand-in exercises the real keyboard/focus controller, including nested dialogs.
class FocusDocument extends EventTarget {
  body={ style:{overflow:"auto"} };
  activeElement: FocusElement | null=null;
}
class FocusElement {
  tabIndex=0; isConnected=true; disabled=false; hidden=false;
  children: FocusElement[]=[];
  constructor(public ownerDocument:FocusDocument) {}
  focus() { this.ownerDocument.activeElement=this; const event=new Event("focusin");
    Object.defineProperty(event,"target",{value:this}); this.ownerDocument.dispatchEvent(event); }
  contains(value:FocusElement):boolean { return value===this || this.children.some(child=>child.contains(value)); }
  querySelectorAll() { return this.children; }
  querySelector() { return this.children[0]; }
  matches() { return this.disabled; }
  closest() { return this.hidden ? this : null; }
  getClientRects() { return this.hidden ? [] : [{}]; }
}
function setup(doc=new FocusDocument()) {
  const trigger=new FocusElement(doc); trigger.focus();
  const dialog=new FocusElement(doc), first=new FocusElement(doc), last=new FocusElement(doc);
  dialog.children=[first,last];
  const close=vi.fn();
  const stop=bindDialogFocus(dialog as unknown as HTMLElement,close);
  return { doc,trigger,dialog,first,last,close,stop };
}
function key(doc:FocusDocument,value:string,shiftKey=false) {
  const event=new Event("keydown",{cancelable:true});
  Object.defineProperties(event,{key:{value},shiftKey:{value:shiftKey}});
  doc.dispatchEvent(event); return event;
}
describe("shared dialog keyboard policy",()=>{
  it("focuses the dialog, traps Tab in both directions, closes with Escape and restores focus/scroll",()=>{
    const {doc,trigger,first,last,close,stop}=setup();
    expect(doc.activeElement).toBe(first); expect(doc.body.style.overflow).toBe("hidden");
    expect(key(doc,"Tab",true).defaultPrevented).toBe(true); expect(doc.activeElement).toBe(last);
    key(doc,"Tab"); expect(doc.activeElement).toBe(first);
    expect(key(doc,"Escape").defaultPrevented).toBe(true); expect(close).toHaveBeenCalledTimes(1);
    stop(); expect(doc.activeElement).toBe(trigger); expect(doc.body.style.overflow).toBe("auto");
    key(doc,"Escape"); expect(close).toHaveBeenCalledTimes(1);
  });
  it("excludes disabled/hidden controls and contains focus even when controls become disabled while saving",()=>{
    const {doc,dialog,first,last,stop}=setup();
    first.disabled=true; last.focus(); key(doc,"Tab"); expect(doc.activeElement).toBe(last);
    last.hidden=true; key(doc,"Tab"); expect(doc.activeElement).toBe(dialog);
    new FocusElement(doc).focus(); expect(doc.activeElement).toBe(dialog);
    stop();
  });
  it("only dismisses the topmost dialog and restores the underlying focus and scroll lock",()=>{
    const outer=setup(); const inner=setup(outer.doc);
    // In the browser, an inner dialog is inside the outer work surface.
    outer.dialog.children.push(inner.dialog,inner.trigger);
    key(outer.doc,"Escape"); expect(inner.close).toHaveBeenCalledTimes(1); expect(outer.close).not.toHaveBeenCalled();
    inner.stop(); expect(outer.doc.body.style.overflow).toBe("hidden");
    key(outer.doc,"Escape"); expect(outer.close).toHaveBeenCalledTimes(1);
    outer.stop(); expect(outer.doc.body.style.overflow).toBe("auto");
  });
});

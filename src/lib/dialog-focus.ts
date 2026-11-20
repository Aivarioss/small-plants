type DialogStack = { dialogs: HTMLElement[]; overflow: string };
const stacks = new WeakMap<Document, DialogStack>();

/** One keyboard policy for all app dialogs; callbacks may change without resetting focus. */
export function bindDialogFocus(dialog: HTMLElement, onDismiss: () => void, initialFocus?: string): () => void {
  const doc = dialog.ownerDocument;
  const previous = doc.activeElement as HTMLElement | null;
  const stack = stacks.get(doc) ?? { dialogs: [], overflow: doc.body.style.overflow };
  stacks.set(doc, stack);
  stack.dialogs.push(dialog);
  doc.body.style.overflow = "hidden";
  const controls = () => Array.from(dialog.querySelectorAll<HTMLElement>(
    'button, input, select, textarea, a[href], [tabindex]'
  )).filter(element => element.tabIndex >= 0 && !element.matches(":disabled") &&
    !element.closest('[hidden], [inert], [aria-hidden="true"]') && element.getClientRects().length > 0);
  const first = () => controls()[0] ?? dialog;
  (initialFocus ? dialog.querySelector<HTMLElement>(initialFocus) ?? first() : first()).focus();
  function keyDown(event: KeyboardEvent) {
    if (stack.dialogs.at(-1) !== dialog) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onDismiss(); }
    if (event.key !== "Tab") return;
    const elements = controls();
    if (!elements.length) { event.preventDefault(); dialog.focus(); return; }
    const index = elements.indexOf(doc.activeElement as HTMLElement);
    if (index < 0 || event.shiftKey && index === 0 || !event.shiftKey && index === elements.length - 1) {
      event.preventDefault();
      (event.shiftKey ? elements.at(-1)! : elements[0]).focus();
    }
  }
  function focusIn(event: FocusEvent) {
    if (stack.dialogs.at(-1) === dialog && !dialog.contains(event.target as Node)) first().focus();
  }
  doc.addEventListener("keydown", keyDown);
  doc.addEventListener("focusin", focusIn);
  return () => {
    doc.removeEventListener("keydown", keyDown);
    doc.removeEventListener("focusin", focusIn);
    const wasTop = stack.dialogs.at(-1) === dialog;
    stack.dialogs = stack.dialogs.filter(value => value !== dialog);
    if (!stack.dialogs.length) { doc.body.style.overflow = stack.overflow; stacks.delete(doc); }
    if (wasTop && previous?.isConnected) previous.focus();
  };
}

"use client";
import { useEffect, useRef, type HTMLAttributes } from "react";
import { bindDialogFocus } from "@/lib/dialog-focus";

export function Modal({ onClose, dismissDisabled = false, initialFocus, ...props }: HTMLAttributes<HTMLElement> & {
  onClose: () => void; dismissDisabled?: boolean; initialFocus?: string;
}) {
  const ref = useRef<HTMLElement>(null);
  const current = useRef({ onClose, dismissDisabled });
  useEffect(() => { current.current = { onClose, dismissDisabled }; }, [onClose, dismissDisabled]);
  useEffect(() => {
    if (ref.current) return bindDialogFocus(ref.current, () => {
      if (!current.current.dismissDisabled) current.current.onClose();
    }, initialFocus);
  }, [initialFocus]);
  return <section {...props} ref={ref} tabIndex={-1} role="dialog" aria-modal="true" />;
}

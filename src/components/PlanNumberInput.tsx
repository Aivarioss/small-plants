"use client";
import { useRef, useState } from "react";
import { parsePlanNumber } from "@/lib/plan-number-input";

/** Keep an incomplete edit local; publish a valid value once on blur/Enter. Escape cancels. */
export function PlanNumberInput({ value, onCommit, min = 0, max, optional = false }: {
  value?: number; onCommit: (value: number | undefined) => void; min?: number; max?: number; optional?: boolean;
}) {
  const [text, setText] = useState(String(value ?? ""));
  const [editing, setEditing] = useState(false);
  const cancelled = useRef(false);
  return <input type="number" min={min} max={max} step={1} value={editing ? text : value ?? ""}
    onFocus={() => { cancelled.current = false; setText(String(value ?? "")); setEditing(true); }}
    onChange={event => setText(event.target.value)}
    onBlur={() => {
      setEditing(false);
      const parsed = parsePlanNumber(text, min, optional, max);
      if (!cancelled.current && parsed.valid && parsed.value !== value) onCommit(parsed.value);
    }}
    onKeyDown={event => {
      if (event.key === "Enter" || event.key === "Escape") {
        event.preventDefault(); cancelled.current = event.key === "Escape"; event.currentTarget.blur();
      }
    }} />;
}

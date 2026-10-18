import { useState } from "react";

/**
 * − number +, for a whole number in a range. What is typed is taken as it
 * is entered while it is a number in range; anything else is left alone,
 * and leaving the field puts back the value in use.
 */
export function Stepper({
  value,
  min,
  max,
  step = 1,
  onChange,
  label,
  fewer,
  more,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  /** The field's name, and what − and + do, for screen readers. */
  label: string;
  fewer: string;
  more: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  return (
    <div className="minute-stepper">
      <button aria-label={fewer} title={fewer} disabled={value <= min} onClick={() => onChange(clamp(value - step))}>−</button>
      <input
        type="number"
        min={min}
        max={max}
        aria-label={label}
        value={draft ?? String(value)}
        onChange={(e) => {
          const text = e.target.value;
          setDraft(text);
          const n = Number(text);
          if (text !== "" && Number.isInteger(n) && n >= min && n <= max) onChange(n);
        }}
        onBlur={() => setDraft(null)}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
      <button aria-label={more} title={more} disabled={value >= max} onClick={() => onChange(clamp(value + step))}>+</button>
    </div>
  );
}

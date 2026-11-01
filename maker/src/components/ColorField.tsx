import { useT } from "../i18n/useT";
import { ColorWheel } from "./ColorWheel";

/** The ready-made colours: light ones for a background, the last dark. */
export const SWATCHES = ["#ffffff", "#fffaee", "#fdf0c4", "#e3f1fc", "#dff2ea", "#fde4ea", "#efedff", "#353754"];

/** A row of swatches and a custom one that opens a colour wheel: the icon's
 *  background, the speech bubble's colours. `open` is the wheel. */
export function ColorField({
  label,
  value,
  swatches = SWATCHES,
  open,
  onOpenChange,
  onChange,
}: {
  label: string;
  value: string;
  swatches?: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (hex: string) => void;
}) {
  const t = useT();
  return (
    <div className="background-picker">
      <span>{label}</span>
      <div className="swatches">
        {swatches.map((c) => (
          <button
            key={c}
            className={`swatch${value.toLowerCase() === c ? " on" : ""}`}
            style={{ background: c }}
            aria-label={c}
            onClick={() => {
              onOpenChange(false);
              onChange(c);
            }}
          />
        ))}
        <button
          className={`swatch custom${swatches.includes(value.toLowerCase()) && !open ? "" : " on"}`}
          aria-label={t.customColor}
          aria-expanded={open}
          title={t.customColor}
          onClick={() => onOpenChange(!open)}
        />
      </div>
      {open && (
        <div className="wheel-popover">
          <ColorWheel value={value} onChange={onChange} />
        </div>
      )}
    </div>
  );
}

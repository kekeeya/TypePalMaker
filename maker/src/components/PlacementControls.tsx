import type { CSSProperties } from "react";
import { useT } from "../i18n/useT";

/** Pixels per arrow press. */
const STEP = 8;

export interface PlacementValue {
  scale: number;
  offsetX: number;
  offsetY: number;
  rotation: number;
}

/** Scale, move, rotate and reset: the "画面" tools, for a frame or the icon.
 *  `size` is shown beside the scale, e.g. "261 × 238 px". */
export function PlacementControls({
  value,
  onChange,
  disabled = false,
  size,
}: {
  value: PlacementValue;
  onChange: (patch: Partial<PlacementValue>) => void;
  disabled?: boolean;
  size?: string | null;
}) {
  const t = useT();
  const scale = Math.round(value.scale * 100);
  const move = (x: number, y: number) => onChange({ offsetX: value.offsetX + x, offsetY: value.offsetY + y });
  return (
    <>
      <div className="transform-group">
        <label>
          <span>{t.scale}</span>
          {size && <em>{size}</em>}
          <b>{scale}%</b>
        </label>
        <input
          type="range"
          min="25"
          max="250"
          disabled={disabled}
          value={scale}
          aria-label={t.scale}
          style={{ "--fill": `${((scale - 25) / 225) * 100}%` } as CSSProperties}
          onChange={(e) => onChange({ scale: Number(e.target.value) / 100 })}
        />
      </div>
      <div className="move-image">
        <div className="move-heading">
          <span>{t.moveImage}</span>
          <small>{t.moveStep(STEP)}</small>
        </div>
        <div className="move-pad">
          <button aria-label={t.moveUp} disabled={disabled} onClick={() => move(0, -STEP)}><Arrow rotate={0} /></button>
          <button aria-label={t.moveLeft} disabled={disabled} onClick={() => move(-STEP, 0)}><Arrow rotate={-90} /></button>
          <button className="move-center" aria-label={t.moveCenter} disabled={disabled} onClick={() => onChange({ offsetX: 0, offsetY: 0 })}>
            <i />
          </button>
          <button aria-label={t.moveRight} disabled={disabled} onClick={() => move(STEP, 0)}><Arrow rotate={90} /></button>
          <button aria-label={t.moveDown} disabled={disabled} onClick={() => move(0, STEP)}><Arrow rotate={180} /></button>
        </div>
      </div>
      <div className="transform-group">
        <label>
          <span>{t.rotation}</span>
          <b>{value.rotation}°</b>
        </label>
        <input
          type="range"
          min="-180"
          max="180"
          disabled={disabled}
          value={value.rotation}
          aria-label={t.rotation}
          style={{ "--fill": `${((value.rotation + 180) / 360) * 100}%` } as CSSProperties}
          onChange={(e) => onChange({ rotation: Number(e.target.value) })}
        />
      </div>
      <button className="reset-transform" disabled={disabled} onClick={() => onChange({ scale: 1, offsetX: 0, offsetY: 0, rotation: 0 })}>
        <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
          <path d="M3 4.2A3.8 3.8 0 1 1 2.4 7.6M3 1.6v2.6h2.6" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        {t.reset}
      </button>
    </>
  );
}

function Arrow({ rotate }: { rotate: number }) {
  return (
    <svg viewBox="0 0 14 14" width="13" height="13" aria-hidden="true" style={{ transform: `rotate(${rotate}deg)` }}>
      <path d="M7 12V2M3 6l4-4 4 4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

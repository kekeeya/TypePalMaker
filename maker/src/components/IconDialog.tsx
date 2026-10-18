import { useEffect, useState } from "react";
import { assetBounds, type Box } from "../model/bounds";
import { useT } from "../i18n/useT";
import { iconRect, iconSource, ICON_SIDE, IDLE_COVER_ID } from "../model/icon";
import type { FrameAsset, IconStyle, Project } from "../model/types";
import { ColorWheel } from "./ColorWheel";
import { PlacementControls } from "./PlacementControls";

const SWATCHES = ["#ffffff", "#fffaee", "#fdf0c4", "#e3f1fc", "#dff2ea", "#fde4ea", "#efedff", "#353754"];

/** The visible part of a picture, or undefined until it is known. Null
 *  asks for no crop. */
/** The picture the icon shows (see `iconSource`), worked out again only when
 *  what it is drawn from changes. */
export function useIconSource(project: Project): FrameAsset | undefined {
  const [source, setSource] = useState<FrameAsset>();
  const { icon, frames, canvas, fps } = project;
  const idle = project.states.idle;
  useEffect(() => {
    let alive = true;
    void iconSource(project).then((found) => {
      if (alive) setSource(found);
      else if (found?.id === IDLE_COVER_ID) URL.revokeObjectURL(found.url);
    });
    return () => {
      alive = false;
    };
    // Only what the picture is drawn from: not the name, not other reactions.
  }, [icon, frames, canvas, fps, idle]);
  // The drawn picture showing is let go once another replaces it, or the
  // page closes.
  useEffect(
    () => () => {
      if (source?.id === IDLE_COVER_ID) URL.revokeObjectURL(source.url);
    },
    [source],
  );
  return source;
}

export function useCrop(asset: FrameAsset | undefined, wanted: boolean): Box | null | undefined {
  const [found, setFound] = useState<{ asset?: FrameAsset; box: Box | null }>();
  useEffect(() => {
    if (!asset || !wanted) return;
    let alive = true;
    void assetBounds(asset).then((box) => alive && setFound({ asset, box }));
    return () => {
      alive = false;
    };
  }, [asset, wanted]);
  if (!asset || !wanted) return null;
  return found?.asset === asset ? found.box : undefined;
}

/** The app icon as it will look: background, then the placed picture.
 *  `crop` is the part of the picture to frame (see `iconRect`); undefined
 *  while it is still being worked out. */
export function IconPreview({
  source,
  crop,
  style,
  side,
}: {
  source?: FrameAsset;
  crop: Box | null | undefined;
  style: IconStyle;
  side: number;
}) {
  const k = side / ICON_SIDE;
  const r = source && crop !== undefined ? iconRect(source, crop) : null;
  return (
    <span className="icon-preview" style={{ width: side, height: side, background: style.background }}>
      {source && r && (
        <img
          src={source.url}
          alt=""
          draggable={false}
          style={{
            left: r.left * k,
            top: r.top * k,
            width: r.width * k,
            height: r.height * k,
            transform: `translate(${style.offsetX * k}px, ${style.offsetY * k}px) scale(${style.scale}) rotate(${style.rotation}deg)`,
            // Placement pivots on the icon's centre.
            transformOrigin: `${(ICON_SIDE / 2 - r.left) * k}px ${(ICON_SIDE / 2 - r.top) * k}px`,
          }}
        />
      )}
    </span>
  );
}

/** Adjusts the app icon: the picture's scale, position and rotation, and the
 *  background colour. */
export function IconDialog({
  source,
  crop,
  initial,
  onCancel,
  onDone,
}: {
  source?: FrameAsset;
  crop: Box | null | undefined;
  initial: IconStyle;
  onCancel: () => void;
  onDone: (style: IconStyle) => void;
}) {
  const t = useT();
  const [style, setStyle] = useState(initial);
  const [wheelOpen, setWheelOpen] = useState(false);
  const r = source && crop !== undefined ? iconRect(source, crop) : null;
  const size = r ? `${Math.round(r.shown.width * style.scale)} × ${Math.round(r.shown.height * style.scale)} px` : null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (wheelOpen) setWheelOpen(false);
      else onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, wheelOpen]);

  return (
    <div className="overlay" role="dialog" aria-modal="true">
      <div className="icon-dialog">
        <button type="button" className="dialog-close" aria-label={t.close} onClick={onCancel}>
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <path d="M2 2l6 6M8 2 2 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
        <h2>{t.iconTitle}</h2>
        <div className="icon-dialog-body">
          <div className="icon-stage">
            <IconPreview source={source} crop={crop} style={style} side={240} />
          </div>
          <div className="icon-controls">
            <PlacementControls value={style} size={size} disabled={!source} onChange={(patch) => setStyle((s) => ({ ...s, ...patch }))} />
            <div className="background-picker">
              <span>{t.background}</span>
              <div className="swatches">
                {SWATCHES.map((c) => (
                  <button
                    key={c}
                    className={`swatch${style.background.toLowerCase() === c ? " on" : ""}`}
                    style={{ background: c }}
                    aria-label={c}
                    onClick={() => {
                      setWheelOpen(false);
                      setStyle((s) => ({ ...s, background: c }));
                    }}
                  />
                ))}
                <button
                  className={`swatch custom${SWATCHES.includes(style.background.toLowerCase()) && !wheelOpen ? "" : " on"}`}
                  aria-label={t.customColor}
                  aria-expanded={wheelOpen}
                  title={t.customColor}
                  onClick={() => setWheelOpen((o) => !o)}
                />
              </div>
              {wheelOpen && (
                <div className="wheel-popover">
                  <ColorWheel value={style.background} onChange={(background) => setStyle((s) => ({ ...s, background }))} />
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="dialog-actions">
          <button type="button" className="soft-button" onClick={onCancel}>
            {t.cancel}
          </button>
          <button type="button" className="primary-button" onClick={() => onDone(style)}>
            {t.done}
          </button>
        </div>
      </div>
    </div>
  );
}

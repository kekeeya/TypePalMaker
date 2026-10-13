import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { useT } from "../i18n/useT";
import { PetBehavior, playedAs, StrokeRecognizer, StrokeTuning } from "../model/behavior";
import { fitRect } from "../model/placement";
import { PET_STATES, type FrameAsset, type PetState, type Project } from "../model/types";
import { playable } from "../model/validate";
import { useEditor } from "../store";
import { FrameStack, useFramePlayer } from "./Sprite";

const now = () => performance.now() / 1000;

/**
 * The pet as it will behave on the desktop, at its real size, driven by the
 * same rules as the runtime: type anywhere, click the empty stage, click the
 * pet, or rub the pointer back and forth over it. Shows the baked project —
 * the very pictures the app will get.
 */
export function Preview({ project }: { project: Project }) {
  const t = useT();
  const close = useEditor((s) => s.setPreviewOpen);

  const behavior = useMemo(() => new PetBehavior((s) => playable(project, s)), [project]);
  const stroke = useRef(new StrokeRecognizer());
  const [shown, setShown] = useState<{ state: PetState; round: number }>({ state: "idle", round: 0 });
  const state = shown.state;
  const settle = useRef<number | undefined>(undefined);

  /** Shows what the behaviour decided: a new round plays from its first
   *  frame, the round already playing carries on — as in the runtime. */
  const refresh = useCallback(
    () =>
      setShown((s) =>
        s.state === behavior.current && s.round === behavior.round ? s : { state: behavior.current, round: behavior.round },
      ),
    [behavior],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return close(false);
      behavior.keyPressed(now());
      refresh();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.clearTimeout(settle.current);
      alphaCache.clear();
    };
  }, [behavior, refresh, close]);

  const own = playable(project, state);
  // Memoised per round: a fresh object would read as a new round.
  const spec = useMemo(() => (own ? playedAs(own, state) : null), [own, state]);
  const index = useFramePlayer(spec, {
    restartKey: state === "idle" ? "idle" : shown.round,
    onFinished: () => {
      behavior.roundFinished(now());
      refresh();
    },
  });
  const frame = spec ? project.frames[spec.frames[index]?.id] : undefined;
  const box = { width: (project.canvas.width * 72) / project.canvas.dpi, height: (project.canvas.height * 72) / project.canvas.dpi };
  const petRef = useRef<HTMLDivElement>(null);

  /** On the artwork itself, not the transparent space around it. */
  const onPet = (e: MouseEvent) => {
    const el = petRef.current;
    if (!el || !frame) return false;
    const r = el.getBoundingClientRect();
    return isOpaque(frame, box, e.clientX - r.left, e.clientY - r.top);
  };

  return (
    <div className="overlay preview-overlay">
      <div className="preview">
        <div className="preview-head">
          <h2>{t.previewTitle}</h2>
          <span className="preview-state">
            {t.previewState}: <b>{t.stateNames[state]}</b>
          </span>
          <button onClick={() => close(false)}>{t.closePreview}</button>
        </div>
        <p className="note">{t.previewHelp}</p>
        <div
          className="stage"
          onMouseDown={(e) => {
            if (onPet(e)) {
              behavior.tapped(now());
              refresh();
            } else {
              behavior.mouseClicked(now());
              refresh();
            }
          }}
          onMouseMove={(e) => {
            const r = stroke.current;
            if (e.buttons !== 0) r.reset();
            else r.track(e.screenX, onPet(e), now());
            behavior.setStroking(r.isStroking, now());
            refresh();
            window.clearTimeout(settle.current);
            settle.current = window.setTimeout(() => {
              r.settle(now());
              behavior.setStroking(r.isStroking, now());
              refresh();
            }, (StrokeTuning.strokeLapse + 0.05) * 1000);
          }}
          onMouseLeave={() => {
            stroke.current.reset();
            behavior.setStroking(false, now());
            refresh();
          }}
        >
          <div ref={petRef} className="pet-box" style={{ width: box.width, height: box.height }}>
            {PET_STATES.map((s) => {
              const own = playable(project, s);
              return (
                own && (
                  <FrameStack
                    key={s}
                    frames={project.frames}
                    entries={own.frames}
                    shown={s === state ? index : -1}
                    canvas={project.canvas}
                    ratio={box.width / project.canvas.width}
                  />
                )
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Alpha hit test against the frame as drawn, with the runtime's one-pixel
 *  slack. Pixels are read once per frame and size, then cached. */
const alphaCache = new Map<string, { data: Uint8ClampedArray; w: number; h: number }>();

function isOpaque(frame: FrameAsset, box: { width: number; height: number }, x: number, y: number): boolean {
  const r = fitRect(frame, box);
  if (x < r.left - 2 || y < r.top - 2 || x > r.left + r.width + 2 || y > r.top + r.height + 2) return false;
  const w = Math.max(1, Math.round(r.width));
  const h = Math.max(1, Math.round(r.height));
  const key = `${frame.id}@${w}x${h}`;
  let cached = alphaCache.get(key);
  if (!cached) {
    const img = new Image();
    img.src = frame.url;
    if (!img.complete) return true; // not decoded yet: be generous
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0, w, h);
    cached = { data: ctx.getImageData(0, 0, w, h).data, w, h };
    alphaCache.set(key, cached);
  }
  const px = Math.floor(x - r.left);
  const py = Math.floor(y - r.top);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = px + dx;
      const cy = py + dy;
      if (cx < 0 || cy < 0 || cx >= cached.w || cy >= cached.h) continue;
      if (cached.data[(cy * cached.w + cx) * 4 + 3] > 24) return true;
    }
  }
  return false;
}

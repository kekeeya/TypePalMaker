import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { useT } from "../i18n/useT";
import { PetBehavior, PetSpeech, playedAs, StrokeRecognizer, StrokeTuning } from "../model/behavior";
import { fitRect } from "../model/placement";
import { entryAtCell } from "../model/timeline";
import { PET_STATES, timelineTracks, variantRows, type FrameAsset, type PetState, type Project } from "../model/types";
import { playable } from "../model/validate";
import { useEditor } from "../store";
import { FrameStack, useTimelinePlayer } from "./Sprite";

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
  const [shown, setShown] = useState<{ state: PetState; round: number; variant: string | null }>({ state: "idle", round: 0, variant: null });
  const state = shown.state;
  const settle = useRef<number | undefined>(undefined);
  const sleepTimer = useRef<number | undefined>(undefined);
  const variantTimer = useRef<number | undefined>(undefined);
  const speech = useRef(new PetSpeech());
  const [line, setLine] = useState<string | null>(null);
  const lineTimer = useRef<number | undefined>(undefined);

  /** Shows what the behaviour decided: a new round plays from its first
   *  frame, the round already playing carries on — as in the runtime. */
  const refresh = useCallback(
    () =>
      setShown((s) =>
        s.state === behavior.current && s.round === behavior.round
          ? s
          : { state: behavior.current, round: behavior.round, variant: behavior.variant },
      ),
    [behavior],
  );

  /** Arms the timers for falling asleep and for idle's or sleep's next
   *  random action. */
  const armTimers = useCallback(() => {
    window.clearTimeout(sleepTimer.current);
    window.clearTimeout(variantTimer.current);
    const current = now();
    const asleep = behavior.nextSleepDeadline(current);
    if (asleep !== null) {
      sleepTimer.current = window.setTimeout(() => {
        behavior.checkInactivity(now());
        refresh();
        armTimers();
      }, Math.max(0, asleep - current) * 1000 + 10);
    }
    const action = behavior.nextVariantDeadline(current);
    if (action !== null) {
      variantTimer.current = window.setTimeout(() => {
        behavior.checkVariants(now());
        refresh();
        armTimers();
      }, Math.max(0, action - current) * 1000 + 10);
    }
  }, [behavior, refresh]);

  useEffect(() => {
    behavior.activity(now());
    armTimers();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") return close(false);
      behavior.keyPressed(now());
      refresh();
      armTimers();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.clearTimeout(settle.current);
      window.clearTimeout(sleepTimer.current);
      window.clearTimeout(variantTimer.current);
      window.clearTimeout(lineTimer.current);
      alphaCache.clear();
    };
  }, [behavior, refresh, close, armTimers]);

  const own = playable(project, state);
  const action = own?.variants?.find((v) => v.id === shown.variant);
  // Memoised per round: a fresh object would read as a new round. A random
  // action plays once, then the reaction loops as usual again.
  const spec = useMemo(
    () => (own ? (action ? { ...own, loop: false, frames: [], tracks: variantRows(own, action) } : playedAs(own, state)) : null),
    [own, action, state],
  );

  // What a new round or a new reaction says, as the runtime decides it.
  const spoken = useRef<{ state: PetState | null; round: number }>({ state: null, round: -1 });
  useEffect(() => {
    if (!own) return;
    const entered = spoken.current.state !== state;
    const newRound = spoken.current.round !== shown.round;
    spoken.current = { state, round: shown.round };
    if (!entered && !newRound) return;
    const said = speech.current.say(PetSpeech.pool(state, own, action, entered), now());
    if (!said) return;
    setLine(said);
    window.clearTimeout(lineTimer.current);
    lineTimer.current = window.setTimeout(() => setLine(null), PetSpeech.duration(said) * 1000);
  }, [own, action, state, shown.round]);

  const cell = useTimelinePlayer(spec, {
    restartKey: state === "idle" && !action ? "idle" : shown.round,
    onFinished: () => {
      behavior.roundFinished(now());
      refresh();
      armTimers();
    },
  });
  const visibleFrames = spec
    ? timelineTracks(spec).flatMap((track) => {
        const entry = entryAtCell(track, project.fps, cell)?.entry;
        const frame = entry && project.frames[entry.id];
        return frame ? [frame] : [];
      })
    : [];
  const box = { width: (project.canvas.width * 72) / project.canvas.dpi, height: (project.canvas.height * 72) / project.canvas.dpi };
  const petRef = useRef<HTMLDivElement>(null);

  /** On the artwork itself, not the transparent space around it. */
  const onPet = (e: MouseEvent) => {
    const el = petRef.current;
    if (!el || !visibleFrames.length) return false;
    const r = el.getBoundingClientRect();
    return visibleFrames.some((frame) => isOpaque(frame, box, e.clientX - r.left, e.clientY - r.top));
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
              armTimers();
            } else {
              behavior.mouseClicked(now());
              refresh();
              armTimers();
            }
          }}
          onMouseMove={(e) => {
            behavior.activity(now());
            armTimers();
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
            {line && <div className="line-bubble preview-bubble"><b>{line}</b></div>}
            {PET_STATES.map((s) => {
              const own = playable(project, s);
              if (!own) return null;
              const tracks = s === state && spec ? timelineTracks(spec) : timelineTracks(own);
              return tracks.map((track, trackIndex) => (
                <FrameStack
                  key={`${s}-${trackIndex}-${track.id}`}
                  frames={project.frames}
                  entries={track.frames}
                  shown={s === state ? entryAtCell(track, project.fps, cell)?.index ?? -1 : -1}
                  canvas={project.canvas}
                  ratio={box.width / project.canvas.width}
                  style={{ zIndex: tracks.length - trackIndex }}
                />
              ));
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

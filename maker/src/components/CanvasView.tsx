import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useT } from "../i18n/useT";
import { useEditor } from "../store";
import { FrameStack, useFramePlayer } from "./Sprite";

/** The canvas's longer side on screen, at most; less when the window is
 *  small. */
const PAPER_SIDE = 324;
/** Room kept for the toolbar and the paper's margin. */
const PAPER_CHROME = { x: 120, y: 150 };
/** The size last measured, to start from when the view mounts again. */
let lastSide = PAPER_SIDE;

/**
 * The selected frame on the pet's canvas, over a checkerboard; the dashed
 * outline is the canvas edge. Play loops the whole reaction.
 */
export function CanvasView() {
  const t = useT();
  const project = useEditor((s) => s.project);
  const state = useEditor((s) => s.selectedState);
  const index = useEditor((s) => s.selectedIndex);
  const [playing, setPlaying] = useState(false);
  const section = useRef<HTMLElement>(null);
  const [side, setSide] = useState(lastSide);

  // Measured before the first paint, so switching reactions (which mounts
  // this anew) never shows the paper at a stale size first.
  useLayoutEffect(() => {
    const el = section.current;
    if (!el) return;
    const measure = () => {
      lastSide = Math.max(120, Math.min(PAPER_SIDE, el.clientWidth - PAPER_CHROME.x, el.clientHeight - PAPER_CHROME.y));
      setSide(lastSide);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const spec = project.states[state];
  // Memoised: a fresh object each render would read as a new state and keep
  // restarting the animation from its first frame.
  // The editor's play button loops every reaction, play-once ones too, so
  // they can be watched over and over.
  const playSpec = useMemo(() => (playing ? { ...spec, loop: true } : null), [playing, spec]);
  const playIndex = useFramePlayer(playSpec, { playing });

  const { canvas } = project;
  const ratio = side / Math.max(canvas.width, canvas.height);
  const shown = playing ? playIndex : (index ?? 0);

  return (
    <section className="canvas soft-card" ref={section}>
      <div className="canvas-toolbar">
        <span className="panel-kicker">{t.motionPreview}</span>
        <button
          className={`round-tool${playing ? " on" : ""}`}
          aria-label={playing ? t.pause : t.play}
          onClick={() => setPlaying(!playing)}
          disabled={!spec.frames.length}
        >
          {playing ? <PauseIcon /> : <PlayIcon />}
        </button>
      </div>
      <div className="canvas-viewport">
        <div className="canvas-paper">
          <div className="pet-box checker" style={{ width: canvas.width * ratio, height: canvas.height * ratio }}>
            <FrameStack frames={project.frames} entries={spec.frames} shown={shown} canvas={canvas} ratio={ratio} />
          </div>
        </div>
      </div>
    </section>
  );
}

export function PlayIcon() {
  return (
    <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
      <path d="M3 1.8v8.4c0 .5.5.8 1 .5l6.4-4.2c.4-.3.4-.8 0-1.1L4 1.3c-.5-.3-1 0-1 .5Z" fill="currentColor" />
    </svg>
  );
}

function PauseIcon() {
  return (
    <svg viewBox="0 0 12 12" width="11" height="11" aria-hidden="true">
      <rect x="2.5" y="1.5" width="2.6" height="9" rx="1" fill="currentColor" />
      <rect x="6.9" y="1.5" width="2.6" height="9" rx="1" fill="currentColor" />
    </svg>
  );
}

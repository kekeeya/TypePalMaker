import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { useT } from "../i18n/useT";
import { useEditor } from "../store";
import { entryAtCell, entryStartCell } from "../model/timeline";
import { baseTrack, timelineTracks, variantRows } from "../model/types";
import { FrameStack, useTimelinePlayer } from "./Sprite";
import { PetSpeech } from "../model/behavior";

/** The canvas's longer side on screen, at most; less when the window is
 *  small. */
const PAPER_SIDE = 324;
/** Room kept for the toolbar and the paper's margin. */
const PAPER_CHROME = { x: 120, y: 150 };
/** The preview shares its page with a timeline of rows, so it is drawn this
 *  much larger, as far as the panel allows (the paper may then pass between
 *  the toolbar's ends). */
const PREVIEW_SCALE = 1.5;
/** The least room around the paper: the viewport's padding and the paper's. */
const PAPER_EDGE = { x: 48 + 40, y: 24 + 40 };
/** The sizes last measured, to start from when the view mounts again. */
let lastFit = { side: PAPER_SIDE, room: PAPER_SIDE };
/** How far the preview can be zoomed from its fitted size, and by how much
 *  a click changes it. */
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.25;

/**
 * The selected frame on the pet's canvas, over a checkerboard; the dashed
 * outline is the canvas edge. Play loops the whole reaction.
 */
export function CanvasView() {
  const t = useT();
  const project = useEditor((s) => s.project);
  const state = useEditor((s) => s.selectedState);
  const index = useEditor((s) => s.selectedIndex);
  const trackId = useEditor((s) => s.selectedTrackId);
  const variantId = useEditor((s) => s.selectedVariantId);
  const [playing, setPlaying] = useState(false);
  const section = useRef<HTMLElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(lastFit);
  const [zoom, setZoomState] = useState(1);
  const setZoom = (next: number) =>
    setZoomState(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(next / ZOOM_STEP) * ZOOM_STEP)));
  // Each reaction opens at the fitted size.
  useLayoutEffect(() => setZoomState(1), [state]);

  // Measured before the first paint, so switching reactions (which mounts
  // this anew) never shows the paper at a stale size first.
  useLayoutEffect(() => {
    const el = section.current;
    if (!el) return;
    const measure = () => {
      lastFit = {
        side: Math.max(120, Math.min(PAPER_SIDE, el.clientWidth - PAPER_CHROME.x, el.clientHeight - PAPER_CHROME.y)),
        room: Math.min(el.clientWidth - PAPER_EDGE.x, el.clientHeight - PAPER_EDGE.y),
      };
      setFit(lastFit);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // A zoomed preview opens on its middle, where the pet usually is.
  useLayoutEffect(() => {
    const el = viewport.current;
    if (!el) return;
    el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
    el.scrollTop = (el.scrollHeight - el.clientHeight) / 2;
  }, [zoom]);

  const own = project.states[state];
  const variant = own.variants?.find((v) => v.id === variantId);
  // The tab shown, as it plays (see `variantRows`).
  const spec = useMemo(() => (variant ? { ...own, frames: [], tracks: variantRows(own, variant) } : own), [own, variant]);
  // The lines the tab would say on the desktop (none for idle's and sleep's
  // usual animation).
  const lines = PetSpeech.pool(state, own, variant);
  // One of the tab's lines, picked again when the tab or its lines change.
  const lineKey = `${state}|${variantId}|${lines.join("\n")}`;
  const line = useMemo(() => lines[Math.floor(Math.random() * lines.length)], [lineKey]);
  // Memoised: a fresh object each render would read as a new state and keep
  // restarting the animation from its first frame.
  // The editor's play button loops every reaction, play-once ones too, so
  // they can be watched over and over.
  const playSpec = useMemo(() => (playing ? { ...spec, loop: true } : null), [playing, spec]);
  const playCell = useTimelinePlayer(playSpec, { playing });

  const { canvas } = project;
  const side = Math.max(fit.side, Math.min(fit.side * PREVIEW_SCALE, fit.room));
  const ratio = (side * zoom) / Math.max(canvas.width, canvas.height);
  const tracks = timelineTracks(spec);
  const selectedTrack = tracks.find((track) => track.id === trackId) ?? baseTrack(tracks);
  const selectedCell = playing ? playCell : index === null || !selectedTrack ? 0 : entryStartCell(selectedTrack, project.fps, index);

  return (
    <section className="canvas soft-card" ref={section}>
      <div className="canvas-toolbar">
        <span className="panel-kicker">{t.motionPreview}</span>
        <button
          className={`round-tool${playing ? " on" : ""}`}
          aria-label={playing ? t.pause : t.play}
          onClick={() => setPlaying(!playing)}
          disabled={!tracks.some((track) => track.frames.length)}
        >
          {playing ? <PauseIcon /> : <PlayIcon />}
        </button>
      </div>
      <div className="frame-zoom canvas-zoom">
        <button aria-label={t.zoomOut} onClick={() => setZoom(zoom - ZOOM_STEP)} disabled={zoom <= MIN_ZOOM}>−</button>
        <b>{Math.round(zoom * 100)}%</b>
        <button aria-label={t.zoomIn} onClick={() => setZoom(zoom + ZOOM_STEP)} disabled={zoom >= MAX_ZOOM}>+</button>
        <button className="zoom-reset" onClick={() => setZoom(1)} disabled={zoom === 1}>{t.resetZoom}</button>
      </div>
      <div className="canvas-viewport" ref={viewport}>
        <div className="canvas-paper">
          <div className="pet-box checker" style={{ width: canvas.width * ratio, height: canvas.height * ratio }}>
            {tracks.map((track, trackIndex) => (
              <FrameStack
                key={`${trackIndex}-${track.id}`}
                frames={project.frames}
                entries={track.frames}
                shown={entryAtCell(track, project.fps, selectedCell)?.index ?? -1}
                canvas={canvas}
                ratio={ratio}
                style={{ zIndex: tracks.length - trackIndex }}
              />
            ))}
          </div>
          {line && (
            <div className="line-bubble">
              <b>{line}</b>
              <small>{t.linePreview}</small>
            </div>
          )}
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

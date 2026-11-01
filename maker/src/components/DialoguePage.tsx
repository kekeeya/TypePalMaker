import { useEffect, useRef, useState, type CSSProperties } from "react";
import { useT } from "../i18n/useT";
import { idleCover, IDLE_COVER_ID } from "../model/icon";
import { entryAtCell } from "../model/timeline";
import {
  DEFAULT_SPEECH,
  displayHeight,
  SPEECH_LIMITS,
  timelineTracks,
  type FrameAsset,
  type FrameEntry,
  type Project,
} from "../model/types";
import { useEditor } from "../store";
import { ColorField } from "./ColorField";
import { MovePad } from "./PlacementControls";
import { backdropFor, SpeechBubble, useArtworkTop } from "./SpeechBubble";

/** The pet's longer side on the page, in pixels. */
const PET_SIDE = 340;
/** Colours offered for the bubble: its own warm white first. */
const BUBBLE_SWATCHES = ["#fffdf7", "#ffffff", "#fdf0c4", "#e3f1fc", "#dff2ea", "#fde4ea", "#efedff", "#353754"];
/** Colours offered for the text: dark ones first, then light ones for a
 *  dark bubble. */
const TEXT_SWATCHES = ["#353754", "#1f2430", "#6b4f3a", "#7471d6", "#c0466a", "#2f7d5b", "#ffffff", "#fff3c4"];

/**
 * How the pet's lines look, for every line it says: over idle as it first
 * shows (as the icon draws it), a line typed here only to try it, the
 * bubble dragged or nudged into place, its colours and sizes. The lines
 * themselves are set in each animation.
 */
export function DialoguePage() {
  const t = useT();
  const project = useEditor((s) => s.project);
  const setSpeech = useEditor((s) => s.setSpeech);
  const speech = project.speech ?? DEFAULT_SPEECH;
  // The pet's own first line, or an example in the interface's language
  // until something is typed.
  const [typed, setSample] = useState<string | null>(null);
  const sample = typed ?? firstLine(project) ?? t.sampleLineDefault;
  const [wheel, setWheel] = useState<"bubble" | "text" | null>(null);
  const cover = useIdleCover(project);
  const entries = timelineTracks(project.states.idle)
    .map((track) => entryAtCell(track, project.fps, 0)?.entry)
    .filter((entry): entry is FrameEntry => !!entry);
  const top = useArtworkTop(project.frames, entries, project.canvas);

  const { canvas } = project;
  const k = PET_SIDE / Math.max(canvas.width, canvas.height);
  const box = { width: canvas.width * k, height: canvas.height * k };
  // Pixels per point of the pet on the desktop, so the bubble keeps its size
  // against it.
  const pt = box.height / displayHeight(canvas);
  // Room above the pet for the bubble, and around it to drag it.
  const stage = { width: box.width + 320, height: box.height + 170 };
  const petBox = { left: (stage.width - box.width) / 2, top: stage.height - box.height - 30, ...box };

  // A drag moves from where the bubble was when it started.
  const dragFrom = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setWheel(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const slider = (label: string, value: number, shown: string, min: number, max: number, step: number, onChange: (v: number) => void) => (
    <div className="transform-group">
      <label>
        <span>{label}</span>
        <b>{shown}</b>
      </label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        style={{ "--fill": `${((value - min) / (max - min)) * 100}%` } as CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );

  return (
    <main className="animation-page dialogue-page">
      <section className="canvas dialogue-stage soft-card">
        <div className="canvas-toolbar">
          <span className="panel-kicker">{t.dialoguePreview}</span>
          <small className="toolbar-note">{t.sampleLineHint}</small>
        </div>
        <div className="canvas-viewport">
          <div className="canvas-paper dialogue-paper" style={{ width: stage.width, height: stage.height, background: backdropFor(speech.bubbleColor) }}>
            <div className="pet-box" style={{ position: "absolute", left: petBox.left, top: petBox.top, width: box.width, height: box.height }}>
              {cover && <img src={cover.url} alt="" draggable={false} style={{ width: "100%", height: "100%" }} />}
            </div>
            {sample.trim() && (
              <SpeechBubble
                line={sample.trim()}
                style={speech}
                box={petBox}
                top={top}
                canvas={canvas}
                pt={pt}
                minTop={8}
                onMove={(dx, dy, done) => {
                  dragFrom.current ??= { x: speech.offsetX, y: speech.offsetY };
                  const from = dragFrom.current;
                  setSpeech({ offsetX: Math.round(from.x + dx), offsetY: Math.round(from.y + dy) }, "drag");
                  if (done) dragFrom.current = null;
                }}
              />
            )}
          </div>
        </div>
        <div className="sample-line">
          <label>
            <span>{t.sampleLine}</span>
            <input type="text" value={sample} maxLength={30} onChange={(e) => setSample(e.target.value)} />
          </label>
        </div>
      </section>
      <aside className="panel inspector soft-card">
        <div className="inspector-title">
          <span>{t.bubble}</span>
        </div>
        <MovePad
          label={t.bubblePosition}
          onMove={(x, y) => setSpeech({ offsetX: speech.offsetX + x, offsetY: speech.offsetY + y }, "move")}
          onCenter={() => setSpeech({ offsetX: 0, offsetY: 0 })}
        />
        <small className="panel-note">{t.bubbleDragHint}</small>
        {slider(t.textSize, speech.fontSize, `${speech.fontSize} pt`, SPEECH_LIMITS.fontSize.min, SPEECH_LIMITS.fontSize.max, 1, (fontSize) =>
          setSpeech({ fontSize }, "font"),
        )}
        {slider(
          t.bubbleSize,
          Math.round(speech.bubbleSize * 100),
          `${Math.round(speech.bubbleSize * 100)}%`,
          SPEECH_LIMITS.bubbleSize.min * 100,
          SPEECH_LIMITS.bubbleSize.max * 100,
          5,
          (v) => setSpeech({ bubbleSize: v / 100 }, "size"),
        )}
        <ColorField
          label={t.bubbleColor}
          value={speech.bubbleColor}
          swatches={BUBBLE_SWATCHES}
          open={wheel === "bubble"}
          onOpenChange={(open) => setWheel(open ? "bubble" : null)}
          onChange={(bubbleColor) => setSpeech({ bubbleColor }, "bubble-color")}
        />
        <ColorField
          label={t.textColor}
          value={speech.textColor}
          swatches={TEXT_SWATCHES}
          open={wheel === "text"}
          onOpenChange={(open) => setWheel(open ? "text" : null)}
          onChange={(textColor) => setSpeech({ textColor }, "text-color")}
        />
        <button className="reset-transform" onClick={() => setSpeech(DEFAULT_SPEECH)}>
          <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
            <path d="M3 4.2A3.8 3.8 0 1 1 2.4 7.6M3 1.6v2.6h2.6" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {t.reset}
        </button>
      </aside>
    </main>
  );
}

/** A line the pet already has, to try first. */
function firstLine(project: Project): string | undefined {
  for (const spec of Object.values(project.states)) {
    const line = spec.lines?.[0] ?? spec.variants?.flatMap((v) => v.lines)[0];
    if (line) return line;
  }
  return undefined;
}

/** Idle as the pet first shows it (see `idleCover`), drawn again when idle
 *  changes; a drawn picture is let go when replaced. */
function useIdleCover(project: Project): FrameAsset | undefined {
  const [cover, setCover] = useState<FrameAsset>();
  const { frames, canvas, fps } = project;
  const idle = project.states.idle;
  useEffect(() => {
    let alive = true;
    void idleCover(project).then((found) => {
      if (alive) setCover(found);
      else if (found?.id === IDLE_COVER_ID) URL.revokeObjectURL(found.url);
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frames, canvas, fps, idle]);
  useEffect(
    () => () => {
      if (cover?.id === IDLE_COVER_ID) URL.revokeObjectURL(cover.url);
    },
    [cover],
  );
  return cover;
}

import { closestCenter, DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { horizontalListSortingStrategy, SortableContext, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useRef, useState, type CSSProperties, type DragEvent, type PointerEvent as ReactPointerEvent } from "react";
import { useT } from "../i18n/useT";
import { importNotice } from "../i18n/strings";
import { IMAGE_ACCEPT, importFiles, importSideFor, type ImportResult } from "../model/imageImport";
import { frameSpan, type FrameAsset } from "../model/types";
import { useEditor } from "../store";
import { pickImages } from "./pickImages";

const MIN_CELL = 48;
const MAX_CELL = 104;
const DEFAULT_CELL = 72;
/** Space before the first cell; matches `.timeline-canvas` padding. */
const TRACK_INSET = 14;

const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer.types).includes("Files");

/**
 * The selected reaction's frames, one cell per 1 / fps. A picture's clip is
 * as wide as the frames it holds: drag its right handle (or click a ruler
 * cell) to lengthen it, drag the clip to reorder, × to delete, ＋ or drop
 * files to add, drop a file on a clip to replace its picture.
 */
export function Timeline() {
  const t = useT();
  const project = useEditor((s) => s.project);
  const state = useEditor((s) => s.selectedState);
  const selected = useEditor((s) => s.selectedIndex);
  const { selectFrame, moveFrame, removeFrame, setSpan, addFrames, replaceFrame } = useEditor.getState();
  const input = useRef<HTMLInputElement>(null);
  const [cell, setCell] = useState(DEFAULT_CELL);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const { fps } = project;
  const frames = project.states[state].frames;
  const spans = frames.map((f) => frameSpan(f, fps));
  const ids = frames.map((_, i) => `clip-${i}`);
  const total = spans.reduce((a, b) => a + b, 0);
  const selectedStart = selected === null ? 0 : spans.slice(0, selected).reduce((a, b) => a + b, 0);
  // One second to start with, then as many as the clips and ＋ need.
  const cells = Math.max(fps, total + 1);

  /** Uploads, kept at twice the canvas at most; skipped files are named. */
  const upload = async (files: File[]): Promise<ImportResult> => {
    const result = await importFiles(files, importSideFor(project.canvas));
    const notice = importNotice(t, result);
    if (notice) useEditor.getState().setNotice(notice);
    return result;
  };
  const add = async (files: File[]) => addFrames(state, (await upload(files)).frames);
  const replace = async (index: number, files: File[]) => {
    const [first] = (await upload(files.slice(0, 1))).frames;
    if (first) replaceFrame(state, index, first.asset);
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    moveFrame(state, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
  };

  const extendTo = (cellIndex: number) => {
    if (selected === null || cellIndex < selectedStart) return;
    setSpan(state, selected, cellIndex - selectedStart + 1);
  };

  const beginResize = (event: ReactPointerEvent, index: number) => {
    event.preventDefault();
    event.stopPropagation();
    selectFrame(index);
    const startX = event.clientX;
    const startSpan = spans[index];
    const onMove = (e: PointerEvent) => setSpan(state, index, Math.max(1, startSpan + Math.round((e.clientX - startX) / cell)));
    const finish = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finish);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", finish);
  };

  return (
    <section
      className="timeline soft-card"
      style={{ "--frame-cell": `${cell}px` } as CSSProperties}
      onDragOver={(e) => hasFiles(e) && e.preventDefault()}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        void add(Array.from(e.dataTransfer.files));
      }}
    >
      <div className="timeline-head">
        <div className="timeline-name">
          <b>{t.timeline}</b>
          <small>{t.stateNames[state]}</small>
          <span>{fps} fps</span>
          <em>{t.oneSecond(fps)}</em>
        </div>
        <div className="frame-zoom">
          <small>{t.frameWidth}</small>
          <button aria-label={t.narrower} onClick={() => setCell((c) => Math.max(MIN_CELL, c - 8))}>−</button>
          <input
            type="range"
            min={MIN_CELL}
            max={MAX_CELL}
            step={4}
            value={cell}
            aria-label={t.frameWidth}
            style={{ "--fill": `${((cell - MIN_CELL) / (MAX_CELL - MIN_CELL)) * 100}%` } as CSSProperties}
            onChange={(e) => setCell(Number(e.target.value))}
          />
          <button aria-label={t.wider} onClick={() => setCell((c) => Math.min(MAX_CELL, c + 8))}>+</button>
        </div>
      </div>
      <div className="timeline-scroll">
        <div className="timeline-canvas" style={{ width: cells * cell + TRACK_INSET }}>
          <div className="frame-ruler">
            {total > 0 && <span className="ruler-range" style={{ width: total * cell }} />}
            {Array.from({ length: cells }, (_, i) => (
              <button
                key={i}
                className={i < total ? "active" : undefined}
                tabIndex={-1}
                onClick={() => extendTo(i)}
              >
                <span>{i + 1}</span>
                {(i + 1) % fps === 0 && <b>{(i + 1) / fps}s</b>}
              </button>
            ))}
          </div>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={ids} strategy={horizontalListSortingStrategy}>
              <div className="frame-track">
                {frames.map((entry, i) => (
                  <FrameClip
                    key={ids[i]}
                    id={ids[i]}
                    index={i}
                    asset={project.frames[entry.id]}
                    span={spans[i]}
                    selected={selected === i}
                    labels={{ frames: t.frames(spans[i]), remove: t.deleteFrame, extend: t.extendFrame }}
                    onSelect={() => selectFrame(i)}
                    onResize={(e) => beginResize(e, i)}
                    onRemove={() => removeFrame(state, i)}
                    onReplace={(files) => void replace(i, files)}
                  />
                ))}
                <button
                  className="append-frame"
                  aria-label={t.addFrames}
                  onClick={async () => {
                    const files = await pickImages({ multiple: true, label: t.imageFiles, fallback: () => input.current?.click() });
                    if (files?.length) void add(files);
                  }}
                >
                  <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true">
                    <path d="M8 2.5v11M2.5 8h11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            </SortableContext>
          </DndContext>
        </div>
      </div>
      <input
        ref={input}
        type="file"
        multiple
        accept={IMAGE_ACCEPT}
        hidden
        onChange={(e) => {
          void add(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
    </section>
  );
}

function FrameClip({
  id,
  index,
  asset,
  span,
  selected,
  labels,
  onSelect,
  onResize,
  onRemove,
  onReplace,
}: {
  id: string;
  index: number;
  asset?: FrameAsset;
  span: number;
  selected: boolean;
  labels: { frames: string; remove: string; extend: string };
  onSelect: () => void;
  onResize: (event: ReactPointerEvent) => void;
  onRemove: () => void;
  onReplace: (files: File[]) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const [dropping, setDropping] = useState(false);
  return (
    <div
      ref={setNodeRef}
      className={`frame-clip${selected ? " selected" : ""}${isDragging ? " dragging" : ""}${dropping ? " replacing" : ""}`}
      style={{ "--span": span, transform: CSS.Translate.toString(transform), transition } as CSSProperties}
      onClick={onSelect}
      onDragOver={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        setDropping(true);
      }}
      onDragLeave={() => setDropping(false)}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        setDropping(false);
        onReplace(Array.from(e.dataTransfer.files));
      }}
      {...attributes}
      {...listeners}
    >
      <span className="clip-cells" />
      <span className="clip-thumb checker">{asset && <img src={asset.url} alt="" draggable={false} />}</span>
      <span className="clip-number">{index + 1}</span>
      <b className="clip-count">{labels.frames}</b>
      {selected && (
        <>
          <button
            className="clip-delete"
            aria-label={labels.remove}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
          >
            <svg viewBox="0 0 10 10" width="9" height="9" aria-hidden="true">
              <path d="M2 2l6 6M8 2 2 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
          <span className="clip-resize" role="separator" aria-label={labels.extend} onPointerDown={onResize}>
            <svg viewBox="0 0 12 8" width="11" height="8" aria-hidden="true">
              <path d="M1 4h10M3.5 1.5 1 4l2.5 2.5M8.5 1.5 11 4 8.5 6.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
        </>
      )}
    </div>
  );
}

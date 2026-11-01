import {
  closestCenter,
  DndContext,
  PointerSensor,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  DragOverlay,
  type ClientRect,
  type CollisionDetection,
  type DragEndEvent,
  type DragMoveEvent,
  type Over,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy, type SortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useEffect, useRef, useState, type CSSProperties, type DragEvent, type HTMLAttributes, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useT } from "../i18n/useT";
import { importNotice } from "../i18n/strings";
import { IMAGE_ACCEPT, importFiles, importSideFor, type ImportResult } from "../model/imageImport";
import { dropEntry, entryStartCell, trackCells, withoutEntry } from "../model/timeline";
import { builtInEffectFrames, effectOfRow, effectRowId, type BuiltInEffect } from "../model/template";
import { baseTrack, delaySpan, frameSpan, type FrameAsset, type FrameTrack } from "../model/types";
import { rowsIn, useEditor } from "../store";
import { pickImages } from "./pickImages";
import { EffectDialog } from "./EffectDialog";
import { VariantPanel } from "./VariantPanel";

const MIN_CELL = 48;
const MAX_CELL = 104;
const DEFAULT_CELL = 72;
/** Space before the first cell; matches `.timeline-canvas` padding. */
const TRACK_INSET = 14;
/** The names column. */
const LABEL_WIDTH = 124;
/** Track names show this many characters, then an ellipsis. A Latin letter
 *  or digit counts as half of one, so "Pet Base" fits as well as "团子底图". */
const NAME_CHARS = 5;

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
  const selectedTrackId = useEditor((s) => s.selectedTrackId);
  const selectedVariantId = useEditor((s) => s.selectedVariantId);
  const { selectFrame, selectTrack, moveFrameTo, removeFrame, setSpan, addFrames, replaceFrame, addTrack, removeTrack, renameTrack, moveTrack } = useEditor.getState();
  const input = useRef<HTMLInputElement>(null);
  const uploadTrack = useRef<string | null>(null);
  const [cell, setCell] = useState(DEFAULT_CELL);
  const [effectsOpen, setEffectsOpen] = useState(false);
  /** The track whose name is being typed, if one is. */
  const [renaming, setRenaming] = useState<string | null>(null);
  const [addingEffect, setAddingEffect] = useState(false);
  /** The frame being dragged, and where it would land. */
  const [dragged, setDragged] = useState<{ trackId: string; index: number } | null>(null);
  const [hint, setHint] = useState<DropHint | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const { fps } = project;
  const spec = project.states[state];
  // The rows of the tab shown: the usual animation, or a random action.
  const tracks = rowsIn(spec, selectedVariantId) ?? [];
  const variant = spec.variants?.find((v) => v.id === selectedVariantId);
  /** A random action with no pictures, not even a row of its own added. */
  const emptyVariant = !!variant && tracks.length <= 1 && tracks.every((track) => !track.frames.length);
  /** The empty action whose own row was asked for: its timeline shows. */
  const [openedVariant, setOpenedVariant] = useState<string | null>(null);
  const selectedTrack = tracks.find((track) => track.id === selectedTrackId) ?? baseTrack(tracks);
  const total = Math.max(0, ...tracks.map((track) => trackCells(track, fps)));
  const selectedStart = selected === null || !selectedTrack ? 0 : entryStartCell(selectedTrack, fps, selected);
  // One second to start with, then as many as the clips and ＋ need.
  const cells = Math.max(fps, total + 1);
  const rowIds = tracks.map((track) => `row-${track.id}`);

  /** A row's name: what the user called it, or else its kind (the sleep
   *  template's rows) or its place, in the interface language. */
  /** A row's own name, or one from what it holds: the effect it was added
   *  as, or the pet itself. An empty row is a new one ("新建轴", "新建轴 2"…,
   *  counting the empty ones above it). */
  const defaultLabel = (track: FrameTrack) => {
    if (!track.frames.length) return null;
    const effect = effectOfRow(track.id);
    if (effect) return effect === "zzz" ? t.zzzTrack : t.effectNames[effect];
    return track.id === "sleep-base" || track.id === "main" ? t.baseTrack : null;
  };
  const trackLabel = (track: FrameTrack, index: number) => {
    if (track.name) return track.name;
    const label = defaultLabel(track);
    if (label) return label;
    const before = tracks.slice(0, index).filter((row) => !row.name && !defaultLabel(row)).length;
    return t.newTrackName(before + 1);
  };
  const shortName = (name: string) => {
    let width = 0;
    let shown = "";
    for (const char of name) {
      width += char.charCodeAt(0) < 0x2e80 ? 0.5 : 1;
      if (width > NAME_CHARS) return `${shown.trimEnd()}…`;
      shown += char;
    }
    return name;
  };

  /** A row of the effect over the others, named after it in whatever
   *  language the interface is in. */
  const addEffect = async (effect: BuiltInEffect) => {
    if (addingEffect) return;
    setAddingEffect(true);
    try {
      const frames = await builtInEffectFrames(effect);
      const id = effectRowId(effect);
      const taken = tracks.some((track) => track.id === id);
      // One step: undo takes the whole effect away.
      useEditor.getState().batch(() => {
        addTrack(state, "", taken ? `${id}-${Date.now().toString(36)}` : id, true);
        const trackId = useEditor.getState().selectedTrackId;
        if (trackId) addFrames(state, frames, trackId);
      });
      setEffectsOpen(false);
    } catch {
      useEditor.getState().setNotice({ title: t.builtInEffectFailed });
    } finally {
      setAddingEffect(false);
    }
  };

  /** Uploads, kept at twice the canvas at most; skipped files are named. */
  const upload = async (files: File[]): Promise<ImportResult> => {
    const result = await importFiles(files, importSideFor(project.canvas));
    const notice = importNotice(t, result);
    if (notice) useEditor.getState().setNotice(notice);
    return result;
  };
  const add = async (files: File[], trackId: string | null) => addFrames(state, (await upload(files)).frames, trackId);
  const replace = async (trackId: string | null, index: number, files: File[]) => {
    const [first] = (await upload(files.slice(0, 1))).frames;
    if (first) replaceFrame(state, index, first.asset, trackId);
  };

  const extendTo = (cellIndex: number) => {
    if (selected === null || !selectedTrack || cellIndex < selectedStart) return;
    setSpan(state, selected, cellIndex - selectedStart + 1, selectedTrack.id);
  };

  const beginResize = (event: ReactPointerEvent, track: FrameTrack, index: number) => {
    event.preventDefault();
    event.stopPropagation();
    selectFrame(index);
    const startX = event.clientX;
    const startSpan = frameSpan(track.frames[index], fps);
    const onMove = (e: PointerEvent) => setSpan(state, index, Math.max(1, startSpan + Math.round((e.clientX - startX) / cell)), track.id);
    const finish = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", finish);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", finish);
  };

  /** A row is dragged by its name onto another row's place; a frame onto
   *  the row under the pointer. */
  const collision: CollisionDetection = (args) => {
    const clip = clipOf(String(args.active.id)) !== null;
    const prefix = clip ? ZONE : "row-";
    const droppableContainers = args.droppableContainers.filter((c) => String(c.id).startsWith(prefix));
    return clip ? pointerWithin({ ...args, droppableContainers }) : closestCenter({ ...args, droppableContainers });
  };

  /** A row moves among the rows. A frame lands on the row it is dropped on,
   *  at the cell its left edge is nearest: anywhere the timeline reaches on
   *  an effect's row, between frames on the pet's own (see `dropEntry`). */
  // ⌘C / ⌘V (Ctrl on Windows): the selected frame, pasted after the
  // selected one. Text being edited or selected keeps the usual copy.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key !== "c" && key !== "v") return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true']") || window.getSelection()?.toString()) return;
      // Not behind a dialog, the preview or anything else over the page.
      if (document.querySelector(".overlay")) return;
      const editor = useEditor.getState();
      if (key === "c" && editor.selectedIndex !== null) {
        e.preventDefault();
        editor.copyFrame(state);
      } else if (key === "v" && editor.copiedFrame) {
        e.preventDefault();
        editor.pasteFrame(state);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state]);

  const draggedEntry = dragged && tracks.find((track) => track.id === dragged.trackId)?.frames[dragged.index];

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setDragged(null);
    setHint(null);
    if (!over) return;
    if (!clipOf(String(active.id))) {
      if (active.id !== over.id) moveTrack(state, rowIds.indexOf(String(active.id)), rowIds.indexOf(String(over.id)));
      return;
    }
    const landing = landingOf(String(active.id), over, active.rect.current.translated);
    if (!landing) return;
    const { clip, target, start } = landing;
    const source = tracks.find((track) => track.id === clip.trackId)!;
    if (target === source && start === entryStartCell(source, fps, clip.index)) return;
    moveFrameTo(state, clip.trackId, clip.index, target.id, start);
  };

  /** Where a dragged frame would land: its row, the cell its left edge is
   *  nearest, and where to show it — a box where it would go on an
   *  effect's row, a line between frames on the pet's own. Null where it
   *  cannot go. */
  const landingOf = (activeId: string, over: Over | null, edge: ClientRect | null) => {
    const clip = clipOf(activeId);
    const target = over && tracks.find((track) => `${ZONE}${track.id}` === over.id);
    const source = clip && tracks.find((track) => track.id === clip.trackId);
    const entry = clip && source?.frames[clip.index];
    if (!clip || !over || !edge || !target || !source || !entry) return null;
    const span = frameSpan(entry, fps);
    const free = target !== baseTrack(tracks);
    let start = Math.max(0, Math.round((edge.left - over.rect.left) / cell));
    if (free) start = Math.min(start, Math.max(0, total - span));
    const rest = target === source ? withoutEntry(source.frames, clip.index, source !== baseTrack(tracks), fps) : target.frames;
    const dropped = dropEntry(rest, entry, start, free, target !== source, fps);
    if (!dropped) return null;
    let shown: number;
    if (free) shown = entryStartCell({ ...target, frames: dropped.frames }, fps, dropped.index);
    else {
      // The gap between frames as the row looks now, the frame still in it.
      const at = dropEntry(target.frames, entry, start, false, true, fps)!.index;
      shown = at < target.frames.length ? entryStartCell(target, fps, at) : trackCells(target, fps);
    }
    return { clip, target, start, hint: { trackId: target.id, cell: shown, span, line: !free } };
  };

  const onDragMove = ({ active, over }: DragMoveEvent) => {
    const next = landingOf(String(active.id), over, active.rect.current.translated)?.hint ?? null;
    setHint((now) => (now?.trackId === next?.trackId && now?.cell === next?.cell && now?.line === next?.line ? now : next));
  };

  return (
    <section
      className="timeline soft-card"
      style={{ "--frame-cell": `${cell}px` } as CSSProperties}
      onDragOver={(e) => hasFiles(e) && e.preventDefault()}
      onDrop={(e) => {
        if (!hasFiles(e) || !selectedTrack) return;
        e.preventDefault();
        void add(Array.from(e.dataTransfer.files), selectedTrack.id);
      }}
    >
      <div className="timeline-head">
        <div className="timeline-name">
          <b>{t.timeline}</b>
          <small>{t.stateNames[state]}</small>
          <span>{fps} fps</span>
          <em>{t.oneSecond(fps)}</em>
        </div>
        <div className="timeline-tools">
          <button className="built-in-effect-button" onClick={() => setEffectsOpen(true)}>
            ✦ {t.addBuiltInEffect}
          </button>
          <button className="add-track-button" onClick={() => addTrack(state)}>＋ {t.addTrack}</button>
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
      </div>
      <VariantPanel state={state} />
      {emptyVariant && (openedVariant !== variant.id || !tracks.length) ? (
        <div className="variant-empty">
          <b>{t.emptyVariantTitle}</b>
          <p>{t.emptyVariantBody}</p>
          <div>
            {/* The action has its row already, empty: it is shown, not a second added. */}
            <button
              className="primary-small"
              onClick={() => {
                setOpenedVariant(variant.id);
                if (tracks[0]) selectTrack(tracks[0].id);
                else addTrack(state);
              }}
            >
              ＋ {t.addTrack}
            </button>
            <button className="built-in-effect-button" onClick={() => setEffectsOpen(true)}>
              ✦ {t.addBuiltInEffect}
            </button>
          </div>
        </div>
      ) : (
        <div className="timeline-scroll">
          <div className="timeline-canvas" style={{ width: cells * cell + TRACK_INSET + LABEL_WIDTH }}>
            <div className="frame-ruler">
              {/* Over the names column, so the ruler's cells line up with the rows'. */}
              <span className="ruler-label-head" aria-hidden="true" />
              {total > 0 && <span className="ruler-range" style={{ left: LABEL_WIDTH, width: total * cell }} />}
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
            <DndContext
              sensors={sensors}
              collisionDetection={collision}
              onDragStart={({ active }) => setDragged(clipOf(String(active.id)))}
              onDragMove={onDragMove}
              onDragEnd={onDragEnd}
              onDragCancel={() => {
                setDragged(null);
                setHint(null);
              }}
            >
              <SortableContext items={rowIds} strategy={verticalListSortingStrategy}>
                {tracks.map((track, trackIndex) => {
                  const spans = track.frames.map((entry) => frameSpan(entry, fps));
                  const ids = track.frames.map((_, index) => clipId(track.id, index));
                  return (
                    <SortableRow key={track.id} id={rowIds[trackIndex]} disabled={renaming === track.id || tracks.length < 2}>
                      {(handle) => (
                        <>
                          <div className={`track-label${selectedTrack?.id === track.id ? " selected" : ""}`} {...handle}>
                            {renaming === track.id ? (
                              <input
                                className="track-name-input"
                                autoFocus
                                maxLength={20}
                                defaultValue={trackLabel(track, trackIndex)}
                                aria-label={t.trackName}
                                onFocus={(e) => e.target.select()}
                                onBlur={(e) => {
                                  renameTrack(state, track.id, e.target.value.trim());
                                  setRenaming(null);
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                                  if (e.key === "Escape") setRenaming(null);
                                }}
                              />
                            ) : (
                              <button
                                className="track-select"
                                title={`${trackLabel(track, trackIndex)} · ${t.renameHint}`}
                                onClick={() => selectTrack(track.id)}
                                onDoubleClick={() => setRenaming(track.id)}
                              >
                                <b>{shortName(trackLabel(track, trackIndex))}</b>
                                <span aria-hidden="true">●</span>
                              </button>
                            )}
                            <button
                              className="delete-track"
                              aria-label={t.deleteTrackNamed(trackLabel(track, trackIndex))}
                              title={t.deleteTrack}
                              onClick={() => removeTrack(state, track.id)}
                            >
                              <svg viewBox="0 0 16 16" aria-hidden="true">
                                <path d="M5.25 5.75v6m2.75-6v6m2.75-6v6M3.5 3.5h9M6 3.5V2.25h4V3.5m1.5 0-.45 10H4.95l-.45-10" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            </button>
                          </div>
                          <SortableContext items={ids} strategy={stayPut}>
                            <RowDropZone
                              trackId={track.id}
                              hint={hint?.trackId === track.id ? hint : null}
                              onFiles={(files) => {
                                selectTrack(track.id);
                                void add(files, track.id);
                              }}
                            >
                                {track.frames.map((entry, i) => (
                                  <FrameClip
                                    key={ids[i]}
                                    id={ids[i]}
                                    index={i}
                                    asset={project.frames[entry.id]}
                                    span={spans[i]}
                                    gap={delaySpan(entry, fps)}
                                    selected={selectedTrack?.id === track.id && selected === i}
                                    labels={{ frames: t.frames(spans[i]), remove: t.deleteFrame, extend: t.extendFrame }}
                                    onSelect={() => { selectTrack(track.id); selectFrame(i); }}
                                    onResize={(e) => beginResize(e, track, i)}
                                    onRemove={() => removeFrame(state, i, track.id)}
                                    onReplace={(files) => void replace(track.id, i, files)}
                                  />
                                ))}
                                <button
                                  className="append-frame"
                                  aria-label={`${trackLabel(track, trackIndex)} ${t.addFrames}`}
                                  onClick={async () => {
                                    selectTrack(track.id);
                                    uploadTrack.current = track.id;
                                    const files = await pickImages({ multiple: true, label: t.imageFiles, fallback: () => input.current?.click() });
                                    if (files?.length) void add(files, track.id);
                                  }}
                                >
                                  <svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true"><path d="M8 2.5v11M2.5 8h11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
                                </button>
                                {variant && !track.frames.length && track === baseTrack(tracks) && <span className="row-hint">{t.usesRegular}</span>}
                            </RowDropZone>
                          </SortableContext>
                        </>
                      )}
                    </SortableRow>
                  );
                })}
              </SortableContext>
              {/* The frame follows the pointer above every row; its own place
                  stays, faded, until it lands. */}
              <DragOverlay dropAnimation={null}>
                {draggedEntry && (
                  <div className="frame-clip ghost" style={{ "--span": frameSpan(draggedEntry, fps) } as CSSProperties}>
                    <span className="clip-cells" />
                    <span className="clip-thumb checker">
                      {project.frames[draggedEntry.id] && <img src={project.frames[draggedEntry.id].url} alt="" draggable={false} />}
                    </span>
                  </div>
                )}
              </DragOverlay>
            </DndContext>
          </div>
        </div>
      )}
      {effectsOpen && <EffectDialog busy={addingEffect} onCancel={() => setEffectsOpen(false)} onPick={(e) => void addEffect(e)} />}
      <input
        ref={input}
        type="file"
        multiple
        accept={IMAGE_ACCEPT}
        hidden
        onChange={(e) => {
          void add(Array.from(e.target.files ?? []), uploadTrack.current ?? selectedTrack?.id ?? null);
          e.target.value = "";
        }}
      />
    </section>
  );
}

/** A row that moves up and down by its name: the name is the handle, so
 *  clips keep their own dragging. A click or double-click on the name is
 *  not a drag (see the sensors' distance). */
function SortableRow({
  id,
  disabled,
  children,
}: {
  id: string;
  disabled: boolean;
  children: (handle: HTMLAttributes<HTMLElement>) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id, disabled });
  return (
    <div
      ref={setNodeRef}
      className={`timeline-track-row${isDragging ? " dragging" : ""}`}
      style={{ transform: transform ? `translate3d(0, ${transform.y}px, 0)` : undefined, transition }}
    >
      {/* Not dnd-kit's button role: the name holds buttons of its own. */}
      {children(disabled ? {} : { ...listeners, "aria-roledescription": attributes["aria-roledescription"] })}
    </div>
  );
}

/** A dragged frame may go anywhere, on any row: the others stay where they
 *  are meanwhile. */
const stayPut: SortingStrategy = () => null;

const ZONE = "zone:";
const clipId = (trackId: string, index: number) => `clip:${index}:${trackId}`;
function clipOf(id: string): { trackId: string; index: number } | null {
  const match = /^clip:(\d+):(.*)$/.exec(id);
  return match ? { index: Number(match[1]), trackId: match[2] } : null;
}

/** Where a dragged frame would land on a row: a box `span` cells wide at
 *  `cell`, or a line before `cell` between the pet's own frames. */
interface DropHint {
  trackId: string;
  cell: number;
  span: number;
  line: boolean;
}

/** A row's frames: where a dragged frame or image files dropped on it go. */
function RowDropZone({
  trackId,
  hint,
  onFiles,
  children,
}: {
  trackId: string;
  hint: DropHint | null;
  onFiles: (files: File[]) => void;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `${ZONE}${trackId}` });
  const [filesOver, setFilesOver] = useState(false);
  // Enters and leaves of the row and everything in it, counted: WebKit
  // often leaves `relatedTarget` empty, so it cannot tell a move inside.
  const depth = useRef(0);
  return (
    <div
      ref={setNodeRef}
      className={`frame-track${isOver || filesOver ? " drop-target" : ""}`}
      // Over a frame, files replace it (see `FrameClip`), not join the row;
      // that frame's own handlers stop the event before it gets here.
      onDragOverCapture={(e) => hasFiles(e) && setFilesOver(!(e.target as Element).closest(".frame-clip"))}
      onDropCapture={() => {
        depth.current = 0;
        setFilesOver(false);
      }}
      onDragEnterCapture={(e) => {
        if (hasFiles(e)) depth.current += 1;
      }}
      onDragLeaveCapture={(e) => {
        if (!hasFiles(e)) return;
        depth.current = Math.max(0, depth.current - 1);
        if (!depth.current) setFilesOver(false);
      }}
      onDragOver={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        setFilesOver(true);
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.stopPropagation();
        setFilesOver(false);
        onFiles(Array.from(e.dataTransfer.files));
      }}
    >
      {children}
      {hint && (
        <span
          className={`drop-hint${hint.line ? " line" : ""}`}
          style={{ "--at": hint.cell, "--span": hint.span } as CSSProperties}
          aria-hidden="true"
        />
      )}
    </div>
  );
}

function FrameClip({
  id,
  index,
  asset,
  span,
  gap,
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
  /** Cells of nothing before it. */
  gap: number;
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
      style={{ "--span": span, "--gap": gap, transform: isDragging ? undefined : CSS.Translate.toString(transform), transition } as CSSProperties}
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

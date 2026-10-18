import { create } from "zustand";
import { defaultLang, rememberLang, type Lang } from "./i18n/strings";
import type { ImportedFrame } from "./model/imageImport";
import {
  emptyProject,
  allStateFrames,
  baseTrack,
  newId,
  PET_STATES,
  spanDuration,
  type FrameAsset,
  type FrameEntry,
  type IconStyle,
  type PetState,
  type Project,
  type StateSpec,
} from "./model/types";

type Placement = Pick<FrameEntry, "scale" | "offsetX" | "offsetY" | "rotation">;

/** Steps kept for undo. Projects share everything that did not change, so a
 *  step costs little more than the change itself. */
export const HISTORY_LIMIT = 100;
/** Changes of the same kind this close together — a slider being dragged,
 *  a name being typed — are one step. */
const MERGE_MS = 800;

interface EditorState {
  project: Project;
  selectedState: PetState;
  /** Index into the selected state's frames, or null when nothing is picked. */
  selectedIndex: number | null;
  /** The selected row. Null means the pet's own row. */
  selectedTrackId: string | null;
  previewOpen: boolean;
  /** A message for the user, shown as a dialog by the app. */
  notice: { title: string; body?: string } | null;
  lang: Lang;
  /** Bumped on every change to the project, so autosave knows to save. */
  revision: number;
  past: Project[];
  future: Project[];

  loadProject(project: Project): void;
  undo(): void;
  redo(): void;

  setName(name: string): void;
  /** Sets the icon's picture (undefined: the first idle frame) and style. */
  setIcon(icon: FrameAsset | undefined, style: IconStyle): void;

  selectState(state: PetState): void;
  selectTrack(trackId: string): void;
  selectFrame(index: number | null): void;
  setEnabled(state: PetState, enabled: boolean): void;
  setSleepAfterMinutes(minutes: number): void;
  /** A blank row goes under the others; an effect (`onTop`) over them. `id` names a built-in kind of row. */
  addTrack(state: PetState, name?: string, id?: string, onTop?: boolean): void;
  /** Runs several edits as one undoable step. */
  batch(run: () => void): void;
  removeTrack(state: PetState, trackId: string): void;
  /** Moves a row up or down; the first row is drawn over the others. */
  moveTrack(state: PetState, from: number, to: number): void;
  /** An empty name puts back the row's default one. */
  renameTrack(state: PetState, trackId: string, name: string): void;

  /** Adds uploaded pictures to the end of a state. */
  addFrames(state: PetState, frames: ImportedFrame[], trackId?: string | null): void;
  /** Swaps the picture of one frame, keeping its length and placement. */
  replaceFrame(state: PetState, index: number, asset: FrameAsset, trackId?: string | null): void;
  removeFrame(state: PetState, index: number, trackId?: string | null): void;
  moveFrame(state: PetState, from: number, to: number, trackId?: string | null): void;
  /** How many timeline frames the picture holds. */
  setSpan(state: PetState, index: number, span: number, trackId?: string | null): void;
  setPlacement(state: PetState, index: number, placement: Placement, trackId?: string | null): void;

  setPreviewOpen(open: boolean): void;
  setNotice(notice: { title: string; body?: string } | null): void;
  setLang(lang: Lang): void;
}

/** Drops uploads no frame uses any more, so they are not saved forever. */
function prune(project: Project): Project {
  const used = new Set(PET_STATES.flatMap((s) => allStateFrames(project.states[s]).map((f) => f.id)));
  if (project.frameOrder.every((id) => used.has(id))) return project;
  const frames = { ...project.frames };
  for (const id of project.frameOrder) if (!used.has(id)) delete frames[id];
  return { ...project, frames, frameOrder: project.frameOrder.filter((id) => used.has(id)) };
}

/** Every picture a project shows. */
function assetsOf(project: Project): FrameAsset[] {
  return [...Object.values(project.frames), ...(project.icon ? [project.icon] : [])];
}

/**
 * Blob URLs hold their image in memory until revoked. A picture may leave
 * the project and come back with undo, so it is freed only once neither the
 * project nor any undo or redo step shows it.
 */
const live = new Set<FrameAsset>();
function collect(projects: Project[]) {
  const reachable = new Set(projects.flatMap(assetsOf));
  for (const asset of live) {
    if (reachable.has(asset)) continue;
    if (asset.url) URL.revokeObjectURL(asset.url);
    live.delete(asset);
  }
  for (const asset of reachable) live.add(asset);
}

export const useEditor = create<EditorState>()((set, get) => {
  let lastMerge: { key: string; at: number } | null = null;
  /** Inside `batch`: whether its first edit has been recorded. */
  let batching: { recorded: boolean } | null = null;

  /** Applies a change to the project as one undoable step — or as part of
   *  the previous one, for repeated changes with the same `mergeKey`. */
  const edit = (change: (p: Project) => Project, mergeKey?: string) => {
    const { project, past, revision } = get();
    const next = change(project);
    if (next === project) return;
    const now = Date.now();
    const merge =
      (batching?.recorded || (!!mergeKey && lastMerge?.key === mergeKey && now - lastMerge.at < MERGE_MS)) && past.length > 0;
    if (batching) batching.recorded = true;
    lastMerge = mergeKey ? { key: mergeKey, at: now } : null;
    const nextPast = merge ? past : [...past, project].slice(-HISTORY_LIMIT);
    set({ project: next, past: nextPast, future: [], revision: revision + 1 });
    collect([next, ...nextPast]);
  };

  /** The row an edit lands on: the one asked for, else the pet's own. */
  const rowOf = (spec: StateSpec, trackId: string | null | undefined) =>
    spec.tracks?.find((track) => track.id === trackId) ?? (spec.tracks && baseTrack(spec.tracks));

  const editFrames = (
    state: PetState,
    trackId: string | null | undefined,
    change: (frames: FrameEntry[], project: Project) => FrameEntry[],
    mergeKey?: string,
  ) =>
    edit(
      (p) => {
        const spec = p.states[state];
        const row = rowOf(spec, trackId);
        if (spec.tracks && row) {
          const tracks = spec.tracks.map((track) =>
            track === row ? { ...track, frames: change(track.frames, p) } : track,
          );
          const base = baseTrack(tracks)?.frames ?? [];
          return prune({ ...p, states: { ...p.states, [state]: { ...spec, frames: base, tracks } } });
        }
        return prune({ ...p, states: { ...p.states, [state]: { ...spec, frames: change(spec.frames, p) } } });
      },
      mergeKey,
    );

  /** Keeps the selection on a frame that still exists. */
  const clampSelection = (project: Project) => {
    const { selectedState, selectedIndex } = get();
    const spec = project.states[selectedState];
    const count = (rowOf(spec, get().selectedTrackId)?.frames ?? spec.frames).length;
    return count === 0 ? null : Math.min(selectedIndex ?? 0, count - 1);
  };

  return {
    project: emptyProject(""),
    selectedState: "idle",
    selectedIndex: null,
    selectedTrackId: null,
    previewOpen: false,
    notice: null,
    lang: defaultLang(),
    revision: 0,
    past: [],
    future: [],

    loadProject(project) {
      lastMerge = null;
      set({
        project,
        past: [],
        future: [],
        selectedState: "idle",
        selectedTrackId: project.states.idle.tracks?.[0]?.id ?? null,
        selectedIndex: (project.states.idle.tracks?.[0]?.frames ?? project.states.idle.frames).length ? 0 : null,
        revision: get().revision + 1,
      });
      collect([project]);
    },

    undo() {
      const { past, project, future, revision } = get();
      if (!past.length) return;
      lastMerge = null;
      const previous = past[past.length - 1];
      set({ project: previous, past: past.slice(0, -1), future: [project, ...future], revision: revision + 1 });
      set({ selectedIndex: clampSelection(previous) });
    },

    redo() {
      const { past, project, future, revision } = get();
      if (!future.length) return;
      lastMerge = null;
      const [next, ...rest] = future;
      set({ project: next, past: [...past, project], future: rest, revision: revision + 1 });
      set({ selectedIndex: clampSelection(next) });
    },

    setName: (name) => edit((p) => ({ ...p, name }), "name"),
    setIcon: (icon, iconStyle) => edit((p) => ({ ...p, icon, iconStyle })),

    selectState: (state) => {
      const spec = get().project.states[state];
      const track = spec.tracks?.[0];
      const frames = track?.frames ?? spec.frames;
      set({ selectedState: state, selectedTrackId: track?.id ?? null, selectedIndex: frames.length ? 0 : null });
    },
    selectTrack: (trackId) => {
      const spec = get().project.states[get().selectedState];
      const frames = spec.tracks?.find((track) => track.id === trackId)?.frames ?? [];
      set({ selectedTrackId: trackId, selectedIndex: frames.length ? 0 : null });
    },
    selectFrame: (index) => set({ selectedIndex: index }),

    setEnabled: (state, enabled) =>
      edit((p) => ({ ...p, states: { ...p.states, [state]: { ...p.states[state], enabled: state === "idle" || enabled } } })),

    setSleepAfterMinutes: (minutes) =>
      edit((p) => ({
        ...p,
        states: { ...p.states, sleep: { ...p.states.sleep, sleepAfterMinutes: Math.max(1, Math.min(1440, Math.round(minutes))) } },
      }), "sleep-delay"),

    addTrack(state, name, givenId, onTop = false) {
      edit((p) => {
        const spec = p.states[state];
        // Unnamed rows are labelled by position, in the interface language.
        const tracks = spec.tracks ?? [{ id: "main", name: "", frames: spec.frames }];
        const id = givenId ?? `track-${newId()}`;
        const added = { id, name: name ?? "", frames: [] };
        return { ...p, states: { ...p.states, [state]: { ...spec, tracks: onTop ? [added, ...tracks] : [...tracks, added] } } };
      });
      const tracks = get().project.states[state].tracks;
      const track = tracks?.[onTop ? 0 : tracks.length - 1];
      if (track) set({ selectedTrackId: track.id, selectedIndex: null });
    },

    batch(run) {
      batching = { recorded: false };
      try {
        run();
      } finally {
        batching = null;
        lastMerge = null;
      }
    },

    moveTrack(state, from, to) {
      edit((p) => {
        const spec = p.states[state];
        if (!spec.tracks || from === to || !spec.tracks[from] || !spec.tracks[to]) return p;
        const tracks = [...spec.tracks];
        const [moved] = tracks.splice(from, 1);
        tracks.splice(to, 0, moved);
        return { ...p, states: { ...p.states, [state]: { ...spec, tracks } } };
      });
    },

    renameTrack(state, trackId, name) {
      edit((p) => {
        const spec = p.states[state];
        if (!spec.tracks) return p;
        const tracks = spec.tracks.map((track) => (track.id === trackId ? { ...track, name } : track));
        return { ...p, states: { ...p.states, [state]: { ...spec, tracks } } };
      });
    },

    removeTrack(state, trackId) {
      const before = get().project.states[state].tracks;
      if (!before) return;
      const removedIndex = before.findIndex((track) => track.id === trackId);
      if (removedIndex < 0) return;
      edit((p) => {
        const spec = p.states[state];
        const tracks = spec.tracks?.filter((track) => track.id !== trackId) ?? [];
        const base = baseTrack(tracks)?.frames ?? [];
        return prune({ ...p, states: { ...p.states, [state]: { ...spec, frames: base, tracks } } });
      });
      if (get().selectedTrackId === trackId) {
        const tracks = get().project.states[state].tracks ?? [];
        const next = tracks[Math.min(removedIndex, tracks.length - 1)];
        set({ selectedTrackId: next?.id ?? null, selectedIndex: next?.frames.length ? 0 : null });
      }
    },

    addFrames(state, imported, trackId = get().selectedTrackId) {
      if (!imported.length) return;
      const before = get().project.states[state];
      const target = rowOf(before, trackId)?.frames ?? before.frames;
      const start = target.length;
      edit((p) => {
        const frames = { ...p.frames };
        for (const { asset } of imported) frames[asset.id] = asset;
        const added = imported.map(({ asset, duration }) => ({
          id: asset.id,
          // A GIF's own timing, rounded to whole frames.
          duration: duration === undefined ? undefined : spanDuration(Math.max(1, Math.round((duration * p.fps) / 1000)), p.fps),
        }));
        const spec = p.states[state];
        const next = {
          ...p,
          frames,
          frameOrder: [
            ...p.frameOrder,
            ...imported
              .map((f) => f.asset.id)
              .filter((id, index, ids) => !p.frames[id] && ids.indexOf(id) === index),
          ],
        };
        const row = rowOf(spec, trackId);
        if (spec.tracks && row) {
          const tracks = spec.tracks.map((track) => track === row ? { ...track, frames: [...track.frames, ...added] } : track);
          const base = baseTrack(tracks)?.frames ?? [];
          return { ...next, states: { ...p.states, [state]: { ...spec, enabled: true, frames: base, tracks } } };
        }
        return { ...next, states: { ...p.states, [state]: { ...spec, enabled: true, frames: [...spec.frames, ...added] } } };
      });
      set({ selectedIndex: start });
    },

    replaceFrame(state, index, asset, trackId = get().selectedTrackId) {
      edit((p) => {
        const spec = p.states[state];
        const next = { ...p, frames: { ...p.frames, [asset.id]: asset }, frameOrder: [...p.frameOrder, asset.id] };
        const row = rowOf(spec, trackId);
        if (spec.tracks && row) {
          const tracks = spec.tracks.map((track) => track === row ? { ...track, frames: track.frames.map((f, i) => i === index ? { ...f, id: asset.id } : f) } : track);
          const base = baseTrack(tracks)?.frames ?? [];
          return prune({ ...next, states: { ...p.states, [state]: { ...spec, frames: base, tracks } } });
        }
        return prune({ ...next, states: { ...p.states, [state]: { ...spec, frames: spec.frames.map((f, i) => i === index ? { ...f, id: asset.id } : f) } } });
      });
      set({ selectedIndex: index });
    },

    removeFrame(state, index, trackId = get().selectedTrackId) {
      editFrames(state, trackId, (frames) => frames.filter((_, i) => i !== index));
      const spec = get().project.states[state];
      const left = (rowOf(spec, trackId)?.frames ?? spec.frames).length;
      set({ selectedIndex: left ? Math.min(index, left - 1) : null });
    },

    moveFrame(state, from, to, trackId = get().selectedTrackId) {
      editFrames(state, trackId, (frames) => {
        const next = [...frames];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        return next;
      });
      set({ selectedIndex: to });
    },

    setSpan(state, index, span, trackId = get().selectedTrackId) {
      editFrames(
        state,
        trackId,
        (frames, p) => frames.map((f, i) => (i === index ? { ...f, duration: spanDuration(span, p.fps) } : f)),
        `span:${state}:${trackId ?? "main"}:${index}`,
      );
    },

    setPlacement(state, index, placement, trackId = get().selectedTrackId) {
      const key = Object.keys(placement).sort().join(",");
      editFrames(state, trackId, (frames) => frames.map((f, i) => (i === index ? { ...f, ...placement } : f)), `place:${state}:${trackId ?? "main"}:${index}:${key}`);
    },

    setPreviewOpen: (open) => set({ previewOpen: open }),
    setNotice: (notice) => set({ notice }),
    setLang: (lang) => {
      rememberLang(lang);
      set({ lang });
    },
  };
});

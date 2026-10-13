import { create } from "zustand";
import { defaultLang, rememberLang, type Lang } from "./i18n/strings";
import type { ImportedFrame } from "./model/imageImport";
import {
  emptyProject,
  PET_STATES,
  spanDuration,
  type FrameAsset,
  type FrameEntry,
  type IconStyle,
  type PetState,
  type Project,
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
  selectFrame(index: number | null): void;
  setEnabled(state: PetState, enabled: boolean): void;

  /** Adds uploaded pictures to the end of a state. */
  addFrames(state: PetState, frames: ImportedFrame[]): void;
  /** Swaps the picture of one frame, keeping its length and placement. */
  replaceFrame(state: PetState, index: number, asset: FrameAsset): void;
  removeFrame(state: PetState, index: number): void;
  moveFrame(state: PetState, from: number, to: number): void;
  /** How many timeline frames the picture holds. */
  setSpan(state: PetState, index: number, span: number): void;
  setPlacement(state: PetState, index: number, placement: Placement): void;

  setPreviewOpen(open: boolean): void;
  setNotice(notice: { title: string; body?: string } | null): void;
  setLang(lang: Lang): void;
}

/** Drops uploads no frame uses any more, so they are not saved forever. */
function prune(project: Project): Project {
  const used = new Set(PET_STATES.flatMap((s) => project.states[s].frames.map((f) => f.id)));
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

  /** Applies a change to the project as one undoable step — or as part of
   *  the previous one, for repeated changes with the same `mergeKey`. */
  const edit = (change: (p: Project) => Project, mergeKey?: string) => {
    const { project, past, revision } = get();
    const next = change(project);
    if (next === project) return;
    const now = Date.now();
    const merge = !!mergeKey && lastMerge?.key === mergeKey && now - lastMerge.at < MERGE_MS && past.length > 0;
    lastMerge = mergeKey ? { key: mergeKey, at: now } : null;
    const nextPast = merge ? past : [...past, project].slice(-HISTORY_LIMIT);
    set({ project: next, past: nextPast, future: [], revision: revision + 1 });
    collect([next, ...nextPast]);
  };

  const editFrames = (state: PetState, change: (frames: FrameEntry[], project: Project) => FrameEntry[], mergeKey?: string) =>
    edit(
      (p) => prune({ ...p, states: { ...p.states, [state]: { ...p.states[state], frames: change(p.states[state].frames, p) } } }),
      mergeKey,
    );

  /** Keeps the selection on a frame that still exists. */
  const clampSelection = (project: Project) => {
    const { selectedState, selectedIndex } = get();
    const count = project.states[selectedState].frames.length;
    return count === 0 ? null : Math.min(selectedIndex ?? 0, count - 1);
  };

  return {
    project: emptyProject(""),
    selectedState: "idle",
    selectedIndex: null,
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
        selectedIndex: project.states.idle.frames.length ? 0 : null,
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

    selectState: (state) =>
      set({ selectedState: state, selectedIndex: get().project.states[state].frames.length ? 0 : null }),
    selectFrame: (index) => set({ selectedIndex: index }),

    setEnabled: (state, enabled) =>
      edit((p) => ({ ...p, states: { ...p.states, [state]: { ...p.states[state], enabled: state === "idle" || enabled } } })),

    addFrames(state, imported) {
      if (!imported.length) return;
      const start = get().project.states[state].frames.length;
      edit((p) => {
        const frames = { ...p.frames };
        for (const { asset } of imported) frames[asset.id] = asset;
        const spec = p.states[state];
        const added = imported.map(({ asset, duration }) => ({
          id: asset.id,
          // A GIF's own timing, rounded to whole frames.
          duration: duration === undefined ? undefined : spanDuration(Math.max(1, Math.round((duration * p.fps) / 1000)), p.fps),
        }));
        return {
          ...p,
          frames,
          frameOrder: [...p.frameOrder, ...imported.map((f) => f.asset.id)],
          // Giving a reaction pictures is the moment it is clearly wanted.
          states: { ...p.states, [state]: { ...spec, enabled: true, frames: [...spec.frames, ...added] } },
        };
      });
      set({ selectedIndex: start });
    },

    replaceFrame(state, index, asset) {
      edit((p) => {
        const spec = p.states[state];
        return prune({
          ...p,
          frames: { ...p.frames, [asset.id]: asset },
          frameOrder: [...p.frameOrder, asset.id],
          states: {
            ...p.states,
            [state]: { ...spec, frames: spec.frames.map((f, i) => (i === index ? { ...f, id: asset.id } : f)) },
          },
        });
      });
      set({ selectedIndex: index });
    },

    removeFrame(state, index) {
      editFrames(state, (frames) => frames.filter((_, i) => i !== index));
      const left = get().project.states[state].frames.length;
      set({ selectedIndex: left ? Math.min(index, left - 1) : null });
    },

    moveFrame(state, from, to) {
      editFrames(state, (frames) => {
        const next = [...frames];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        return next;
      });
      set({ selectedIndex: to });
    },

    setSpan(state, index, span) {
      editFrames(
        state,
        (frames, p) => frames.map((f, i) => (i === index ? { ...f, duration: spanDuration(span, p.fps) } : f)),
        `span:${state}:${index}`,
      );
    },

    setPlacement(state, index, placement) {
      const key = Object.keys(placement).sort().join(",");
      editFrames(state, (frames) => frames.map((f, i) => (i === index ? { ...f, ...placement } : f)), `place:${state}:${index}:${key}`);
    },

    setPreviewOpen: (open) => set({ previewOpen: open }),
    setNotice: (notice) => set({ notice }),
    setLang: (lang) => {
      rememberLang(lang);
      set({ lang });
    },
  };
});

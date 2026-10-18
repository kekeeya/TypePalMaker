import { create } from "zustand";
import { defaultLang, rememberLang, type Lang } from "./i18n/strings";
import type { ImportedFrame } from "./model/imageImport";
import {
  emptyProject,
  allStateFrames,
  baseTrack,
  newId,
  newVariant,
  PET_STATES,
  spanDuration,
  type FrameAsset,
  type FrameEntry,
  type IconStyle,
  type PetState,
  type Project,
  type FrameTrack,
  type StateSpec,
  type StateVariant,
  timelineTracks,
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
  /** The random action being edited; null is the reaction's usual animation. */
  selectedVariantId: string | null;
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
  selectVariant(variantId: string | null): void;
  /** A new random action for the selected reaction, selected. */
  addVariant(state: PetState, name: string): void;
  removeVariant(state: PetState, variantId: string): void;
  renameVariant(state: PetState, variantId: string, name: string): void;
  moveVariant(state: PetState, from: number, to: number): void;
  setVariantFrequency(state: PetState, variantId: string, frequency: Pick<StateVariant, "every" | "chance">): void;
  /** The lines of a random action, or of the usual animation (null). */
  setLines(state: PetState, variantId: string | null, lines: string[]): void;
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

/** The rows of a reaction's tab: its own, or a random action's. */
export function rowsIn(spec: StateSpec, variantId: string | null): FrameTrack[] | undefined {
  return variantId ? spec.variants?.find((variant) => variant.id === variantId)?.tracks : (spec.tracks ?? timelineTracks(spec));
}

/** A reaction with a tab's rows replaced; `frames` follows the pet's own
 *  row of the usual animation. */
function putRows(spec: StateSpec, variantId: string | null, tracks: FrameTrack[]): StateSpec {
  if (variantId) return { ...spec, variants: (spec.variants ?? []).map((v) => (v.id === variantId ? { ...v, tracks } : v)) };
  return { ...spec, tracks, frames: baseTrack(tracks)?.frames ?? [] };
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

  /** The tab a reaction's row edits go to: the selected one for the
   *  selected reaction, the usual animation for any other. */
  const tabOf = (state: PetState) => (state === get().selectedState ? get().selectedVariantId : null);

  /** The row an edit lands on: the one asked for, else the pet's own. */
  const rowOf = (tracks: FrameTrack[], trackId: string | null | undefined) =>
    tracks.find((track) => track.id === trackId) ?? baseTrack(tracks);

  /** Changes the rows of a reaction's tab; `frames` follows the pet's own
   *  row of the usual animation. Returning the rows unchanged changes nothing. */
  const editRows = (
    state: PetState,
    change: (tracks: FrameTrack[], project: Project) => FrameTrack[],
    { mergeKey, extra }: { mergeKey?: string; extra?: (p: Project) => Project } = {},
  ) =>
    edit((p) => {
      const base = extra ? extra(p) : p;
      const spec = base.states[state];
      const variantId = tabOf(state);
      const tracks = rowsIn(spec, variantId);
      if (!tracks) return p;
      const next = change(tracks, base);
      if (next === tracks) return p;
      return prune({ ...base, states: { ...base.states, [state]: putRows(spec, variantId, next) } });
    }, mergeKey);

  const editFrames = (
    state: PetState,
    trackId: string | null | undefined,
    change: (frames: FrameEntry[], project: Project) => FrameEntry[],
    mergeKey?: string,
  ) =>
    editRows(
      state,
      (tracks, p) => {
        const row = rowOf(tracks, trackId);
        return row ? tracks.map((track) => (track === row ? { ...track, frames: change(track.frames, p) } : track)) : tracks;
      },
      { mergeKey },
    );

  const editVariants = (state: PetState, change: (variants: StateVariant[]) => StateVariant[], mergeKey?: string) =>
    edit((p) => {
      const spec = p.states[state];
      const variants = change(spec.variants ?? []);
      return prune({ ...p, states: { ...p.states, [state]: { ...spec, variants } } });
    }, mergeKey);

  /** The rows of the tab shown. */
  const shownRows = (project: Project) => rowsIn(project.states[get().selectedState], get().selectedVariantId) ?? [];

  /** Keeps the selection on a tab and a frame that still exist. */
  const clampSelection = (project: Project) => {
    const { selectedState, selectedVariantId, selectedIndex } = get();
    if (selectedVariantId && !project.states[selectedState].variants?.some((v) => v.id === selectedVariantId)) {
      const tracks = timelineTracks(project.states[selectedState]);
      return { selectedVariantId: null, selectedTrackId: tracks[0]?.id ?? null, selectedIndex: tracks[0]?.frames.length ? 0 : null };
    }
    const count = (rowOf(shownRows(project), get().selectedTrackId)?.frames ?? []).length;
    return { selectedIndex: count === 0 ? null : Math.min(selectedIndex ?? 0, count - 1) };
  };

  /** Selects a tab's first row. */
  const showTab = (state: PetState, variantId: string | null) => {
    const tracks = rowsIn(get().project.states[state], variantId) ?? [];
    set({ selectedState: state, selectedVariantId: variantId, selectedTrackId: tracks[0]?.id ?? null, selectedIndex: tracks[0]?.frames.length ? 0 : null });
  };

  return {
    project: emptyProject(""),
    selectedState: "idle",
    selectedIndex: null,
    selectedTrackId: null,
    selectedVariantId: null,
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
        selectedVariantId: null,
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
      set(clampSelection(previous));
    },

    redo() {
      const { past, project, future, revision } = get();
      if (!future.length) return;
      lastMerge = null;
      const [next, ...rest] = future;
      set({ project: next, past: [...past, project], future: rest, revision: revision + 1 });
      set(clampSelection(next));
    },

    setName: (name) => edit((p) => ({ ...p, name }), "name"),
    setIcon: (icon, iconStyle) => edit((p) => ({ ...p, icon, iconStyle })),

    selectState: (state) => showTab(state, null),
    selectTrack: (trackId) => {
      const frames = shownRows(get().project).find((track) => track.id === trackId)?.frames ?? [];
      set({ selectedTrackId: trackId, selectedIndex: frames.length ? 0 : null });
    },
    selectVariant: (variantId) => showTab(get().selectedState, variantId),

    addVariant(state, name) {
      const variant = newVariant(state, `v-${newId()}`, name);
      editVariants(state, (variants) => [...variants, variant]);
      showTab(state, variant.id);
    },
    removeVariant(state, variantId) {
      editVariants(state, (variants) => variants.filter((variant) => variant.id !== variantId));
      if (get().selectedVariantId === variantId) showTab(state, null);
    },
    renameVariant(state, variantId, name) {
      editVariants(state, (variants) => variants.map((variant) => (variant.id === variantId ? { ...variant, name } : variant)));
    },
    moveVariant(state, from, to) {
      editVariants(state, (variants) => {
        if (from === to || !variants[from] || !variants[to]) return variants;
        const next = [...variants];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        return next;
      });
    },
    setVariantFrequency(state, variantId, frequency) {
      editVariants(
        state,
        (variants) => variants.map((variant) => (variant.id === variantId ? { ...variant, ...frequency } : variant)),
        `frequency:${state}:${variantId}`,
      );
    },
    setLines(state, variantId, lines) {
      if (!variantId) {
        edit((p) => ({ ...p, states: { ...p.states, [state]: { ...p.states[state], lines } } }));
        return;
      }
      editVariants(state, (variants) => variants.map((variant) => (variant.id === variantId ? { ...variant, lines } : variant)));
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
      // Unnamed rows are labelled by position, in the interface language.
      const added = { id: givenId ?? `track-${newId()}`, name: name ?? "", frames: [] };
      editRows(state, (tracks) => (onTop ? [added, ...tracks] : [...tracks, added]));
      set({ selectedTrackId: added.id, selectedIndex: null });
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
      editRows(state, (tracks) => {
        if (from === to || !tracks[from] || !tracks[to]) return tracks;
        const next = [...tracks];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        return next;
      });
    },

    renameTrack(state, trackId, name) {
      editRows(state, (tracks) => tracks.map((track) => (track.id === trackId ? { ...track, name } : track)));
    },

    removeTrack(state, trackId) {
      const removedIndex = shownRows(get().project).findIndex((track) => track.id === trackId);
      if (removedIndex < 0) return;
      editRows(state, (tracks) => tracks.filter((track) => track.id !== trackId));
      if (get().selectedTrackId === trackId) {
        const tracks = shownRows(get().project);
        const next = tracks[Math.min(removedIndex, tracks.length - 1)];
        set({ selectedTrackId: next?.id ?? null, selectedIndex: next?.frames.length ? 0 : null });
      }
    },

    addFrames(state, imported, trackId = get().selectedTrackId) {
      if (!imported.length) return;
      const tracks = rowsIn(get().project.states[state], tabOf(state)) ?? [];
      const start = (rowOf(tracks, trackId)?.frames ?? []).length;
      const fps = get().project.fps;
      const added = imported.map(({ asset, duration }) => ({
        id: asset.id,
        // A GIF's own timing, rounded to whole frames.
        duration: duration === undefined ? undefined : spanDuration(Math.max(1, Math.round((duration * fps) / 1000)), fps),
      }));
      editRows(
        state,
        (tracks) => {
          const row = rowOf(tracks, trackId);
          return row ? tracks.map((track) => (track === row ? { ...track, frames: [...track.frames, ...added] } : track)) : tracks;
        },
        {
          // The pictures join the library, and the reaction is on: it has frames now.
          extra: (p) => ({
            ...p,
            frames: { ...p.frames, ...Object.fromEntries(imported.map(({ asset }) => [asset.id, asset])) },
            frameOrder: [
              ...p.frameOrder,
              ...imported.map((f) => f.asset.id).filter((id, index, ids) => !p.frameOrder.includes(id) && ids.indexOf(id) === index),
            ],
            states: { ...p.states, [state]: { ...p.states[state], enabled: true } },
          }),
        },
      );
      set({ selectedIndex: start });
    },

    replaceFrame(state, index, asset, trackId = get().selectedTrackId) {
      editRows(
        state,
        (tracks) => {
          const row = rowOf(tracks, trackId);
          return row
            ? tracks.map((track) => (track === row ? { ...track, frames: track.frames.map((f, i) => (i === index ? { ...f, id: asset.id } : f)) } : track))
            : tracks;
        },
        { extra: (p) => ({ ...p, frames: { ...p.frames, [asset.id]: asset }, frameOrder: p.frameOrder.includes(asset.id) ? p.frameOrder : [...p.frameOrder, asset.id] }) },
      );
      set({ selectedIndex: index });
    },

    removeFrame(state, index, trackId = get().selectedTrackId) {
      editFrames(state, trackId, (frames) => frames.filter((_, i) => i !== index));
      const left = (rowOf(rowsIn(get().project.states[state], tabOf(state)) ?? [], trackId)?.frames ?? []).length;
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
        `span:${state}:${tabOf(state) ?? ""}:${trackId ?? "main"}:${index}`,
      );
    },

    setPlacement(state, index, placement, trackId = get().selectedTrackId) {
      const key = Object.keys(placement).sort().join(",");
      editFrames(state, trackId, (frames) => frames.map((f, i) => (i === index ? { ...f, ...placement } : f)), `place:${state}:${tabOf(state) ?? ""}:${trackId ?? "main"}:${index}:${key}`);
    },

    setPreviewOpen: (open) => set({ previewOpen: open }),
    setNotice: (notice) => set({ notice }),
    setLang: (lang) => {
      rememberLang(lang);
      set({ lang });
    },
  };
});

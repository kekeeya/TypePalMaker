/** The reactions, in the order the editor lists them. Keys match
 *  `manifest.json` and the Swift `PetState`. */
export const PET_STATES = ["idle", "typing", "mouseClick", "tap", "pet", "sleep"] as const;
export type PetState = (typeof PET_STATES)[number];

export interface FrameEntry {
  id: string;
  /** Milliseconds; undefined means one frame (1 / fps). The editor always
   *  keeps it a whole number of frames. */
  duration?: number;
  /** Placement on the canvas, made in the editor: a scale of the image as
   *  fitted, an offset in canvas pixels, and a rotation in degrees. Baked
   *  into the picture when the app is generated. */
  scale?: number;
  offsetX?: number;
  offsetY?: number;
  rotation?: number;
}

export interface StateSpec {
  enabled: boolean;
  fps: number;
  loop: boolean;
  frames: FrameEntry[];
  /** Rows played together on one clock, the first drawn over the others. */
  tracks?: FrameTrack[];
  /** Minutes without keyboard or mouse activity before sleep starts. */
  sleepAfterMinutes?: number;
  /** Lines the pet may say when this reaction plays as usual. */
  lines?: string[];
  /** Random actions: other animations played now and then instead. */
  variants?: StateVariant[];
}

/**
 * A random action of a reaction: its own rows (none with pictures: the
 * reaction's usual animation), lines to say, and how often it comes. A
 * looping reaction (idle, sleep) plays it once every `every` seconds, a
 * random time in the range; any other plays it instead of the usual
 * animation with probability `chance`.
 */
export interface StateVariant {
  id: string;
  name: string;
  tracks: FrameTrack[];
  lines: string[];
  every?: [number, number];
  chance?: number;
}

/** The three ready-made frequencies of a random action. */
export const FREQUENCIES = {
  /** Seconds between two plays of a looping reaction's action. */
  every: { rare: [2700, 3600], sometimes: [300, 600], often: [60, 180] } as Record<Frequency, [number, number]>,
  /** Chance a triggered reaction plays the action instead. */
  chance: { rare: 0.1, sometimes: 0.2, often: 0.4 } as Record<Frequency, number>,
};
export type Frequency = "rare" | "sometimes" | "often";
/** Lines are short; a pool holds a handful. */
export const LINE_MAX_CHARS = 30;
export const LINES_PER_POOL = 20;

/** Whether a reaction loops (and so times its random actions) or plays
 *  once per trigger (and so rolls for them). */
export function loops(state: PetState): boolean {
  return state === "idle" || state === "sleep";
}

/** A new random action for a reaction, coming "sometimes". */
export function newVariant(state: PetState, id: string, name: string): StateVariant {
  return {
    id,
    name,
    tracks: [{ id: "main", name: "", frames: [] }],
    lines: [],
    ...(loops(state) ? { every: FREQUENCIES.every.sometimes } : { chance: FREQUENCIES.chance.sometimes }),
  };
}

/** Whether an action has pictures of its own; without, it plays the
 *  reaction's usual animation. */
export function hasOwnFrames(variant: StateVariant): boolean {
  return variant.tracks.some((track) => track.frames.length > 0);
}

/**
 * The rows an action plays. Its pet row left empty is the reaction's usual
 * animation, under the action's other rows (an effect added to an action
 * plays over the pet as it is); an action with no pictures at all is the
 * usual animation.
 */
export function variantRows(spec: StateSpec, variant: StateVariant): FrameTrack[] {
  if (!hasOwnFrames(variant)) return timelineTracks(spec);
  const base = baseTrack(variant.tracks);
  if (!base || base.frames.length) return variant.tracks;
  return [...variant.tracks.filter((track) => track !== base), ...timelineTracks(spec)];
}

export interface FrameTrack {
  id: string;
  name: string;
  frames: FrameEntry[];
}

/** An uploaded image. `png` is what gets saved; `url` is a blob URL for
 *  display and lives only as long as the page. */
export interface FrameAsset {
  id: string;
  name: string;
  png: Uint8Array;
  width: number;
  height: number;
  url: string;
}

/** The pet's picture: every frame is drawn into a canvas this size. At `dpi`
 *  144 a pixel is half a point, as on a Retina screen. */
export interface Canvas {
  width: number;
  height: number;
  dpi: number;
}

/** How the app icon is drawn: the picture fitted into a square, then moved
 *  (in icon pixels, see `ICON_SIDE`), scaled and rotated about its centre,
 *  over a background colour. */
export interface IconStyle {
  background: string;
  scale: number;
  offsetX: number;
  offsetY: number;
  rotation: number;
}

export const DEFAULT_ICON_STYLE: IconStyle = { background: "#ffffff", scale: 1, offsetX: 0, offsetY: 0, rotation: 0 };

export interface Project {
  name: string;
  /** Stable across regenerations, so a regenerated app keeps its settings. */
  id: string;
  /** One frame rate for the whole pet: the timeline counts in these frames. */
  fps: number;
  canvas: Canvas;
  frames: Record<string, FrameAsset>;
  /** Upload order, newest last. */
  frameOrder: string[];
  states: Record<PetState, StateSpec>;
  /** The picture uploaded for the app icon; the first idle frame otherwise. */
  icon?: FrameAsset;
  iconStyle: IconStyle;
}

export const DEFAULT_CANVAS: Canvas = { width: 500, height: 500, dpi: 144 };
export const DEFAULT_FPS = 8;

/** What the create dialog offers. Imported projects may use other rates,
 *  within `FPS_LIMITS`. */
export const CANVAS_LIMITS = { min: 64, max: 1447 };
export const FPS_OPTIONS = [8, 10, 12, 24] as const;
export const FPS_LIMITS = { min: 1, max: 60 };

export const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? Math.round(value) : min));

/** The pet's height on the desktop at 100%, in points: the canvas printed at
 *  its dpi (72 points to the inch). */
export function displayHeight(canvas: Canvas): number {
  return Math.round((canvas.height * 72) / canvas.dpi);
}

/** Only idle starts on: the rest switch on when they get their first frame. */
const STARTS_ENABLED: Record<PetState, boolean> = {
  idle: true,
  typing: false,
  mouseClick: false,
  tap: false,
  pet: false,
  sleep: false,
};

/** Every reaction plays its frames once per trigger; idle loops whenever
 *  nothing else plays (see `PetBehavior`). Fixed, not offered in the editor. */
export const PLAYS_ONCE: Record<PetState, boolean> = {
  idle: false,
  typing: true,
  mouseClick: true,
  tap: true,
  pet: true,
  sleep: false,
};

export function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function emptyStates(fps: number): Record<PetState, StateSpec> {
  const states = {} as Record<PetState, StateSpec>;
  for (const state of PET_STATES) {
    states[state] = state === "sleep"
      ? {
          enabled: false,
          fps,
          loop: true,
          frames: [],
          sleepAfterMinutes: 15,
          // One empty row, as every reaction starts; Zzz is a built-in
          // effect added over it.
          tracks: [{ id: "sleep-base", name: "", frames: [] }],
        }
      : withTracks({ enabled: STARTS_ENABLED[state], fps, loop: !PLAYS_ONCE[state], frames: [] });
  }
  return states;
}

export function emptyProject(name: string, canvas: Canvas = DEFAULT_CANVAS, fps = DEFAULT_FPS): Project {
  return {
    name,
    id: newId(),
    fps,
    canvas: { ...canvas },
    frames: {},
    frameOrder: [],
    states: emptyStates(fps),
    iconStyle: { ...DEFAULT_ICON_STYLE },
  };
}

/** How many timeline frames an entry covers. */
export function frameSpan(entry: FrameEntry, fps: number): number {
  return entry.duration === undefined ? 1 : Math.max(1, Math.round((entry.duration * fps) / 1000));
}

/** The duration to store for an entry covering `span` frames. */
export function spanDuration(span: number, fps: number): number | undefined {
  return span <= 1 ? undefined : (Math.round(span) * 1000) / fps;
}

/** Every reaction is edited as rows on one timeline; a state saved before
 *  rows existed gets one, holding its frames. */
export function withTracks(spec: StateSpec): StateSpec {
  return spec.tracks ? spec : { ...spec, tracks: [{ id: "main", name: "", frames: spec.frames }] };
}

/** The row holding the pet itself: `frames` mirrors it, for readers that
 *  know only one row (pets made before rows). */
export function baseTrack(tracks: FrameTrack[]): FrameTrack | undefined {
  return tracks.find((track) => track.id === "sleep-base" || track.id === "main") ?? tracks.at(-1);
}

export function timelineTracks(spec: StateSpec): FrameTrack[] {
  return spec.tracks?.length ? spec.tracks : [{ id: "main", name: "", frames: spec.frames }];
}

/** The frames of a reaction's own rows: what makes it playable. */
export function ownFrames(spec: StateSpec): FrameEntry[] {
  return timelineTracks(spec).flatMap((track) => track.frames);
}

/** Every frame a reaction shows: its rows and its random actions'. */
export function allStateFrames(spec: StateSpec): FrameEntry[] {
  return [...timelineTracks(spec), ...(spec.variants ?? []).flatMap((variant) => variant.tracks)].flatMap((track) => track.frames);
}

export function hasPlacement(entry: FrameEntry): boolean {
  return (
    (entry.scale !== undefined && entry.scale !== 1) ||
    !!entry.offsetX ||
    !!entry.offsetY ||
    !!entry.rotation
  );
}

/** The five reactions, in the order the editor lists them. Keys match
 *  `manifest.json` and the Swift `PetState`. */
export const PET_STATES = ["idle", "typing", "mouseClick", "tap", "pet"] as const;
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
};

/** Every reaction plays its frames once per trigger; idle loops whenever
 *  nothing else plays (see `PetBehavior`). Fixed, not offered in the editor. */
export const PLAYS_ONCE: Record<PetState, boolean> = {
  idle: false,
  typing: true,
  mouseClick: true,
  tap: true,
  pet: true,
};

export function newId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(4));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function emptyStates(fps: number): Record<PetState, StateSpec> {
  const states = {} as Record<PetState, StateSpec>;
  for (const state of PET_STATES) states[state] = { enabled: STARTS_ENABLED[state], fps, loop: !PLAYS_ONCE[state], frames: [] };
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

/** Seconds each frame of a state stays up. */
export function durations(spec: StateSpec): number[] {
  return spec.frames.map((f) => (f.duration ?? 1000 / spec.fps) / 1000);
}

export function hasPlacement(entry: FrameEntry): boolean {
  return (
    (entry.scale !== undefined && entry.scale !== 1) ||
    !!entry.offsetX ||
    !!entry.offsetY ||
    !!entry.rotation
  );
}

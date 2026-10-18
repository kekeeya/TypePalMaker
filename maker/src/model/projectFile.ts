import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import {
  clamp,
  DEFAULT_CANVAS,
  DEFAULT_FPS,
  DEFAULT_ICON_STYLE,
  displayHeight,
  emptyStates,
  newId,
  baseTrack,
  withTracks,
  FPS_LIMITS,
  frameSpan,
  PET_STATES,
  PLAYS_ONCE,
  spanDuration,
  type Canvas,
  type FrameAsset,
  type FrameEntry,
  type FrameTrack,
  type IconStyle,
  type PetState,
  type Project,
  type StateSpec,
} from "./types";

/**
 * `.typepalproj`: a zip of `manifest.json`, `frames/<id>.png` and an optional
 * `icon.png`. The manifest is the one the TypePal runtime reads (see
 * `schema/manifest.schema.json`) plus the editor's own `canvas`, which the
 * runtime ignores, and `iconStyle`. Placement made in the editor is kept as
 * it is here and only baked into the pictures — and the icon — when an app is
 * generated (see `bake.ts`).
 */

type ManifestFrame = string | ({ id: string } & Omit<FrameEntry, "id">);

interface ManifestJSON {
  schemaVersion: 1;
  name: string;
  id: string;
  display: { height: number };
  canvas?: Canvas;
  /** Editor only: how `icon.png` is placed on the icon. */
  iconStyle?: IconStyle;
  frames: Record<string, { file: string; name?: string }>;
  states: Partial<Record<PetState, {
    enabled: boolean;
    fps: number;
    loop: boolean;
    frames: ManifestFrame[];
    tracks?: { id: string; name: string; frames: ManifestFrame[] }[];
    sleepAfterMinutes?: number;
  }>>;
}

export function encodeProject(project: Project): Uint8Array {
  const used = new Set(project.frameOrder);
  const manifest: ManifestJSON = {
    schemaVersion: 1,
    name: project.name,
    id: project.id,
    display: { height: displayHeight(project.canvas) },
    canvas: project.canvas,
    iconStyle: project.iconStyle,
    frames: {},
    states: {},
  };
  const files: Record<string, Uint8Array> = {};

  for (const id of project.frameOrder) {
    const frame = project.frames[id];
    if (!frame) continue;
    const file = `frames/${id}.png`;
    // `name` is the editor's own label; the runtime ignores it.
    manifest.frames[id] = { file, name: frame.name };
    files[file] = frame.png;
  }
  for (const state of PET_STATES) {
    const spec = project.states[state];
    // The rows are what the editor changes; `frames` is the pet's own row.
    // A reaction that is just that row is saved as before rows existed.
    const own = spec.tracks?.length ? (baseTrack(spec.tracks)?.frames ?? []) : spec.frames;
    const plain = state !== "sleep" && spec.tracks?.length === 1 && spec.tracks[0].id === "main" && !spec.tracks[0].name;
    manifest.states[state] = {
      enabled: spec.enabled,
      fps: project.fps,
      loop: !PLAYS_ONCE[state],
      frames: own.filter((f) => used.has(f.id)).map(compactEntry),
      ...(spec.tracks !== undefined && !plain ? {
        tracks: spec.tracks.map((track) => ({
          id: track.id,
          name: track.name,
          frames: track.frames.filter((f) => used.has(f.id)).map(compactEntry),
        })),
      } : {}),
      ...(state === "sleep" ? { sleepAfterMinutes: spec.sleepAfterMinutes ?? 15 } : {}),
    };
  }
  if (project.icon) files["icon.png"] = project.icon.png;

  files["manifest.json"] = strToU8(JSON.stringify(manifest, null, 2));
  // PNGs are already compressed; deflating them again only costs time.
  return zipSync(
    Object.fromEntries(Object.entries(files).map(([k, v]) => [k, [v, { level: k.endsWith(".png") ? 0 : 6 }]])),
  );
}

/** A bare id when there is nothing else to say, as the runtime allows. */
function compactEntry(entry: FrameEntry): ManifestFrame {
  const out: Record<string, unknown> = { id: entry.id };
  for (const key of ["duration", "scale", "offsetX", "offsetY", "rotation"] as const) {
    if (entry[key] !== undefined) out[key] = entry[key];
  }
  return Object.keys(out).length === 1 ? entry.id : (out as ManifestFrame);
}

export async function decodeProject(bytes: Uint8Array): Promise<Project> {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(bytes);
  } catch {
    throw new Error("not-a-project");
  }
  const raw = files["manifest.json"];
  if (!raw) throw new Error("not-a-project");
  const manifest = JSON.parse(strFromU8(raw)) as ManifestJSON;
  if (manifest.schemaVersion !== 1) throw new Error("unsupported-version");

  const frames: Record<string, FrameAsset> = {};
  const frameOrder: string[] = [];
  for (const [id, ref] of Object.entries(manifest.frames ?? {})) {
    const png = files[ref.file];
    if (!png) continue;
    frames[id] = await assetFromBytes(id, ref.name ?? id, png);
    frameOrder.push(id);
  }

  // Older projects timed each state on its own. One rate for all — the
  // fastest, so no frame gets shorter than one step — keeps every duration.
  const rates = PET_STATES.map((s) => manifest.states?.[s]).filter((s) => s?.enabled).map((s) => s!.fps);
  const fps = clamp(rates.length ? Math.max(...rates) : DEFAULT_FPS, FPS_LIMITS.min, FPS_LIMITS.max);

  const states: Record<PetState, StateSpec> = emptyStates(fps);
  for (const state of PET_STATES) {
    const spec = manifest.states?.[state];
    if (!spec) continue;
    const ownStep = 1000 / (spec.fps > 0 ? spec.fps : fps);
    states[state] = {
      enabled: spec.enabled,
      fps,
      loop: !PLAYS_ONCE[state],
      frames: (spec.frames ?? [])
        .map((f): FrameEntry => (typeof f === "string" ? { id: f } : { ...f }))
        .filter((f) => frames[f.id])
        .map((f) => ({ ...f, duration: spanDuration(frameSpan({ id: f.id, duration: f.duration ?? ownStep }, fps), fps) })),
      ...(spec.tracks !== undefined ? {
        tracks: spec.tracks.map((track): FrameTrack => ({
          id: track.id,
          name: track.name ?? "",
          frames: (track.frames ?? [])
            .map((f): FrameEntry => typeof f === "string" ? { id: f } : { ...f })
            .filter((f) => frames[f.id])
            .map((f) => ({ ...f, duration: spanDuration(frameSpan({ id: f.id, duration: f.duration ?? ownStep }, fps), fps) })),
        })),
      } : {}),
      ...(state === "sleep" ? { sleepAfterMinutes: spec.sleepAfterMinutes ?? 15 } : {}),
    };
    if (state !== "sleep") states[state] = withTracks(states[state]);
    else if (states.sleep.tracks === undefined) {
      states.sleep.tracks = [
        { id: "sleep-effects", name: "", frames: [] },
        { id: "sleep-base", name: "", frames: states.sleep.frames },
      ];
    }
  }

  const iconBytes = files["icon.png"];
  return {
    name: manifest.name ?? "",
    // The id names the app's bundle and the Maker's storage, so only the
    // runtime's own pattern will do; anything else gets a fresh one.
    id: typeof manifest.id === "string" && /^[a-z0-9-]{1,40}$/.test(manifest.id) ? manifest.id : newId(),
    fps,
    canvas: manifest.canvas ?? legacyCanvas(manifest.display?.height, frames),
    frames,
    frameOrder,
    states,
    icon: iconBytes ? await assetFromBytes("icon", "icon", iconBytes) : undefined,
    iconStyle: { ...DEFAULT_ICON_STYLE, ...manifest.iconStyle },
  };
}

/** Projects from before the canvas existed: Retina pixels at the old
 *  designed height, as wide as the widest picture. */
function legacyCanvas(height: number | undefined, frames: Record<string, FrameAsset>): Canvas {
  if (!height) return { ...DEFAULT_CANVAS };
  let aspect = 1;
  for (const f of Object.values(frames)) if (f.width > 0 && f.height > 0) aspect = Math.max(aspect, f.width / f.height);
  const px = Math.round(height * 2);
  return { width: Math.round(px * aspect), height: px, dpi: 144 };
}

/** Wraps stored PNG bytes as an asset, reading its size. */
export async function assetFromBytes(id: string, name: string, png: Uint8Array): Promise<FrameAsset> {
  const blob = new Blob([png as BlobPart], { type: "image/png" });
  let width = 0;
  let height = 0;
  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(blob);
    width = bitmap.width;
    height = bitmap.height;
    bitmap.close();
  }
  return { id, name, png, width, height, url: typeof URL.createObjectURL === "function" ? URL.createObjectURL(blob) : "" };
}

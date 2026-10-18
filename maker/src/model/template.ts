import { assetFromBytes } from "./projectFile";
import { emptyProject, frameSpan, PET_STATES, spanDuration, type PetState, type Project } from "./types";

/** The built-in TypePal mascot. Its frames are ready to play as they are:
 *  `animation.json` gives the canvas, the frame rate and each reaction's
 *  frames in order. */
export const assetUrl = (path: string) => `${import.meta.env.BASE_URL}assets/${path}`;
export const HERO_URL = assetUrl("typepal-hero.png");

const FRAMES_DIR = "typepal-frames";
const SLEEP_Z_FILES = ["sleep-z-01.png", "sleep-z-02.png", "sleep-z-03.png"];
const fourFrames = (kind: string) => [1, 2, 3, 4].map((n) => `${kind}-0${n}.png`);

/** The built-in effects, in the order the editor offers them: each a row of
 *  pictures one frame apart, with an icon at `<kind>-effect-icon.png`. */
export const BUILT_IN_EFFECTS = {
  zzz: SLEEP_Z_FILES,
  heart: fourFrames("heart"),
  sweat: fourFrames("sweat"),
  anger: fourFrames("anger"),
  raincloud: fourFrames("raincloud"),
  question: fourFrames("question"),
  exclamation: fourFrames("exclamation"),
  music: fourFrames("music"),
  sparkle: fourFrames("sparkle"),
};
export type BuiltInEffect = keyof typeof BUILT_IN_EFFECTS;
export const EFFECT_KINDS = Object.keys(BUILT_IN_EFFECTS) as BuiltInEffect[];

/** The id of an effect's row: Zzz keeps the sleep template's own. A second
 *  row of the same effect gets a suffix. */
export const effectRowId = (effect: BuiltInEffect) => (effect === "zzz" ? "sleep-effects" : `effect-${effect}`);

/** The effect a row was added as, if it was. */
export function effectOfRow(trackId: string): BuiltInEffect | undefined {
  return EFFECT_KINDS.find((effect) => trackId === effectRowId(effect) || trackId.startsWith(`${effectRowId(effect)}-`));
}

interface AnimationJSON {
  fps: number;
  canvas: { width: number; height: number };
  states: Partial<Record<PetState, string[]>>;
}

export async function templateProject(name: string): Promise<Project> {
  const response = await fetch(assetUrl(`${FRAMES_DIR}/animation.json`));
  if (!response.ok) throw new Error("missing animation.json");
  const animation = (await response.json()) as AnimationJSON;
  const project = emptyProject(name, { ...animation.canvas, dpi: 144 }, animation.fps);

  // The same picture is loaded once; the same picture several frames in a
  // row becomes one clip that lasts that long, as one would make it by hand.
  const idByContent = new Map<string, string>();
  const loadTemplateFile = async (file: string) => {
    const image = await fetch(assetUrl(`${FRAMES_DIR}/${file}`));
    if (!image.ok) throw new Error(`missing ${file}`);
    const bytes = new Uint8Array(await image.arrayBuffer());
    const digest = await contentKey(bytes);
    let id = idByContent.get(digest);
    if (!id) {
      id = file.replace(/\.png$/, "").replace(/-/g, "");
      idByContent.set(digest, id);
      project.frames[id] = await assetFromBytes(id, file.replace(/\.png$/, ""), bytes);
      project.frameOrder.push(id);
    }
    return id;
  };
  for (const state of PET_STATES) {
    if (state === "sleep") continue;
    const files = animation.states[state] ?? [];
    const entries = project.states[state].frames;
    for (const file of files) {
      const id = await loadTemplateFile(file);
      const last = entries[entries.length - 1];
      if (last?.id === id) last.duration = spanDuration(frameSpan(last, project.fps) + 1, project.fps);
      else entries.push({ id });
    }
    project.states[state].enabled = files.length > 0;
    project.states[state].tracks = [{ id: "main", name: "", frames: entries }];
  }

  const z = await Promise.all(SLEEP_Z_FILES.map(loadTemplateFile));
  const baseId = await loadTemplateFile("sleep-base-01.png");
  const base = { id: baseId, duration: spanDuration(4, project.fps) };
  project.states.sleep = {
    enabled: true,
    fps: project.fps,
    loop: true,
    frames: [base],
    sleepAfterMinutes: 15,
    tracks: [
      { id: "sleep-effects", name: "", frames: z.map((id) => ({ id })) },
      { id: "sleep-base", name: "", frames: [base] },
    ],
  };
  return project;
}

/** An effect's pictures, ready to add to a row. */
export async function builtInEffectFrames(effect: BuiltInEffect) {
  return Promise.all(BUILT_IN_EFFECTS[effect].map(async (file) => {
    const image = await fetch(assetUrl(`${FRAMES_DIR}/${file}`));
    if (!image.ok) throw new Error(`missing ${file}`);
    const id = file.replace(/\.png$/, "").replace(/-/g, "");
    const bytes = new Uint8Array(await image.arrayBuffer());
    return { asset: await assetFromBytes(id, file.replace(/\.png$/, ""), bytes) };
  }));
}

async function contentKey(bytes: Uint8Array): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
  return Array.from(hash, (b) => b.toString(16).padStart(2, "0")).join("");
}

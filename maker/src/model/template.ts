import { assetFromBytes, decodeProject } from "./projectFile";
import { newId, type Project } from "./types";

export const assetUrl = (path: string) => `${import.meta.env.BASE_URL}assets/${path}`;

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

const TEMPLATE_URL = assetUrl("templates/ren.typepalproj");

/** The ready-made pet to start from: a saved project, taken as a new one
 *  under `name`. */
export async function templateProject(name: string): Promise<Project> {
  const response = await fetch(TEMPLATE_URL);
  if (!response.ok) throw new Error("missing template");
  const project = await decodeProject(new Uint8Array(await response.arrayBuffer()));
  return { ...project, name, id: newId() };
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

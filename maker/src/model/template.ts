import { assetFromBytes } from "./projectFile";
import { emptyProject, frameSpan, PET_STATES, spanDuration, type PetState, type Project } from "./types";

/** The built-in TypePal mascot. Its frames are ready to play as they are:
 *  `animation.json` gives the canvas, the frame rate and each reaction's
 *  frames in order. */
export const assetUrl = (path: string) => `${import.meta.env.BASE_URL}assets/${path}`;
export const HERO_URL = assetUrl("typepal-hero.png");

const FRAMES_DIR = "typepal-frames";

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
  for (const state of PET_STATES) {
    const files = animation.states[state] ?? [];
    const entries = project.states[state].frames;
    for (const file of files) {
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
      const last = entries[entries.length - 1];
      if (last?.id === id) last.duration = spanDuration(frameSpan(last, project.fps) + 1, project.fps);
      else entries.push({ id });
    }
    project.states[state].enabled = files.length > 0;
  }
  return project;
}

async function contentKey(bytes: Uint8Array): Promise<string> {
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes as BufferSource));
  return Array.from(hash, (b) => b.toString(16).padStart(2, "0")).join("");
}

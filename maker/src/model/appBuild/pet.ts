import { strFromU8, strToU8, unzipSync } from "fflate";

/**
 * The pet's own data, as both systems' pets carry it: `manifest.json` and the
 * frames a playing state uses, scaled as the desktop generator does
 * (`src-tauri/src/generator.rs`). Shared by the Mac (`buildApp.ts`) and
 * Windows (`buildWindows.ts`) builders, which only package it differently.
 */

/** The pet may be shown at up to 2× its designed height, on a Retina screen:
 *  frames are kept no taller than that. */
const MAX_SCALE = 2;
const RETINA = 2;
const STATES = ["idle", "typing", "mouseClick", "tap", "pet", "sleep"] as const;

export interface PetData {
  name: string;
  id: string;
  /** `manifest.json` and `frames/<id>.png`, by path. */
  files: Record<string, Uint8Array>;
  /** The square app icon, as the Maker baked it (1024 px PNG). */
  icon: Uint8Array;
}

/** `projectZip` is a baked project, as the generators receive it. */
export async function readPet(
  projectZip: Uint8Array,
  scale: (png: Uint8Array, maxPx: number) => Promise<Uint8Array>,
): Promise<PetData> {
  const project = unzipSync(projectZip);
  const manifest = JSON.parse(strFromU8(project["manifest.json"])) as {
    name: string;
    id: string;
    display: { height: number };
    frames: Record<string, { file: string }>;
    states: Record<string, {
      enabled: boolean;
      frames: (string | { id: string })[];
      tracks?: { frames: (string | { id: string })[] }[];
      variants?: { tracks: { frames: (string | { id: string })[] }[] }[];
    }>;
  };
  const name = manifest.name.trim();
  if (!name) throw new Error("no-name");
  if (!/^[a-z0-9-]{1,40}$/.test(manifest.id)) throw new Error("bad-id");

  const used = new Set<string>();
  for (const state of STATES) {
    const spec = manifest.states[state];
    if (!spec?.enabled) continue;
    // The reaction's rows and its random actions'.
    const rows = [...(spec.tracks ?? []), ...(spec.variants ?? []).flatMap((variant) => variant.tracks)];
    const entries = [...spec.frames, ...rows.flatMap((track) => track.frames)];
    if (!entries.length) continue;
    for (const entry of entries) used.add(typeof entry === "string" ? entry : entry.id);
  }
  const maxPx = Math.ceil((manifest.display?.height ?? 160) * MAX_SCALE * RETINA);
  const files: Record<string, Uint8Array> = {};
  const frames: Record<string, { file: string }> = {};
  for (const id of used) {
    const source = project[manifest.frames[id]?.file];
    if (!source) throw new Error(`missing frame ${id}`);
    const file = `frames/${id}.png`;
    files[file] = await scale(source, maxPx);
    frames[id] = { file };
  }
  files["manifest.json"] = strToU8(JSON.stringify({ ...manifest, frames }, null, 2));

  const icon = project["icon.png"];
  if (!icon) throw new Error("missing icon");
  return { name, id: manifest.id, files, icon };
}

/** Scales a frame down so its height is at most `maxPx`; never up. */
export async function fitHeight(png: Uint8Array, maxPx: number): Promise<Uint8Array> {
  const image = await createImageBitmap(new Blob([png as BlobPart], { type: "image/png" }));
  try {
    if (image.height <= maxPx) return png;
    const canvas = document.createElement("canvas");
    canvas.height = maxPx;
    canvas.width = Math.max(1, Math.round((image.width * maxPx) / image.height));
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("frame encode failed");
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    image.close();
  }
}

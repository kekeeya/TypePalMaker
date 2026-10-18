import { renderIcon } from "./icon";
import { drawPlaced, placement } from "./placement";
import { assetFromBytes } from "./projectFile";
import { DEFAULT_ICON_STYLE, hasPlacement, PET_STATES, type FrameAsset, type FrameEntry, type PetState, type Project, type StateSpec } from "./types";

/**
 * The project as the pet will show it: every frame drawn into a picture the
 * size of the canvas, with its placement applied. The runtime knows nothing
 * of placement or canvases — it shows pictures — so this is what preview and
 * app generation use. Pictures shared by several frames with the same
 * placement are drawn once.
 */
export async function bakeProject(project: Project): Promise<Project> {
  const { width, height } = project.canvas;
  const surface = document.createElement("canvas");
  surface.width = width;
  surface.height = height;
  const ctx = surface.getContext("2d")!;

  const frames: Record<string, FrameAsset> = {};
  const baked = new Map<string, string>();
  const decoded = new Map<string, ImageBitmap>();
  const states = {} as Record<PetState, StateSpec>;

  try {
    const bakeEntries = async (sourceEntries: FrameEntry[]) => {
      const entries: FrameEntry[] = [];
      for (const entry of sourceEntries) {
        const source = project.frames[entry.id];
        if (!source) continue;
        const p = placement(entry);
        const key = `${entry.id}|${p.dx}|${p.dy}|${p.scale}|${p.rotation}`;
        let id = baked.get(key);
        if (!id) {
          id = `f${baked.size + 1}`;
          baked.set(key, id);
          if (source.width === width && source.height === height && !hasPlacement(entry)) {
            // Already a canvas-sized picture, untouched: kept byte for byte,
            // since redrawing could shift semi-transparent pixels.
            frames[id] = await assetFromBytes(id, source.name, source.png);
          } else {
            let image = decoded.get(entry.id);
            if (!image) {
              image = await createImageBitmap(new Blob([source.png as BlobPart], { type: "image/png" }));
              decoded.set(entry.id, image);
            }
            ctx.clearRect(0, 0, width, height);
            drawPlaced(ctx, image, source, project.canvas, entry);
            frames[id] = await assetFromBytes(id, source.name, await toPng(surface));
          }
        }
        entries.push(entry.duration === undefined ? { id } : { id, duration: entry.duration });
      }
      return entries;
    };

    for (const state of PET_STATES) {
      const spec = project.states[state];
      const entries = await bakeEntries(spec.frames);
      const tracks = spec.tracks
        ? await Promise.all(spec.tracks.map(async (track) => ({ ...track, frames: await bakeEntries(track.frames) })))
        : undefined;
      states[state] = { ...spec, fps: project.fps, frames: entries, tracks };
    }
  } finally {
    for (const image of decoded.values()) image.close();
  }

  // The icon, finished: background, placement and all. Drawn again it would
  // come out the same, so the baked project is still a valid project.
  const icon = await renderIcon(project);
  return { ...project, frames, frameOrder: [...baked.values()], states, icon, iconStyle: { ...DEFAULT_ICON_STYLE } };
}

/** Frees the blob URLs of a baked project once it is no longer shown. */
export function releaseBaked(project: Project) {
  for (const frame of [...Object.values(project.frames), project.icon]) if (frame?.url) URL.revokeObjectURL(frame.url);
}

function toPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? blob.arrayBuffer().then((b) => resolve(new Uint8Array(b)), reject) : reject(new Error("encode failed"))),
      "image/png",
    ),
  );
}

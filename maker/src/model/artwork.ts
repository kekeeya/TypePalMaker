import { drawPlaced, placement } from "./placement";
import type { Canvas, FrameAsset, FrameEntry } from "./types";

/** Rows of the canvas the top is looked for in, at most: plenty to place a
 *  bubble, and quick. */
const PROBE_HEIGHT = 256;
/** Alpha above this counts as artwork, as the pet's own hit test. */
const OPAQUE = 24;

/** Answers kept, the most recent last; a placement nudged step by step
 *  makes one for each step, so only so many are kept. */
const tops = new Map<string, Promise<number | null>>();
const KEPT = 200;
const decoded = new WeakMap<FrameAsset, Promise<ImageBitmap>>();
/** A number for each picture: ids are reused (a baked project's are f1, f2…
 *  every time), pictures are not. */
const pictures = new WeakMap<FrameAsset, number>();
let pictureCount = 0;
function pictureNumber(frame: FrameAsset): number {
  let n = pictures.get(frame);
  if (n === undefined) {
    n = (pictureCount += 1);
    pictures.set(frame, n);
  }
  return n;
}

/** The top of the artwork where `entries` are drawn together, placed, as a
 *  share of the canvas height (0 = the canvas's top), as the pet finds it
 *  for its speech bubble. Null when nothing visible is drawn. Worked out
 *  once for each set of frames and placements. */
export function artworkTop(frames: Record<string, FrameAsset>, entries: FrameEntry[], canvas: Canvas): Promise<number | null> {
  const shown = entries.filter((entry) => frames[entry.id]);
  const key = `${canvas.width}x${canvas.height}|${shown.map((e) => `${pictureNumber(frames[e.id])}:${Object.values(placement(e)).join(",")}`).join("|")}`;
  let top = tops.get(key);
  if (top) {
    tops.delete(key);
  } else {
    // A failure is not kept: the next ask tries again.
    top = measure(frames, shown, canvas).catch(() => {
      tops.delete(key);
      return null;
    });
  }
  tops.set(key, top);
  if (tops.size > KEPT) tops.delete(tops.keys().next().value!);
  return top;
}

async function measure(frames: Record<string, FrameAsset>, entries: FrameEntry[], canvas: Canvas): Promise<number | null> {
  if (!entries.length) return null;
  const k = Math.min(1, PROBE_HEIGHT / canvas.height);
  const w = Math.max(1, Math.round(canvas.width * k));
  const h = Math.max(1, Math.round(canvas.height * k));
  const surface = document.createElement("canvas");
  surface.width = w;
  surface.height = h;
  const ctx = surface.getContext("2d", { willReadFrequently: true })!;
  ctx.scale(k, k);
  for (const entry of entries) {
    const frame = frames[entry.id];
    drawPlaced(ctx, await bitmap(frame), frame, canvas, entry);
  }
  const alpha = ctx.getImageData(0, 0, w, h).data;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) if (alpha[(y * w + x) * 4 + 3] > OPAQUE) return y / h;
  }
  return null;
}

function bitmap(frame: FrameAsset): Promise<ImageBitmap> {
  let image = decoded.get(frame);
  if (!image) {
    image = createImageBitmap(new Blob([frame.png as BlobPart], { type: "image/png" }));
    decoded.set(frame, image);
  }
  return image;
}

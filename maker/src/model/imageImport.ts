import { decompressFrames, parseGIF } from "gifuct-js";
import { assetFromBytes } from "./projectFile";
import { newId, type FrameAsset } from "./types";

/** Files larger than this are not taken at all: a pet's picture is tens of
 *  kilobytes, so anything this big is a camera original or a wrong pick. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
/** GIF import works (each GIF frame becomes a frame) but is switched off
 *  until it has been tried properly: GIFs have no partial transparency, so
 *  edges come out jagged. While off, GIFs are refused like other files. */
const GIF_ENABLED = false;
/** What the upload pickers offer: MIME types for the web's file input,
 *  file extensions for the desktop's own dialog. */
export const IMAGE_ACCEPT = GIF_ENABLED ? "image/png,image/jpeg,image/webp,image/gif" : "image/png,image/jpeg,image/webp";
export const IMAGE_EXTENSIONS = GIF_ENABLED ? ["png", "jpg", "jpeg", "webp", "gif"] : ["png", "jpg", "jpeg", "webp"];
/** No upload is kept larger than this on its longer side. */
const MAX_IMPORT_PX = 2048;

/** How large an upload is kept for a canvas: twice the canvas, so it can
 *  still be zoomed in the 画面 panel without blurring, and never above
 *  `MAX_IMPORT_PX`. */
export function importSideFor(canvas: { width: number; height: number }): number {
  return Math.min(MAX_IMPORT_PX, 2 * Math.max(canvas.width, canvas.height));
}

export interface ImportResult {
  frames: ImportedFrame[];
  /** Names of the files skipped for being over `MAX_UPLOAD_BYTES`. */
  tooLarge: string[];
  /** Names of the files skipped for not being a supported image. */
  unsupported: string[];
}

export interface ImportedFrame {
  asset: FrameAsset;
  /** From a GIF's own timing, in ms. */
  duration?: number;
}

/** Turns dropped or chosen files into frames, in order. Every image is
 *  normalised to PNG and scaled down to `maxSide` on its longer side (a GIF,
 *  when enabled, becomes one frame per GIF frame). Unsupported files and
 *  files over `MAX_UPLOAD_BYTES` are reported, not taken. */
export async function importFiles(files: File[], maxSide = MAX_IMPORT_PX): Promise<ImportResult> {
  const out: ImportedFrame[] = [];
  const tooLarge: string[] = [];
  const unsupported: string[] = [];
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  for (const file of sorted) {
    if (file.size > MAX_UPLOAD_BYTES) {
      tooLarge.push(file.name);
      continue;
    }
    const base = file.name.replace(/\.[^.]+$/, "");
    try {
      const isGif = file.type === "image/gif" || /\.gif$/i.test(file.name);
      if (isGif && GIF_ENABLED) {
        out.push(...(await importGif(file, base, maxSide)));
      } else if (isGif || !(/^image\/(png|jpeg|webp)$/.test(file.type) || /\.(png|jpe?g|webp)$/i.test(file.name))) {
        unsupported.push(file.name);
      } else {
        const bitmap = await createImageBitmap(file);
        const png = await toPng(bitmap, bitmap.width, bitmap.height, maxSide);
        bitmap.close();
        out.push({ asset: await assetFromBytes(newId(), base, png) });
      }
    } catch (error) {
      console.warn(`skipped ${file.name}`, error);
    }
  }
  return { frames: out, tooLarge, unsupported };
}

/** GIF frames are patches over the previous picture; they are composited
 *  here, honouring each frame's disposal, into full standalone images. */
async function importGif(file: File, base: string, maxSide: number): Promise<ImportedFrame[]> {
  const gif = parseGIF(await file.arrayBuffer());
  const frames = decompressFrames(gif, true);
  const width = gif.lsd.width;
  const height = gif.lsd.height;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  const patch = document.createElement("canvas");
  const patchCtx = patch.getContext("2d")!;

  const out: ImportedFrame[] = [];
  for (const [index, frame] of frames.entries()) {
    const { dims } = frame;
    const before = frame.disposalType === 3 ? ctx.getImageData(0, 0, width, height) : null;

    patch.width = dims.width;
    patch.height = dims.height;
    const data = new ImageData(new Uint8ClampedArray(frame.patch), dims.width, dims.height);
    patchCtx.putImageData(data, 0, 0);
    ctx.drawImage(patch, dims.left, dims.top);

    const png = await toPng(canvas, width, height, maxSide);
    out.push({
      asset: await assetFromBytes(newId(), `${base} #${index + 1}`, png),
      // GIF delays are in hundredths of a second; 0 means "as fast as possible".
      duration: frame.delay > 0 ? frame.delay * 10 : undefined,
    });

    if (frame.disposalType === 2) ctx.clearRect(dims.left, dims.top, dims.width, dims.height);
    else if (before) ctx.putImageData(before, 0, 0);
  }
  return out;
}

async function toPng(source: CanvasImageSource, width: number, height: number, maxSide: number): Promise<Uint8Array> {
  const scale = Math.min(1, maxSide / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode failed"))), "image/png"),
  );
  return new Uint8Array(await blob.arrayBuffer());
}

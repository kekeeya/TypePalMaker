import type { Canvas, FrameAsset, FrameEntry } from "./types";

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Where a picture sits on the canvas before any adjustment: as large as
 *  fits, standing on the bottom edge, centred — as the runtime's
 *  `SpriteLayout` places frames, so feet never jump between frames. */
export function fitRect(frame: Pick<FrameAsset, "width" | "height">, box: { width: number; height: number }): Rect {
  if (!(frame.width > 0 && frame.height > 0)) return { left: 0, top: 0, width: box.width, height: box.height };
  const scale = Math.min(box.width / frame.width, box.height / frame.height);
  const width = frame.width * scale;
  const height = frame.height * scale;
  return { left: (box.width - width) / 2, top: box.height - height, width, height };
}

/** The adjustment on top of `fitRect`, in canvas pixels. It pivots on the
 *  picture's bottom centre, so scaling keeps it standing where it was. */
export function placement(entry?: FrameEntry) {
  return {
    dx: entry?.offsetX ?? 0,
    dy: entry?.offsetY ?? 0,
    scale: entry?.scale ?? 1,
    rotation: entry?.rotation ?? 0,
  };
}

/** Draws one frame onto a canvas-sized 2D context exactly as the editor
 *  shows it. */
export function drawPlaced(
  ctx: CanvasRenderingContext2D,
  image: CanvasImageSource,
  frame: Pick<FrameAsset, "width" | "height">,
  canvas: Pick<Canvas, "width" | "height">,
  entry?: FrameEntry,
) {
  const r = fitRect(frame, canvas);
  const p = placement(entry);
  ctx.save();
  ctx.translate(r.left + r.width / 2 + p.dx, r.top + r.height + p.dy);
  ctx.scale(p.scale, p.scale);
  ctx.rotate((p.rotation * Math.PI) / 180);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, -r.width / 2, -r.height, r.width, r.height);
  ctx.restore();
}

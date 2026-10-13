import type { FrameAsset } from "./types";

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The smallest box around everything visible. */
export function opaqueBounds({ data, width, height }: ImageData): Box | null {
  let left = width;
  let top = height;
  let right = -1;
  let bottom = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] <= 8) continue;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  return right < 0 ? null : { left, top, width: right - left + 1, height: bottom - top + 1 };
}

/** What a picture actually draws, ignoring its transparent margin; worked
 *  out once per picture. Only for still pictures (card, icon) — frames that
 *  play keep their whole canvas. */
const cache = new WeakMap<FrameAsset, Promise<Box | null>>();
export function assetBounds(asset: FrameAsset): Promise<Box | null> {
  let found = cache.get(asset);
  if (!found) {
    found = (async () => {
      const image = await createImageBitmap(new Blob([asset.png as BlobPart], { type: "image/png" }));
      const surface = document.createElement("canvas");
      surface.width = image.width;
      surface.height = image.height;
      const ctx = surface.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(image, 0, 0);
      image.close();
      return opaqueBounds(ctx.getImageData(0, 0, surface.width, surface.height));
    })();
    cache.set(asset, found);
  }
  return found;
}

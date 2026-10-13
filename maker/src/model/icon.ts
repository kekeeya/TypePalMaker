import { assetBounds, type Box } from "./bounds";
import { assetFromBytes } from "./projectFile";
import { DEFAULT_ICON_STYLE, type FrameAsset, type Project } from "./types";

/** The icon's side in icon pixels: the unit of `IconStyle` offsets. */
export const ICON_SIDE = 512;
/** Space left around a cropped picture: 5 px on the 82 px icon of the
 *  通用 page, the same share at every size. */
const CROP_MARGIN = (ICON_SIDE * 5) / 82;
/** Rendered size of the generated icon; the generator makes smaller ones. */
const OUTPUT_SIDE = 1024;

/** The picture the icon shows: the uploaded one, or the first idle frame. */
export function iconSource(project: Project): FrameAsset | undefined {
  return project.icon ?? project.frames[project.states.idle.frames[0]?.id ?? ""];
}

/** The part of the picture the icon frames: an uploaded picture whole; the
 *  first idle frame without its transparent margin, as on the home card. */
export async function iconCrop(project: Project): Promise<Box | null> {
  const source = iconSource(project);
  return source && !project.icon ? assetBounds(source) : null;
}

/** Where the whole picture sits before adjustment, so that `crop` (or the
 *  whole picture) is as large as fits and centred. Placement then pivots on
 *  the icon's centre. */
export function iconRect(source: Pick<FrameAsset, "width" | "height">, crop?: Box | null) {
  const area = crop ?? { left: 0, top: 0, width: source.width, height: source.height };
  // A cropped picture would touch the edges; it keeps a margin instead.
  const room = crop ? ICON_SIDE - 2 * CROP_MARGIN : ICON_SIDE;
  const k = Math.min(room / area.width, room / area.height);
  return {
    left: ICON_SIDE / 2 - (area.left + area.width / 2) * k,
    top: ICON_SIDE / 2 - (area.top + area.height / 2) * k,
    width: source.width * k,
    height: source.height * k,
    /** The framed part's size on the icon. */
    shown: { width: area.width * k, height: area.height * k },
  };
}

/** The finished icon as a square PNG: background, then the placed picture. */
export async function renderIcon(project: Project): Promise<FrameAsset> {
  const style = project.iconStyle ?? DEFAULT_ICON_STYLE;
  const surface = document.createElement("canvas");
  surface.width = surface.height = OUTPUT_SIDE;
  const ctx = surface.getContext("2d")!;
  ctx.fillStyle = style.background;
  ctx.fillRect(0, 0, OUTPUT_SIDE, OUTPUT_SIDE);

  const source = iconSource(project);
  if (source) {
    const image = await createImageBitmap(new Blob([source.png as BlobPart], { type: "image/png" }));
    const r = iconRect(source, await iconCrop(project));
    const half = ICON_SIDE / 2;
    ctx.save();
    ctx.scale(OUTPUT_SIDE / ICON_SIDE, OUTPUT_SIDE / ICON_SIDE);
    ctx.translate(half + style.offsetX, half + style.offsetY);
    ctx.scale(style.scale, style.scale);
    ctx.rotate((style.rotation * Math.PI) / 180);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, r.left - half, r.top - half, r.width, r.height);
    ctx.restore();
    image.close();
  }
  const blob = await new Promise<Blob | null>((resolve) => surface.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("icon encode failed");
  return assetFromBytes("icon", "icon", new Uint8Array(await blob.arrayBuffer()));
}

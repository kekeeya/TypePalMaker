import { assetBounds, type Box } from "./bounds";
import { drawPlaced } from "./placement";
import { assetFromBytes } from "./projectFile";
import { entryAtCell } from "./timeline";
import { DEFAULT_ICON_STYLE, hasPlacement, timelineTracks, type FrameAsset, type FrameEntry, type Project } from "./types";

/** The icon's side in icon pixels: the unit of `IconStyle` offsets. */
export const ICON_SIDE = 512;
/** Space left around a cropped picture: 5 px on the 82 px icon of the
 *  通用 page, the same share at every size. */
const CROP_MARGIN = (ICON_SIDE * 5) / 82;
/** Rendered size of the generated icon; the generator makes smaller ones. */
const OUTPUT_SIDE = 1024;

/** Names the picture `idleCover` draws, which holds a blob URL of its own. */
export const IDLE_COVER_ID = "idle-cover";

/** Idle as the pet first shows it: every row's first picture on the canvas,
 *  placed, the first row drawn over the others. A lone picture left where
 *  it is needs no drawing and is used as it is. */
export async function idleCover(project: Project): Promise<FrameAsset | undefined> {
  const entries = timelineTracks(project.states.idle)
    .map((track) => entryAtCell(track, project.fps, 0)?.entry)
    .filter((entry): entry is FrameEntry => !!entry && !!project.frames[entry.id]);
  if (!entries.length) return undefined;
  if (entries.length === 1 && !hasPlacement(entries[0])) return project.frames[entries[0].id];

  const surface = document.createElement("canvas");
  surface.width = project.canvas.width;
  surface.height = project.canvas.height;
  const ctx = surface.getContext("2d")!;
  for (const entry of [...entries].reverse()) {
    const frame = project.frames[entry.id];
    const image = await createImageBitmap(new Blob([frame.png as BlobPart], { type: "image/png" }));
    drawPlaced(ctx, image, frame, project.canvas, entry);
    image.close();
  }
  return assetFromBytes(IDLE_COVER_ID, "idle", await toPng(surface));
}

/** The picture the icon shows: the uploaded one, or idle as it first appears. */
export async function iconSource(project: Project): Promise<FrameAsset | undefined> {
  return project.icon ?? idleCover(project);
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

  const source = await iconSource(project);
  if (source) {
    const image = await createImageBitmap(new Blob([source.png as BlobPart], { type: "image/png" }));
    // An uploaded picture is framed whole; idle without its transparent
    // margin, as on the home card.
    const r = iconRect(source, project.icon ? null : await assetBounds(source));
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
    if (source.id === IDLE_COVER_ID) URL.revokeObjectURL(source.url);
  }
  return assetFromBytes("icon", "icon", await toPng(surface));
}

async function toPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("icon encode failed");
  return new Uint8Array(await blob.arrayBuffer());
}

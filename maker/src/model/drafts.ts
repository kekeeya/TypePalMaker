import type { Platform } from "../platform";
import { opaqueBounds } from "./bounds";
import { withDraftList } from "./editLock";
import { drawPlaced } from "./placement";
import { decodeProject, encodeProject } from "./projectFile";
import type { Project } from "./types";

/**
 * Projects kept inside the Maker as they are edited, for "最近创作" on the
 * home page. Each is stored whole, with a small picture for its card and an
 * entry in one index, newest first.
 */

export interface DraftInfo {
  id: string;
  name: string;
  updatedAt: number;
}

const INDEX = "index";
const THUMB_PX = 240;

const projectKey = (id: string) => `project-${id}`;
const thumbKey = (id: string) => `thumb-${id}`;

export async function listDrafts(platform: Platform): Promise<DraftInfo[]> {
  const raw = await platform.storeGet(INDEX).catch(() => null);
  if (!raw) return [];
  try {
    const list = JSON.parse(new TextDecoder().decode(raw)) as DraftInfo[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export async function saveDraft(platform: Platform, project: Project): Promise<void> {
  await platform.storeSet(projectKey(project.id), encodeProject(project));
  const thumb = await thumbnail(project);
  if (thumb) await platform.storeSet(thumbKey(project.id), thumb);
  await withDraftList(async () => {
    const others = (await listDrafts(platform)).filter((d) => d.id !== project.id);
    // Every project stays listed: the list is the only way back to a project,
    // so it is never trimmed (the home page scrolls instead).
    const list = [{ id: project.id, name: project.name, updatedAt: Date.now() }, ...others];
    await platform.storeSet(INDEX, new TextEncoder().encode(JSON.stringify(list)));
  });
}

export async function deleteDraft(platform: Platform, id: string): Promise<void> {
  await withDraftList(async () => {
    const list = (await listDrafts(platform)).filter((d) => d.id !== id);
    await platform.storeSet(INDEX, new TextEncoder().encode(JSON.stringify(list)));
  });
  await platform.storeDelete(projectKey(id));
  await platform.storeDelete(thumbKey(id));
}

export async function loadDraft(platform: Platform, id: string): Promise<Project | null> {
  const bytes = await platform.storeGet(projectKey(id));
  return bytes ? decodeProject(bytes) : null;
}

/** A blob URL for the draft's card picture, or null if it has none. */
export async function draftThumbUrl(platform: Platform, id: string): Promise<string | null> {
  const bytes = await platform.storeGet(thumbKey(id)).catch(() => null);
  return bytes ? URL.createObjectURL(new Blob([bytes as BlobPart], { type: "image/png" })) : null;
}

/** The first idle frame as placed on the canvas, trimmed to what is drawn,
 *  small. Trimming is fine here — and only here — because the card shows
 *  one still picture; anything that plays frames keeps the whole canvas. */
async function thumbnail(project: Project): Promise<Uint8Array | null> {
  const entry = project.states.idle.frames[0];
  const frame = entry && project.frames[entry.id];
  if (!frame) return null;
  const { width, height } = project.canvas;
  const full = document.createElement("canvas");
  full.width = width;
  full.height = height;
  const ctx = full.getContext("2d", { willReadFrequently: true })!;
  const image = await createImageBitmap(new Blob([frame.png as BlobPart], { type: "image/png" }));
  drawPlaced(ctx, image, frame, project.canvas, entry);
  image.close();

  const box = opaqueBounds(ctx.getImageData(0, 0, width, height));
  if (!box) return null;
  const k = Math.min(1, THUMB_PX / Math.max(box.width, box.height));
  const small = document.createElement("canvas");
  small.width = Math.max(1, Math.round(box.width * k));
  small.height = Math.max(1, Math.round(box.height * k));
  const out = small.getContext("2d")!;
  out.imageSmoothingQuality = "high";
  out.drawImage(full, box.left, box.top, box.width, box.height, 0, 0, small.width, small.height);
  const blob = await new Promise<Blob | null>((resolve) => small.toBlob(resolve, "image/png"));
  return blob ? new Uint8Array(await blob.arrayBuffer()) : null;
}

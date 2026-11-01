import { delaySpan, frameSpan, spanDelay, timelineTracks, type FrameEntry, type FrameTrack, type StateSpec } from "./types";

export function trackCells(track: FrameTrack, fps: number): number {
  return track.frames.reduce((sum, entry) => sum + delaySpan(entry, fps) + frameSpan(entry, fps), 0);
}

export function stateCells(spec: StateSpec): number {
  return Math.max(0, ...timelineTracks(spec).map((track) => trackCells(track, spec.fps)));
}

export function entryAtCell(track: FrameTrack, fps: number, cell: number): { entry: FrameEntry; index: number } | null {
  let cursor = 0;
  for (let index = 0; index < track.frames.length; index += 1) {
    cursor += delaySpan(track.frames[index], fps);
    // A gap before the frame: the row shows nothing.
    if (cell < cursor) return null;
    cursor += frameSpan(track.frames[index], fps);
    if (cell < cursor) return { entry: track.frames[index], index };
  }
  return null;
}

/** The cell an entry starts at, after any gap before it. */
export function entryStartCell(track: FrameTrack, fps: number, index: number): number {
  return trackCells({ ...track, frames: track.frames.slice(0, index) }, fps) + (track.frames[index] ? delaySpan(track.frames[index], fps) : 0);
}

/** The entries with the frame at `index` moved to start at `cell`, the rest
 *  where they were, the gaps between them made up again. */
export function placeEntry(frames: FrameEntry[], fps: number, index: number, cell: number): { frames: FrameEntry[]; index: number } {
  const track = { id: "", name: "", frames };
  const placed = frames.map((entry, i) => ({ entry, start: i === index ? cell : entryStartCell(track, fps, i) }));
  const moved = placed[index];
  placed.sort((a, b) => a.start - b.start || (a === moved ? -1 : b === moved ? 1 : 0));
  let end = 0;
  const out = placed.map(({ entry, start }) => {
    const { delay: _, ...rest } = entry;
    const gap = Math.max(0, start - end);
    end = Math.max(end, start) + frameSpan(entry, fps);
    const delay = spanDelay(gap, fps);
    return delay === undefined ? rest : { ...rest, delay };
  });
  return { frames: out, index: placed.indexOf(moved) };
}

/** The entries without the one at `index`. What follows closes up, or, with
 *  `keepPlace` (any row but the pet's own), stays where it was, the frame's
 *  place left empty. The gap before the frame stays either way. */
export function withoutEntry(frames: FrameEntry[], index: number, keepPlace: boolean, fps: number): FrameEntry[] {
  const removed = frames[index];
  return frames.flatMap((entry, i) => {
    if (i === index) return [];
    if (i !== index + 1) return [entry];
    const gap = delaySpan(removed, fps) + (keepPlace ? frameSpan(removed, fps) : 0);
    return [gap ? { ...entry, delay: spanDelay(delaySpan(entry, fps) + gap, fps) } : entry];
  });
}

/** The entries with `entry` dropped at `cell`. A row that plays frame after
 *  frame (`free` false, the pet's own) takes it before or after the frame
 *  at that cell, whichever half the cell is in, or last; any other row takes it right there, or, when that is
 *  taken, last if `orLast` (it came from another row) and not at all if
 *  not (null). */
export function dropEntry(
  frames: FrameEntry[],
  entry: FrameEntry,
  cell: number,
  free: boolean,
  orLast: boolean,
  fps: number,
): { frames: FrameEntry[]; index: number } | null {
  const { delay: _, ...plain } = entry;
  const row = { id: "", name: "", frames };
  if (!free) {
    const at = frames.findIndex((f, i) => cell < entryStartCell(row, fps, i) + frameSpan(f, fps) / 2);
    const index = at < 0 ? frames.length : at;
    return { frames: [...frames.slice(0, index), plain, ...frames.slice(index)], index };
  }
  const span = frameSpan(plain, fps);
  const clear = cell >= 0 && frames.every((f, i) => {
    const start = entryStartCell(row, fps, i);
    return cell + span <= start || cell >= start + frameSpan(f, fps);
  });
  if (clear) return placeEntry([...frames, plain], fps, frames.length, cell);
  return orLast ? { frames: [...frames, plain], index: frames.length } : null;
}

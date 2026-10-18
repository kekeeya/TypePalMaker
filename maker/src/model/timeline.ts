import { frameSpan, timelineTracks, type FrameEntry, type FrameTrack, type StateSpec } from "./types";

export function trackCells(track: FrameTrack, fps: number): number {
  return track.frames.reduce((sum, entry) => sum + frameSpan(entry, fps), 0);
}

export function stateCells(spec: StateSpec): number {
  return Math.max(0, ...timelineTracks(spec).map((track) => trackCells(track, spec.fps)));
}

export function entryAtCell(track: FrameTrack, fps: number, cell: number): { entry: FrameEntry; index: number } | null {
  let cursor = 0;
  for (let index = 0; index < track.frames.length; index += 1) {
    cursor += frameSpan(track.frames[index], fps);
    if (cell < cursor) return { entry: track.frames[index], index };
  }
  return null;
}

export function entryStartCell(track: FrameTrack, fps: number, index: number): number {
  return track.frames.slice(0, index).reduce((sum, entry) => sum + frameSpan(entry, fps), 0);
}

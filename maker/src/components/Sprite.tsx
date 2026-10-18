import { useEffect, useRef, useState, type CSSProperties } from "react";
import { fitRect, placement } from "../model/placement";
import type { Canvas, FrameAsset, FrameEntry, StateSpec } from "../model/types";
import { stateCells } from "../model/timeline";

/**
 * One frame drawn on the canvas as the pet will show it: fitted, then
 * placed (see `model/placement.ts`, which bakes it the same way). `ratio` is
 * screen pixels per canvas pixel.
 */
export function FrameImage({
  frame,
  canvas,
  ratio,
  entry,
  style,
}: {
  frame: FrameAsset;
  canvas: Pick<Canvas, "width" | "height">;
  ratio: number;
  entry?: FrameEntry;
  style?: CSSProperties;
}) {
  const r = fitRect(frame, canvas);
  const p = placement(entry);
  return (
    <img
      src={frame.url}
      alt=""
      draggable={false}
      style={{
        position: "absolute",
        left: r.left * ratio,
        top: r.top * ratio,
        width: r.width * ratio,
        height: r.height * ratio,
        transform: `translate(${p.dx * ratio}px, ${p.dy * ratio}px) scale(${p.scale}) rotate(${p.rotation}deg)`,
        transformOrigin: "center bottom",
        ...style,
      }}
    />
  );
}

/**
 * Every frame of a sequence, mounted up front and all decoded, with only
 * `shown` visible — so changing frame or state never waits on an image and
 * never flashes empty. All frames share one destination rectangle.
 */
export function FrameStack({
  frames,
  entries,
  shown,
  canvas,
  ratio,
  style,
}: {
  frames: Record<string, FrameAsset>;
  entries: FrameEntry[];
  shown: number;
  canvas: Pick<Canvas, "width" | "height">;
  ratio: number;
  style?: CSSProperties;
}) {
  return (
    <>
      {entries.map((entry, i) => {
        const frame = frames[entry.id];
        return (
          frame && (
            <FrameImage
              key={`${i}-${entry.id}`}
              frame={frame}
              canvas={canvas}
              ratio={ratio}
              entry={entry}
              style={{ ...style, visibility: i === shown ? "visible" : "hidden" }}
            />
          )
        );
      })}
    </>
  );
}

/** A shared-cell player for composited tracks. */
export function useTimelinePlayer(
  spec: StateSpec | null,
  { playing = true, restartKey = 0, onFinished }: { playing?: boolean; restartKey?: unknown; onFinished?: () => void } = {},
): number {
  const [at, setAt] = useState({ spec, restartKey, cell: 0 });
  const finished = useRef(onFinished);
  finished.current = onFinished;
  let cell = at.cell;
  if (at.spec !== spec || at.restartKey !== restartKey) {
    cell = 0;
    setAt({ spec, restartKey, cell: 0 });
  }
  useEffect(() => {
    if (!spec || !playing) return;
    const cells = stateCells(spec);
    if (cells <= 1 && spec.loop) return;
    const timer = window.setTimeout(() => {
      if (cell < cells - 1) setAt({ spec, restartKey, cell: cell + 1 });
      else if (spec.loop) setAt({ spec, restartKey, cell: 0 });
      else finished.current?.();
    }, Math.max(1000 / spec.fps, 1000 / 60));
    return () => window.clearTimeout(timer);
  }, [spec, cell, playing, restartKey]);
  return spec ? Math.min(cell, Math.max(stateCells(spec) - 1, 0)) : 0;
}


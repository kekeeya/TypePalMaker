import { useEffect, useRef, useState, type CSSProperties } from "react";
import { fitRect, placement } from "../model/placement";
import { durations, type Canvas, type FrameAsset, type FrameEntry, type StateSpec } from "../model/types";

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
}: {
  frames: Record<string, FrameAsset>;
  entries: FrameEntry[];
  shown: number;
  canvas: Pick<Canvas, "width" | "height">;
  ratio: number;
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
              style={{ visibility: i === shown ? "visible" : "hidden" }}
            />
          )
        );
      })}
    </>
  );
}

/**
 * Steps through a state's frames with each frame's own duration, like the
 * runtime's `SpriteAnimator`. A new state (or `restartKey`) starts on its
 * first frame in the very same render. A one-shot holds its last frame and
 * reports back.
 */
export function useFramePlayer(
  spec: StateSpec | null,
  { playing = true, restartKey = 0, onFinished }: { playing?: boolean; restartKey?: unknown; onFinished?: () => void } = {},
): number {
  const [at, setAt] = useState({ spec, restartKey, index: 0 });
  const finished = useRef(onFinished);
  finished.current = onFinished;

  // Reset during render, not in an effect, so the old index is never shown
  // against the new state's frames.
  let index = at.index;
  if (at.spec !== spec || at.restartKey !== restartKey) {
    index = 0;
    setAt({ spec, restartKey, index: 0 });
  }

  useEffect(() => {
    if (!spec || !playing || spec.frames.length === 0) return;
    if (spec.frames.length === 1 && spec.loop) return;
    const i = Math.min(index, spec.frames.length - 1);
    const delay = Math.max(durations(spec)[i] * 1000, 1000 / 60);
    const timer = window.setTimeout(() => {
      if (i < spec.frames.length - 1) setAt({ spec, restartKey, index: i + 1 });
      else if (spec.loop) setAt({ spec, restartKey, index: 0 });
      else finished.current?.();
    }, delay);
    return () => window.clearTimeout(timer);
  }, [spec, index, playing, restartKey]);

  return spec ? Math.min(index, Math.max(spec.frames.length - 1, 0)) : 0;
}

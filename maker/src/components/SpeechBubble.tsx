import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import { artworkTop } from "../model/artwork";
import { DEFAULT_SPEECH, type Canvas, type FrameAsset, type FrameEntry, type SpeechStyle } from "../model/types";

/** The bubble's fixed parts, in points, as the pets draw it
 *  (`SpeechBubble.swift`, `ui/bubble.rs`): clear space around it, the
 *  tail's height and lean, and how far into the head it points. */
const MARGIN = 12;
const TAIL = 8;
const LEAN = 14;
const INTO_HEAD = 4;

/** The bubble's sizes at a text size and roominess, in points. */
export function bubbleMetrics(style: SpeechStyle) {
  const room = style.bubbleSize;
  const radius = 14 * room;
  return {
    padding: { x: Math.round(14 * room), y: Math.round(9 * room) },
    radius,
    maxText: Math.round((200 * style.fontSize) / 13),
    line: Math.round((18 * style.fontSize) / 13),
    minBody: Math.max(76, radius * 2 + 28),
  };
}

/** Behind a pet shown with its bubble: the page's cream, or, when the
 *  bubble would hardly show on it, the first of a light blue-grey, a mid
 *  grey and a dark one that it stands out from. */
const BACKDROPS = ["#fefaf1", "#dfe5ee", "#b8bdc8", "#3a3c52"];
/** How different (CIE76 ΔE) a bubble must look from what is behind it: warm
 *  whites are not, pastels are. */
const STANDS_OUT = 8;

export function backdropFor(bubbleColor: string): string {
  const apart = (c: string) => colorDistance(c, bubbleColor);
  return BACKDROPS.find((c) => apart(c) >= STANDS_OUT) ?? BACKDROPS.reduce((best, c) => (apart(c) > apart(best) ? c : best));
}

/** How different two `#rrggbb` colours look: ΔE between their CIELAB values. */
export function colorDistance(a: string, b: string): number {
  const [p, q] = [lab(a), lab(b)];
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
}

function lab(hex: string): [number, number, number] {
  const linear = (i: number) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = [linear(1), linear(3), linear(5)];
  // sRGB to XYZ (D65), each against white, then to CIELAB.
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const x = f((r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047);
  const y = f(r * 0.2126 + g * 0.7152 + b * 0.0722);
  const z = f((r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}

/** The top of the artwork showing (a share of the canvas height), once
 *  known; until then, and with nothing showing, the canvas's top. */
export function useArtworkTop(frames: Record<string, FrameAsset>, entries: FrameEntry[], canvas: Canvas): number {
  const [top, setTop] = useState(0);
  const key = entries.map((e) => `${e.id}:${e.scale ?? 1}:${e.offsetX ?? 0}:${e.offsetY ?? 0}:${e.rotation ?? 0}`).join("|");
  useEffect(() => {
    let alive = true;
    void artworkTop(frames, entries, canvas).then((found) => alive && setTop(found ?? 0));
    return () => {
      alive = false;
    };
    // The frames shown and how they are placed, not the array's identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, frames, canvas.width, canvas.height]);
  return top;
}

/**
 * A line in the pet's bubble, as the desktop shows it, over a pet drawn
 * `box` wide and high (pixels) inside the parent: centred over the head
 * (`top`, a share of the height), moved by the style's offset, the tail
 * pointing at the head. `pt` is pixels per point of the pet on the desktop,
 * so the bubble keeps its size against the pet. It rises in when it mounts
 * (give each line its own `key`). With `onMove`, it can be dragged; the
 * change in canvas pixels is reported as it goes.
 */
export function SpeechBubble({
  line,
  style = DEFAULT_SPEECH,
  box,
  top,
  canvas,
  pt,
  onMove,
  minTop,
}: {
  line: string;
  style?: SpeechStyle;
  box: { left: number; top: number; width: number; height: number };
  top: number;
  canvas: Canvas;
  pt: number;
  onMove?: (dx: number, dy: number, done: boolean) => void;
  /** Kept from rising above this (pixels in the parent), as the desktop
   *  keeps it on the screen. */
  minTop?: number;
}) {
  const m = bubbleMetrics(style);
  const px = box.height / canvas.height;
  const head = { x: box.left + box.width / 2, y: box.top + top * box.height + INTO_HEAD * pt };
  const spot = { x: head.x + style.offsetX * px, y: head.y + style.offsetY * px };
  const body = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const { width } = size;
  useLayoutEffect(() => {
    const el = body.current;
    if (!el) return;
    const measure = () => setSize((s) => (s.width === el.offsetWidth && s.height === el.offsetHeight ? s : { width: el.offsetWidth, height: el.offsetHeight }));
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // The tail leaves the flat of the edge as near the head as it can and
  // leans towards it the rest of the way, as on the desktop.
  const r = Math.min(m.radius * pt, width / 2);
  const aim = head.x - (spot.x - width / 2);
  const base = Math.min(Math.max(aim, r + 8 * pt), width - r - 8 * pt);
  const tip = Math.min(Math.max(aim, base - LEAN * pt), base + LEAN * pt);
  // Where its bottom (the tail's tip) sits: under the spot, or lower when
  // its top would be past `minTop`.
  const bottom = Math.max(spot.y - MARGIN * pt, (minTop ?? -Infinity) + size.height + TAIL * pt);
  // Moved down past the head, the bubble points up at it.
  const up = bottom - size.height - TAIL * pt > head.y;
  const tail = width > 0 && (
    <svg className="speech-tail" width={width} height={TAIL * pt + 1} aria-hidden="true">
      <polygon
        points={
          up
            ? `${base - 8 * pt},${TAIL * pt + 1} ${tip},0 ${base + 8 * pt},${TAIL * pt + 1}`
            : `${base - 8 * pt},0 ${tip},${TAIL * pt + 1} ${base + 8 * pt},0`
        }
        fill={style.bubbleColor}
      />
    </svg>
  );

  const drag = (e: ReactPointerEvent) => {
    if (!onMove) return;
    e.preventDefault();
    const start = { x: e.clientX, y: e.clientY };
    // A click that does not move is no change.
    let moved = false;
    const move = (ev: PointerEvent, done: boolean) => {
      moved ||= ev.clientX !== start.x || ev.clientY !== start.y;
      if (moved) onMove((ev.clientX - start.x) / px, (ev.clientY - start.y) / px, done);
    };
    const onPointerMove = (ev: PointerEvent) => move(ev, false);
    const onPointerUp = (ev: PointerEvent) => {
      move(ev, true);
      stop();
    };
    // Taken away (by the system, say): it ends where it got to.
    const onPointerCancel = (ev: PointerEvent) => onPointerUp(ev);
    const stop = () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
  };

  return (
    <div
      className={`speech-bubble${onMove ? " movable" : ""}${up ? " up" : ""}`}
      style={{ left: spot.x, top: bottom, "--tail": `${TAIL * pt}px` } as CSSProperties}
      onPointerDown={drag}
    >
      {up && tail}
      <div
        ref={body}
        className="speech-body"
        style={{
          background: style.bubbleColor,
          color: style.textColor,
          borderRadius: m.radius * pt,
          padding: `${m.padding.y * pt}px ${m.padding.x * pt}px`,
          fontSize: style.fontSize * pt,
          lineHeight: `${m.line * pt}px`,
          minWidth: m.minBody * pt,
          maxWidth: (m.maxText + 2 * m.padding.x) * pt,
        }}
      >
        <b>{line}</b>
      </div>
      {!up && tail}
    </div>
  );
}

import { useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react";

const SIZE = 168;
const R = SIZE / 2;

interface HSV {
  h: number; // 0–360
  s: number; // 0–1
  v: number; // 0–1
}

function hsvToRgb({ h, s, v }: HSV): [number, number, number] {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return [f(5), f(3), f(1)].map((c) => Math.round(c * 255)) as [number, number, number];
}

export function hsvToHex(hsv: HSV): string {
  return `#${hsvToRgb(hsv).map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

function hexToHsv(hex: string): HSV {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return { h: 0, s: 0, v: 1 };
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => c / 255);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
  }
  return { h: (h * 60 + 360) % 360, s: max ? d / max : 0, v: max };
}

/**
 * A colour wheel like the one in macOS's Colors panel: hue around the
 * circle, saturation out from the centre, brightness on the slider below.
 */
export function ColorWheel({ value, onChange }: { value: string; onChange: (hex: string) => void }) {
  const [hsv, setHsv] = useState(() => hexToHsv(value));
  const canvas = useRef<HTMLCanvasElement>(null);

  // The disc at the current brightness.
  useEffect(() => {
    const ctx = canvas.current?.getContext("2d");
    if (!ctx) return;
    const scale = window.devicePixelRatio || 1;
    const px = Math.round(SIZE * scale);
    canvas.current!.width = canvas.current!.height = px;
    const image = ctx.createImageData(px, px);
    const radius = px / 2;
    for (let y = 0; y < px; y++) {
      for (let x = 0; x < px; x++) {
        const dx = x - radius + 0.5;
        const dy = y - radius + 0.5;
        const dist = Math.hypot(dx, dy);
        if (dist > radius) continue;
        const [r, g, b] = hsvToRgb({ h: (Math.atan2(dy, dx) * 180) / Math.PI + 360, s: dist / radius, v: hsv.v });
        const i = (y * px + x) * 4;
        image.data[i] = r;
        image.data[i + 1] = g;
        image.data[i + 2] = b;
        // A soft edge instead of a jagged one.
        image.data[i + 3] = Math.round(255 * Math.min(1, radius - dist));
      }
    }
    ctx.putImageData(image, 0, 0);
  }, [hsv.v]);

  const update = (next: HSV) => {
    setHsv(next);
    onChange(hsvToHex(next));
  };

  const pick = (e: PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const dx = e.clientX - rect.left - R;
    const dy = e.clientY - rect.top - R;
    update({ ...hsv, h: ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360, s: Math.min(1, Math.hypot(dx, dy) / R) });
  };

  const angle = (hsv.h * Math.PI) / 180;
  const marker = { left: R + Math.cos(angle) * hsv.s * R, top: R + Math.sin(angle) * hsv.s * R };
  const bright = hsvToHex({ ...hsv, v: 1 });

  return (
    <div className="color-wheel">
      <div
        className="wheel"
        style={{ width: SIZE, height: SIZE }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          pick(e);
        }}
        onPointerMove={(e) => e.buttons && pick(e)}
      >
        <canvas ref={canvas} style={{ width: SIZE, height: SIZE }} />
        <i className="wheel-marker" style={{ ...marker, background: hsvToHex(hsv) }} />
      </div>
      <input
        className="brightness"
        type="range"
        min="0"
        max="100"
        value={Math.round(hsv.v * 100)}
        style={{ "--to": bright } as CSSProperties}
        onChange={(e) => update({ ...hsv, v: Number(e.target.value) / 100 })}
      />
      <div className="color-readout">
        <i style={{ background: hsvToHex(hsv) }} />
        <span>{hsvToHex(hsv).toUpperCase()}</span>
      </div>
    </div>
  );
}

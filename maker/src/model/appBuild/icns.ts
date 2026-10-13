/**
 * A macOS icon file from one square picture: every size the Dock and Finder
 * ask for, each stored as PNG — the same set `iconutil` writes from an
 * iconset (16…512 pt at 1× and 2×).
 */
export const ICNS_TYPES: [string, number][] = [
  ["icp4", 16],
  ["ic11", 32],
  ["icp5", 32],
  ["ic12", 64],
  ["ic07", 128],
  ["ic13", 256],
  ["ic08", 256],
  ["ic14", 512],
  ["ic09", 512],
  ["ic10", 1024],
];

/** Every size the icon needs, drawn from one square picture. */
export async function makeIcns(png1024: Uint8Array): Promise<Uint8Array> {
  const source = await createImageBitmap(new Blob([png1024 as BlobPart], { type: "image/png" }));
  const bySize = new Map<number, Uint8Array>();
  try {
    for (const [, size] of ICNS_TYPES) {
      if (bySize.has(size)) continue;
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = size;
      const ctx = canvas.getContext("2d")!;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(source, 0, 0, size, size);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("icon encode failed");
      bySize.set(size, new Uint8Array(await blob.arrayBuffer()));
    }
  } finally {
    source.close();
  }
  return packIcns(bySize);
}

/** The icns container: a header, then each size as a typed PNG chunk. */
export function packIcns(bySize: Map<number, Uint8Array>): Uint8Array {
  const entries = ICNS_TYPES.map(([type, size]) => {
    const data = bySize.get(size);
    if (!data) throw new Error(`icon: no ${size} px picture`);
    return { type, data };
  });
  const total = 8 + entries.reduce((sum, e) => sum + 8 + e.data.length, 0);
  const out = new Uint8Array(total);
  const view = new DataView(out.buffer);
  const tag = (at: number, text: string) => [...text].forEach((ch, i) => (out[at + i] = ch.charCodeAt(0)));
  tag(0, "icns");
  view.setUint32(4, total, false);
  let at = 8;
  for (const { type, data } of entries) {
    tag(at, type);
    view.setUint32(at + 4, 8 + data.length, false);
    out.set(data, at + 8);
    at += 8 + data.length;
  }
  return out;
}

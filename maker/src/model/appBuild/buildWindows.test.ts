import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { strFromU8, strToU8, unzlibSync, zipSync, zlibSync } from "fflate";
import { Data, NtExecutable, NtExecutableResource, Resource } from "resedit";
import { describe, expect, it } from "vitest";
import { ICON_SIZES, appendPayload, buildWindowsApp, readPayload, windowsFileSafe, type WindowsImageOps } from "./buildWindows";

// The real runtime template, as player-windows builds it (on Windows, or from
// CI's artifact). Without it the end-to-end cases are skipped.
const TEMPLATE = process.env.TYPEPAL_WIN_TEMPLATE ?? join(__dirname, "../../../../player-windows/target/release/TypePal.exe");
const haveTemplate = existsSync(TEMPLATE);

// MARK: A minimal PNG reader and writer (8-bit RGBA, not interlaced), so the
// icon can be made at its real sizes without a canvas.

function readPng(png: Uint8Array): { w: number; h: number; rgba: Uint8Array } {
  const view = new DataView(png.buffer, png.byteOffset);
  const w = view.getUint32(16);
  const h = view.getUint32(20);
  const chunks: Uint8Array[] = [];
  for (let at = 8; at < png.length; ) {
    const len = view.getUint32(at);
    const type = strFromU8(png.subarray(at + 4, at + 8));
    if (type === "IDAT") chunks.push(png.subarray(at + 8, at + 8 + len));
    at += 12 + len;
  }
  const raw = unzlibSync(Uint8Array.from(chunks.flatMap((c) => [...c])));
  const stride = w * 4;
  const rgba = new Uint8Array(stride * h);
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    for (let x = 0; x < stride; x++) {
      const v = raw[y * (stride + 1) + 1 + x];
      const a = x >= 4 ? rgba[y * stride + x - 4] : 0;
      const b = y > 0 ? rgba[(y - 1) * stride + x] : 0;
      const c = x >= 4 && y > 0 ? rgba[(y - 1) * stride + x - 4] : 0;
      const p = a + b - c;
      const paeth = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c;
      const pred = [0, a, b, (a + b) >> 1, paeth][filter];
      rgba[y * stride + x] = (v + pred) & 0xff;
    }
  }
  return { w, h, rgba };
}

function crc32(bytes: Uint8Array): number {
  let c = ~0;
  for (const b of bytes) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}

function writePng(w: number, h: number, rgba: Uint8Array): Uint8Array {
  const raw = new Uint8Array((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) raw.set(rgba.subarray(y * w * 4, (y + 1) * w * 4), y * (w * 4 + 1) + 1);
  const chunk = (type: string, data: Uint8Array) => {
    const out = new Uint8Array(12 + data.length);
    const v = new DataView(out.buffer);
    v.setUint32(0, data.length);
    out.set(strToU8(type), 4);
    out.set(data, 8);
    v.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
    return out;
  };
  const ihdr = new Uint8Array(13);
  new DataView(ihdr.buffer).setUint32(0, w);
  new DataView(ihdr.buffer).setUint32(4, h);
  ihdr.set([8, 6, 0, 0, 0], 8);
  const parts = [Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlibSync(raw)), chunk("IEND", new Uint8Array())];
  return Uint8Array.from(parts.flatMap((p) => [...p]));
}

/** Box-averaged downscale, enough for an icon. */
function scalePng(png: Uint8Array, size: number): Uint8Array {
  const { w, h, rgba } = readPng(png);
  const out = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [x0, x1] = [Math.floor((x * w) / size), Math.max(Math.floor(((x + 1) * w) / size), Math.floor((x * w) / size) + 1)];
      const [y0, y1] = [Math.floor((y * h) / size), Math.max(Math.floor(((y + 1) * h) / size), Math.floor((y * h) / size) + 1)];
      const acc = [0, 0, 0, 0];
      for (let sy = y0; sy < y1; sy++) {
        for (let sx = x0; sx < x1; sx++) {
          const i = (sy * w + sx) * 4;
          const a = rgba[i + 3];
          acc[0] += rgba[i] * a;
          acc[1] += rgba[i + 1] * a;
          acc[2] += rgba[i + 2] * a;
          acc[3] += a;
        }
      }
      const n = (x1 - x0) * (y1 - y0);
      const o = (y * size + x) * 4;
      out[o + 3] = Math.round(acc[3] / n);
      for (let c = 0; c < 3; c++) out[o + c] = acc[3] ? Math.round(acc[c] / acc[3]) : 0;
    }
  }
  return writePng(size, size, out);
}

const images: WindowsImageOps = {
  fitHeight: async (data) => data,
  iconPng: async (png, size) => scalePng(png, size),
};

/** The built-in mascot as a baked project: real pictures, every reaction. */
function mascotProject(name = "TypePal 小团子"): Uint8Array {
  const dir = join(__dirname, "../../../public/assets/typepal-frames");
  const animation = JSON.parse(readFileSync(join(dir, "animation.json"), "utf8"));
  const files: Record<string, Uint8Array> = {};
  const frames: Record<string, { file: string }> = {};
  const states: Record<string, unknown> = {};
  for (const state of ["idle", "typing", "mouseClick", "tap", "pet"]) {
    const ids: string[] = (animation.states[state] ?? []).map((f: string) => f.replace(/\.png$/, ""));
    for (const id of ids) {
      files[`frames/${id}.png`] = new Uint8Array(readFileSync(join(dir, `${id}.png`)));
      frames[id] = { file: `frames/${id}.png` };
    }
    states[state] = { enabled: ids.length > 0, fps: animation.fps, loop: state === "idle", frames: ids };
  }
  files["icon.png"] = files["frames/idle-01.png"];
  files["manifest.json"] = strToU8(JSON.stringify({ schemaVersion: 1, name, id: "web-smoke", display: { height: 192 }, frames, states }));
  return zipSync(files);
}

describe("Windows file names", () => {
  it("keeps what Windows allows and replaces the rest", () => {
    expect(windowsFileSafe("小团子")).toBe("小团子");
    expect(windowsFileSafe('a<b>c:d"e/f\\g|h?i*j')).toBe("a-b-c-d-e-f-g-h-i-j");
    expect(windowsFileSafe("trailing. ")).toBe("trailing");
    expect(windowsFileSafe("CON")).toBe("CON_");
    expect(windowsFileSafe("...")).toBe("TypePal");
  });
});

describe("the payload trailer", () => {
  it("reads back what was appended", () => {
    const zip = zipSync({ "manifest.json": [strToU8("{}"), { level: 0 }] });
    const exe = appendPayload(strToU8("MZ stand-in"), zip);
    expect(strFromU8(exe.subarray(exe.length - 8))).toBe("TYPEPAL1");
    expect(strFromU8(readPayload(exe)!["manifest.json"])).toBe("{}");
    expect(readPayload(strToU8("MZ nothing appended at all"))).toBeNull();
  });
});

describe.skipIf(!haveTemplate)("building from the real template", () => {
  it("names the exe, replaces its icon and version names, and appends the pet", async () => {
    const template = new Uint8Array(readFileSync(TEMPLATE));
    const built = await buildWindowsApp(mascotProject(), template, images);
    expect(built.exeName).toBe("TypePal 小团子.exe");

    // Still a valid executable, with the pet's resources.
    const exe = NtExecutable.from(built.exe.subarray(0, built.exe.length), { ignoreCert: true });
    const res = NtExecutableResource.from(exe);
    const [group] = Resource.IconGroupEntry.fromEntries(res.entries);
    expect(group.icons.map((i) => i.width || 256).sort((a, b) => a - b)).toEqual([...ICON_SIZES]);
    const [version] = Resource.VersionInfo.fromEntries(res.entries);
    const [lang] = version.getAllLanguagesForStringValues();
    const strings = version.getStringValues(lang);
    expect(strings.FileDescription).toBe("TypePal 小团子");
    expect(strings.OriginalFilename).toBe("TypePal 小团子.exe");

    // The pet, stored, after the image.
    const pet = readPayload(built.exe)!;
    const manifest = JSON.parse(strFromU8(pet["manifest.json"]));
    expect(manifest.name).toBe("TypePal 小团子");
    expect(Object.keys(pet).filter((f) => f.startsWith("frames/")).length).toBe(Object.keys(manifest.frames).length);
    expect(Data.RawIconItem).toBeDefined();

    // CI on Windows launches it, as it does the pet the Rust packer makes.
    if (process.env.TYPEPAL_SMOKE_DIR) {
      mkdirSync(process.env.TYPEPAL_SMOKE_DIR, { recursive: true });
      writeFileSync(join(process.env.TYPEPAL_SMOKE_DIR, "web.exe"), built.exe);
    }
  });
});

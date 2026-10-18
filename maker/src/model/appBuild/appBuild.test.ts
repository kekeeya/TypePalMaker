import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { afterAll, describe, expect, it } from "vitest";
import { buildApp, fileSafe, type ImageOps, type Template } from "./buildApp";
import { ICNS_TYPES, packIcns } from "./icns";
import { patchSpecialSlots } from "./macho";
import { editInfoPlist, fillCodeResources } from "./plist";

// The real runtime template, as player/build-app.sh makes it. The end-to-end
// cases need it and macOS's own tools; elsewhere they are skipped.
const TEMPLATE = join(__dirname, "../../../../player/build/TypePal.app/Contents");
const haveTemplate = existsSync(join(TEMPLATE, "MacOS/TypePal"));
const onMac = process.platform === "darwin";

function template(): Template {
  return {
    infoPlist: readFileSync(join(TEMPLATE, "Info.plist"), "utf8"),
    codeResources: readFileSync(join(TEMPLATE, "_CodeSignature/CodeResources"), "utf8"),
    executable: new Uint8Array(readFileSync(join(TEMPLATE, "MacOS/TypePal"))),
  };
}

/** A real 1×1 transparent PNG; tests vary the bytes after it for distinct
 *  frames (PNG readers stop at IEND, and only hashes matter here). */
const PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="),
  (c) => c.charCodeAt(0),
);
const png = (n: number) => Uint8Array.from([...PNG, n & 0xff, n >> 8]);

/** Canvas-free stand-ins: frames as they are, an icon of the same PNG at
 *  every size. */
const images: ImageOps = {
  fitHeight: async (data) => data,
  makeIcns: async (icon) => packIcns(new Map(ICNS_TYPES.map(([, size]) => [size, icon]))),
};

/** The built-in mascot as a baked project: real pictures, every reaction. */
function mascotProject(): Uint8Array {
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
  // Sleep as the template has it, and a Z row over typing: the rows
  // reach the pet.
  for (const id of ["sleep-z-01", "sleep-z-02", "sleep-z-03", "sleep-base-01"]) {
    files[`frames/${id}.png`] = new Uint8Array(readFileSync(join(dir, `${id}.png`)));
    frames[id] = { file: `frames/${id}.png` };
  }
  const zs = ["sleep-z-01", "sleep-z-02", "sleep-z-03"];
  const base = { id: "sleep-base-01", duration: 4000 / animation.fps };
  states.sleep = {
    enabled: true, fps: animation.fps, loop: true, frames: [base], sleepAfterMinutes: 15,
    tracks: [{ id: "sleep-effects", name: "", frames: zs }, { id: "sleep-base", name: "", frames: [base] }],
  };
  const typing = states.typing as { frames: string[] };
  states.typing = { ...typing, tracks: [{ id: "sleep-effects", name: "", frames: zs }, { id: "main", name: "", frames: typing.frames }] };
  files["icon.png"] = files["frames/idle-01.png"];
  files["manifest.json"] = strToU8(
    JSON.stringify({ schemaVersion: 1, name: "TypePal", id: "smoke", display: { height: 192 }, frames, states }),
  );
  return zipSync(files);
}

/** A baked project zip, as the web platform hands it to `buildApp`. */
function project(name: string, states: Record<string, number>): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  const frames: Record<string, { file: string }> = {};
  const stateSpecs: Record<string, unknown> = {};
  let n = 0;
  for (const state of ["idle", "typing", "mouseClick", "tap", "pet"]) {
    const ids: string[] = [];
    for (let i = 0; i < (states[state] ?? 0); i++) {
      const id = `f${++n}`;
      files[`frames/${id}.png`] = png(n);
      frames[id] = { file: `frames/${id}.png` };
      ids.push(id);
    }
    stateSpecs[state] = { enabled: ids.length > 0, fps: 8, loop: state === "idle", frames: ids };
  }
  // A frame the editor still holds but no playing state uses.
  files["frames/unused.png"] = png(999);
  frames.unused = { file: "frames/unused.png" };
  files["icon.png"] = png(1000);
  files["manifest.json"] = strToU8(
    JSON.stringify({ schemaVersion: 1, name, id: "test1234", display: { height: 192 }, frames, states: stateSpecs }),
  );
  return zipSync(files);
}

describe("pieces", () => {
  it("escapes what a property list cannot hold", () => {
    const xml = editInfoPlist("<dict>\n    <key>CFBundleName</key><string>TypePal</string>\n</dict>\n</plist>\n", {
      CFBundleName: "Tom & <Jerry>",
      CFBundleIconFile: "AppIcon",
    });
    expect(xml).toContain("<string>Tom &amp; &lt;Jerry&gt;</string>");
    expect(xml).toContain("<key>CFBundleIconFile</key><string>AppIcon</string>");
    expect(editInfoPlist(xml, { CFBundleName: "$1 $& $$" })).toContain("<string>$1 $&amp; $$</string>");
  });

  it("refuses a template whose seal is not empty", () => {
    expect(() => fillCodeResources("<plist/>", [])).toThrow();
  });

  it("packs every icon size behind a correct header", () => {
    const icns = packIcns(new Map(ICNS_TYPES.map(([, size]) => [size, PNG])));
    const view = new DataView(icns.buffer);
    expect(String.fromCharCode(...icns.slice(0, 4))).toBe("icns");
    expect(view.getUint32(4)).toBe(icns.length);
    expect(icns.length).toBe(8 + ICNS_TYPES.length * (8 + PNG.length));
  });

  it("keeps file names Finder-safe, as the desktop generator does", () => {
    expect(fileSafe("小咪")).toBe("小咪");
    expect(fileSafe("a/b:c")).toBe("a-b-c");
    expect(fileSafe("..hidden")).toBe("hidden");
    expect(fileSafe(" .x ")).toBe(".x");
    expect(fileSafe("..  y")).toBe("y");
    expect(fileSafe("   ")).toBe("TypePal");
  });

  it.runIf(haveTemplate)("changes only the two signature hashes of the template", () => {
    const original = template().executable;
    const patched = original.slice();
    const count = patchSpecialSlots(patched, new Uint8Array(32).fill(1), new Uint8Array(32).fill(3));
    expect(count).toBe(2); // one code directory per architecture
    let changed = 0;
    for (let i = 0; i < original.length; i++) if (original[i] !== patched[i]) changed++;
    expect(changed).toBeGreaterThan(0);
    expect(changed).toBeLessThanOrEqual(count * 2 * 32);
  });
});

describe.runIf(haveTemplate && onMac)("apps built in the browser pass macOS's own checks", () => {
  const dir = mkdtempSync(join(tmpdir(), "typepal-webapp-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  const cases: [string, string, Record<string, number>][] = [
    ["Chinese name", "小团子", { idle: 3, typing: 4, mouseClick: 4, tap: 4, pet: 4 }],
    ["emoji name", "Mochi 🍡✨", { idle: 2, tap: 1 }],
    ["long name", "A very long pet name that goes on and on and on", { idle: 1 }],
    ["characters a plist must escape", "Tom & <Jerry>", { idle: 2, pet: 2 }],
    ["characters a file name cannot hold", "a/b:c", { idle: 1, typing: 1 }],
    ["a single frame", "One", { idle: 1 }],
    ["dollar signs", "$1 Cat $&", { idle: 1 }],
  ];

  it.each(cases)("%s", async (_label, name, states) => {
    await check(await buildApp(project(name, states), template(), images), name, Object.values(states).reduce((a, b) => a + b, 0));
  });

  // The mascot, with real pictures: CI keeps it (TYPEPAL_SMOKE_DIR) to
  // launch it on Apple silicon.
  it("the mascot", async () => {
    const app = await check(await buildApp(mascotProject(), template(), images), "TypePal", 0);
    const keep = process.env.TYPEPAL_SMOKE_DIR;
    if (keep) {
      mkdirSync(keep, { recursive: true });
      execFileSync("ditto", [app, join(keep, "web.app")]);
    }
  });

  /** Unpacks the download and checks it as macOS would; returns the app. */
  async function check(built: Awaited<ReturnType<typeof buildApp>>, name: string, frameCount: number) {
    expect(built.appName).toBe(`${fileSafe(name)}.app`);

    const zipPath = join(dir, `${built.appName}.zip`);
    writeFileSync(zipPath, built.zip);
    const out = join(dir, built.appName.replace(/\.app$/, ""));
    execFileSync("ditto", ["-x", "-k", zipPath, out]);
    const app = join(out, built.appName);

    // The verdict that matters: valid, sealed, and nothing left unsealed.
    execFileSync("codesign", ["--verify", "--strict", "--deep", app]);

    const info = execFileSync("plutil", ["-convert", "json", "-o", "-", join(app, "Contents/Info.plist")], { encoding: "utf8" });
    expect(JSON.parse(info)).toMatchObject({
      CFBundleName: name,
      CFBundleDisplayName: name,
      CFBundleIdentifier: expect.stringMatching(/^io\.typepal\.pet\.(test1234|smoke)$/),
      CFBundleIconFile: "AppIcon",
      CFBundleExecutable: "TypePal",
    });

    // Only the frames playing states use, as the desktop generator writes.
    const manifest = JSON.parse(readFileSync(join(app, "Contents/Resources/Pet/manifest.json"), "utf8"));
    if (frameCount) expect(Object.keys(manifest.frames)).toHaveLength(frameCount);
    expect(manifest.frames.unused).toBeUndefined();
    for (const { file } of Object.values(manifest.frames) as { file: string }[]) {
      expect(existsSync(join(app, "Contents/Resources/Pet", file))).toBe(true);
    }
    expect(readdirSync(join(app, "Contents/Resources/Pet/frames"))).toHaveLength(Object.keys(manifest.frames).length);
    return app;
  }
});

import { strFromU8, strToU8, zipSync, type ZipOptions } from "fflate";
import { makeIcns } from "./icns";
import { fitHeight, readPet } from "./pet";
import { patchSpecialSlots } from "./macho";
import { editInfoPlist, fillCodeResources, type SealedFile } from "./plist";

/**
 * Builds a pet app in the browser, for the web Maker: the same app the
 * desktop Maker's generator makes (`src-tauri/src/generator.rs`), packed as a
 * zip to download.
 *
 * The desktop generator re-signs with `codesign`. A browser cannot, so the
 * template — TypePal's runtime, already signed ad hoc — is used as it is:
 * its executable is never changed except for the two signature hashes that
 * bind it to Info.plist and the resources (see `macho.ts`). macOS treats the
 * result exactly as an app signed by `codesign`.
 */

/** The template's three files, served next to the web Maker. */
export interface Template {
  infoPlist: string;
  codeResources: string;
  executable: Uint8Array;
}

export async function loadTemplate(base: string): Promise<Template> {
  const get = async (path: string) => {
    const response = await fetch(`${base}${path}`);
    if (!response.ok) throw new Error(`template: missing ${path}`);
    return new Uint8Array(await response.arrayBuffer());
  };
  const [info, seal, executable] = await Promise.all([get("Info.plist"), get("CodeResources"), get("TypePal")]);
  return { infoPlist: strFromU8(info), codeResources: strFromU8(seal), executable };
}

/** Finder-safe file name, as `generator::file_safe`. */
export function fileSafe(name: string): string {
  const cleaned = name.replace(/[/:]/g, "-").replace(/^\.+/, "").trim();
  return cleaned || "TypePal";
}

export interface BuiltApp {
  /** "<name>.app". */
  appName: string;
  /** The zip to download, holding the .app folder. */
  zip: Uint8Array;
}

/** The picture work, which needs a browser's canvas; tests pass their own. */
export interface ImageOps {
  makeIcns(png1024: Uint8Array): Promise<Uint8Array>;
  fitHeight(png: Uint8Array, maxPx: number): Promise<Uint8Array>;
}

const browserImages: ImageOps = { makeIcns, fitHeight };

/** `projectZip` is a baked project, as the desktop generator receives it. */
export async function buildApp(projectZip: Uint8Array, template: Template, images: ImageOps = browserImages): Promise<BuiltApp> {
  const pet = await readPet(projectZip, images.fitHeight);
  const name = pet.name;
  const resources: Record<string, Uint8Array> = {};
  for (const [path, data] of Object.entries(pet.files)) resources[`Pet/${path}`] = data;
  resources["AppIcon.icns"] = await images.makeIcns(pet.icon);

  // Info.plist and the resource seal, then the executable bound to both.
  const infoPlist = strToU8(
    editInfoPlist(template.infoPlist, {
      CFBundleName: name,
      CFBundleDisplayName: name,
      CFBundleIdentifier: `io.typepal.pet.${pet.id}`,
      CFBundleIconFile: "AppIcon",
    }),
  );
  const sealed: SealedFile[] = [];
  for (const [path, data] of Object.entries(resources)) {
    sealed.push({ path: `Resources/${path}`, sha1: await digest("SHA-1", data), sha256: await digest("SHA-256", data) });
  }
  const codeResources = strToU8(fillCodeResources(template.codeResources, sealed));
  const executable = template.executable.slice();
  patchSpecialSlots(executable, await digest("SHA-256", infoPlist), await digest("SHA-256", codeResources));

  const appName = `${fileSafe(name)}.app`;
  const file = (data: Uint8Array, mode: number): [Uint8Array, ZipOptions] => [
    data,
    // Unix permissions, so the unpacked executable can run.
    { level: data.length > 0 && !isCompressed(data) ? 6 : 0, os: 3, attrs: (0o100000 | mode) << 16 } as ZipOptions,
  ];
  const entries: Record<string, [Uint8Array, ZipOptions]> = {
    [`${appName}/Contents/Info.plist`]: file(infoPlist, 0o644),
    [`${appName}/Contents/MacOS/TypePal`]: file(executable, 0o755),
    [`${appName}/Contents/_CodeSignature/CodeResources`]: file(codeResources, 0o644),
  };
  for (const [path, data] of Object.entries(resources)) entries[`${appName}/Contents/Resources/${path}`] = file(data, 0o644);
  return { appName, zip: zipSync(entries) };
}

async function digest(algorithm: "SHA-1" | "SHA-256", data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest(algorithm, data as BufferSource));
}

/** PNGs are compressed already; deflating them again only costs time. */
function isCompressed(data: Uint8Array) {
  return data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47;
}

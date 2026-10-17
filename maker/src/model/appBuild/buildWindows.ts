/**
 * Builds a Windows pet in the browser, from the TypePal runtime template
 * (`player-windows`, served next to the web Maker) and a baked project.
 *
 * A Windows pet is one file: the template exe, with the pet's own icon and
 * name written into its resources, and the pet itself (`manifest.json` and
 * `frames/*.png`, an uncompressed zip) appended after the executable image
 * with a 16-byte trailer the runtime looks for (`core/payload.rs`):
 *
 *   [ exe ][ zip ][ zip length: u64 LE ][ "TYPEPAL1" ]
 *
 * Nothing is signed, so nothing needs re-signing; Windows asks once
 * (SmartScreen, "Run anyway") as it does for any unsigned download.
 */

import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import { Data, NtExecutable, NtExecutableResource, Resource } from "resedit";
import { fitHeight, readPet } from "./pet";

export const PAYLOAD_MAGIC = "TYPEPAL1";

/** Icon sizes Windows asks for, from the taskbar's to Explorer's largest. */
export const ICON_SIZES = [16, 20, 24, 32, 40, 48, 64, 256] as const;

export interface BuiltWindowsApp {
  /** "<name>.exe". */
  exeName: string;
  exe: Uint8Array;
  /** The zip to download, holding the exe. */
  zip: Uint8Array;
}

/** The picture work, which needs a browser's canvas; tests pass their own. */
export interface WindowsImageOps {
  fitHeight(png: Uint8Array, maxPx: number): Promise<Uint8Array>;
  /** The square icon at `size` × `size`, as PNG. */
  iconPng(png1024: Uint8Array, size: number): Promise<Uint8Array>;
}

const browserImages: WindowsImageOps = { fitHeight, iconPng };

/** A file name Windows accepts: no reserved characters or device names, no
 *  trailing dot or space. */
export function windowsFileSafe(name: string): string {
  // eslint-disable-next-line no-control-regex
  let cleaned = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").replace(/^\.+/, "").replace(/[. ]+$/, "").trim();
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(cleaned)) cleaned = `${cleaned}_`;
  return cleaned || "TypePal";
}

/** Fetches the Windows template served at `base` (".../template/windows/"). */
export async function loadWindowsTemplate(base: string): Promise<Uint8Array> {
  const response = await fetch(`${base}TypePal.exe`);
  const exe = new Uint8Array(await response.arrayBuffer());
  // A missing file can come back as a web page; only an executable will do.
  if (!response.ok || exe[0] !== 0x4d || exe[1] !== 0x5a) throw new Error("template: missing TypePal.exe");
  return exe;
}

/** `projectZip` is a baked project, as the generators receive it. */
export async function buildWindowsApp(
  projectZip: Uint8Array,
  template: Uint8Array,
  images: WindowsImageOps = browserImages,
): Promise<BuiltWindowsApp> {
  const pet = await readPet(projectZip, images.fitHeight);
  const name = pet.name;
  // Stored, not deflated: the runtime reads entries straight from the file.
  const payload = zipSync(Object.fromEntries(Object.entries(pet.files).map(([path, data]) => [path, [data, { level: 0 }]])));
  const icons = await Promise.all(ICON_SIZES.map(async (size) => [size, await images.iconPng(pet.icon, size)] as const));

  const exeName = `${windowsFileSafe(name)}.exe`;
  const named = editResources(template, name, exeName, icons);
  const exe = appendPayload(named, payload);
  return { exeName, exe, zip: zipSync({ [exeName]: [exe, { level: 0 }] }) };
}

/** The pet's icon (group 1) and names (version information), in the exe. */
function editResources(template: Uint8Array, name: string, exeName: string, icons: (readonly [number, Uint8Array])[]): Uint8Array {
  const exe = NtExecutable.from(template);
  const res = NtExecutableResource.from(exe);

  // Same language as the template's own icon, so it is replaced, not added.
  const RT_GROUP_ICON = 14;
  const group = res.entries.find((e) => e.type === RT_GROUP_ICON && e.id === 1);
  if (!group) throw new Error("template: no icon");
  Resource.IconGroupEntry.replaceIconsForResource(
    res.entries,
    1,
    group.lang,
    icons.map(([size, png]) => Data.RawIconItem.from(png, size, size, 32)),
  );

  const [version] = Resource.VersionInfo.fromEntries(res.entries);
  if (!version) throw new Error("template: no version information");
  const [language] = version.getAllLanguagesForStringValues();
  version.setStringValues(language, {
    FileDescription: name,
    ProductName: name,
    InternalName: name,
    OriginalFilename: exeName,
  });
  version.outputToResourceEntries(res.entries);

  res.outputResource(exe);
  return new Uint8Array(exe.generate());
}

export function appendPayload(exe: Uint8Array, zip: Uint8Array): Uint8Array {
  const out = new Uint8Array(exe.length + zip.length + 16);
  out.set(exe, 0);
  out.set(zip, exe.length);
  new DataView(out.buffer).setBigUint64(exe.length + zip.length, BigInt(zip.length), true);
  out.set(strToU8(PAYLOAD_MAGIC), exe.length + zip.length + 8);
  return out;
}

/** The pet appended to a generated exe, for tests: its stored zip's files. */
export function readPayload(exe: Uint8Array): Record<string, Uint8Array> | null {
  const end = exe.length;
  if (strFromU8(exe.subarray(end - 8)) !== PAYLOAD_MAGIC) return null;
  const length = Number(new DataView(exe.buffer, exe.byteOffset).getBigUint64(end - 16, true));
  return unzipSync(exe.subarray(end - 16 - length, end - 16));
}

/** The square icon redrawn at `size`, high-quality, as PNG. */
async function iconPng(png: Uint8Array, size: number): Promise<Uint8Array> {
  const image = await createImageBitmap(new Blob([png as BlobPart], { type: "image/png" }));
  try {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(image, 0, 0, size, size);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("icon encode failed");
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    image.close();
  }
}

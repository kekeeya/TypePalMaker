/**
 * Re-binding a signed executable to new contents, without re-signing it.
 *
 * An ad-hoc signature's CodeDirectory hashes the code page by page, plus a
 * few "special slots": slot 1 is the hash of Info.plist, slot 3 the hash of
 * `_CodeSignature/CodeResources`. The code itself never changes here, so
 * replacing those two hashes — same size, same place — re-seals the app over
 * its new Info.plist and resources. Ad-hoc signatures carry no certificate,
 * so nothing else refers to these bytes.
 *
 * Only the SHA-256 directories TypePal's template is built with are
 * accepted; anything unexpected throws rather than produce a broken app.
 */

const FAT_MAGIC = 0xcafebabe;
const MH_MAGIC_64 = 0xfeedfacf;
const LC_CODE_SIGNATURE = 0x1d;
const CSMAGIC_EMBEDDED_SIGNATURE = 0xfade0cc0;
const CSMAGIC_CODEDIRECTORY = 0xfade0c02;
const CSSLOT_CODEDIRECTORY = 0;
const CSSLOT_ALTERNATE_CODEDIRECTORIES = 0x1000;
const CS_HASHTYPE_SHA256 = 2;
const SLOT_INFO_PLIST = 1;
const SLOT_RESOURCES = 3;

/** Writes the two hashes into every CodeDirectory of every architecture and
 *  returns how many were patched. */
export function patchSpecialSlots(binary: Uint8Array, infoPlistHash: Uint8Array, resourcesHash: Uint8Array): number {
  const view = new DataView(binary.buffer, binary.byteOffset, binary.byteLength);
  const slices: number[] = [];
  if (view.getUint32(0, false) === FAT_MAGIC) {
    const count = view.getUint32(4, false);
    for (let i = 0; i < count; i++) slices.push(view.getUint32(8 + i * 20 + 8, false));
  } else {
    slices.push(0);
  }

  let patched = 0;
  for (const base of slices) {
    if (view.getUint32(base, true) !== MH_MAGIC_64) throw new Error("template: not a 64-bit Mach-O");
    const commands = view.getUint32(base + 16, true);
    let at = base + 32;
    for (let c = 0; c < commands; c++) {
      const cmd = view.getUint32(at, true);
      const size = view.getUint32(at + 4, true);
      if (cmd === LC_CODE_SIGNATURE) patched += patchSuperBlob(binary, view, base + view.getUint32(at + 8, true), infoPlistHash, resourcesHash);
      at += size;
    }
  }
  if (patched === 0) throw new Error("template: no code signature found");
  return patched;
}

function patchSuperBlob(binary: Uint8Array, view: DataView, blob: number, info: Uint8Array, resources: Uint8Array): number {
  if (view.getUint32(blob, false) !== CSMAGIC_EMBEDDED_SIGNATURE) throw new Error("template: unexpected signature format");
  const count = view.getUint32(blob + 8, false);
  let patched = 0;
  for (let i = 0; i < count; i++) {
    const type = view.getUint32(blob + 12 + i * 8, false);
    if (type !== CSSLOT_CODEDIRECTORY && (type < CSSLOT_ALTERNATE_CODEDIRECTORIES || type >= CSSLOT_ALTERNATE_CODEDIRECTORIES + 5)) continue;
    const cd = blob + view.getUint32(blob + 16 + i * 8, false);
    if (view.getUint32(cd, false) !== CSMAGIC_CODEDIRECTORY) throw new Error("template: unexpected code directory");
    const hashOffset = view.getUint32(cd + 16, false);
    const specialSlots = view.getUint32(cd + 24, false);
    const hashSize = binary[cd + 36];
    const hashType = binary[cd + 37];
    if (hashType !== CS_HASHTYPE_SHA256 || hashSize !== 32 || specialSlots < SLOT_RESOURCES) {
      throw new Error("template: code directory is not plain SHA-256");
    }
    binary.set(info, cd + hashOffset - SLOT_INFO_PLIST * hashSize);
    binary.set(resources, cd + hashOffset - SLOT_RESOURCES * hashSize);
    patched += 1;
  }
  return patched;
}

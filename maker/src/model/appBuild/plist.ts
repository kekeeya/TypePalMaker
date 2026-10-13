/** The two property lists the app build writes, from the template's own. */

const escape = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Sets (or adds) string values in the template's Info.plist. */
export function editInfoPlist(xml: string, values: Record<string, string>): string {
  let out = xml;
  for (const [key, value] of Object.entries(values)) {
    const entry = new RegExp(`(<key>${key}</key>\\s*<string>)[^<]*(</string>)`);
    if (entry.test(out)) out = out.replace(entry, (_, open, close) => `${open}${escape(value)}${close}`);
    else out = out.replace(/<\/dict>\s*<\/plist>\s*$/, () => `    <key>${key}</key><string>${escape(value)}</string>\n</dict>\n</plist>\n`);
  }
  return out;
}

export interface SealedFile {
  /** Relative to Contents/, e.g. "Resources/Pet/manifest.json". */
  path: string;
  sha1: Uint8Array;
  sha256: Uint8Array;
}

const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

/** Fills the template's empty `files` / `files2` dictionaries with every
 *  resource, as `codesign` writes them for a SHA-256 signature: the SHA-1 in
 *  `files` (the legacy rules), the SHA-256 as `hash2` in `files2`. The rules
 *  that follow are the template's, untouched. */
export function fillCodeResources(xml: string, files: SealedFile[]): string {
  const sorted = [...files].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const legacy = sorted.map((f) => `\t\t<key>${escape(f.path)}</key>\n\t\t<data>\n\t\t${base64(f.sha1)}\n\t\t</data>\n`).join("");
  const current = sorted
    .map((f) => `\t\t<key>${escape(f.path)}</key>\n\t\t<dict>\n\t\t\t<key>hash2</key>\n\t\t\t<data>\n\t\t\t${base64(f.sha256)}\n\t\t\t</data>\n\t\t</dict>\n`)
    .join("");
  const filesEmpty = "\t<key>files</key>\n\t<dict/>\n";
  const files2Empty = "\t<key>files2</key>\n\t<dict/>\n";
  if (!xml.includes(filesEmpty) || !xml.includes(files2Empty)) throw new Error("template: resource seal is not empty");
  return xml
    .replace(filesEmpty, `\t<key>files</key>\n\t<dict>\n${legacy}\t</dict>\n`)
    .replace(files2Empty, `\t<key>files2</key>\n\t<dict>\n${current}\t</dict>\n`);
}

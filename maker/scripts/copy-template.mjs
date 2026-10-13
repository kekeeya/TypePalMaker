// Copies the signed TypePal runtime template into the web Maker's static
// files, so the browser can build pet apps from it (src/model/appBuild).
// The template is a build product of player/build-app.sh — never committed.
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, "../../player/build/TypePal.app/Contents");
const out = join(here, "../public/template");

// The desktop Maker builds apps with its own copy of the template (a Tauri
// resource) and `codesign`; its web assets need none.
if (process.env.TAURI_ENV_PLATFORM) {
  rmSync(out, { recursive: true, force: true });
  console.log("desktop build: no web template");
  process.exit(0);
}

const files = {
  "Info.plist": join(app, "Info.plist"),
  CodeResources: join(app, "_CodeSignature/CodeResources"),
  TypePal: join(app, "MacOS/TypePal"),
};
const missing = Object.values(files).filter((f) => !existsSync(f));
if (missing.length) {
  console.error(`TypePal template not built — run player/build-app.sh first.\nMissing: ${missing.join(", ")}`);
  // Editing works without it; only a build to publish must have it.
  process.exit(process.env.npm_lifecycle_event === "predev" ? 0 : 1);
}
mkdirSync(out, { recursive: true });
for (const [name, from] of Object.entries(files)) copyFileSync(from, join(out, name));
console.log(`template copied to ${out}`);

// Copies the pet templates into the Maker's static files, so the page can
// build pets from them (src/model/appBuild): the signed Mac runtime from
// player/build-app.sh, and the Windows runtime from player-windows
// (cargo build --release). Both are build products, never committed.
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, "../../player/build/TypePal.app/Contents");
const out = join(here, "../public/template");

const windows = process.env.TYPEPAL_WIN_TEMPLATE ?? join(here, "../../player-windows/target/release/TypePal.exe");

// The Mac desktop Maker builds apps with its own copy of the template (a
// Tauri resource) and `codesign`; its web assets need none. The Windows one
// builds pets in its page, as the web Maker does: it needs the Windows
// template and nothing else.
if (process.env.TAURI_ENV_PLATFORM) {
  rmSync(out, { recursive: true, force: true });
  if (process.env.TAURI_ENV_PLATFORM !== "windows") {
    console.log("desktop build: no web template");
    process.exit(0);
  }
  if (!existsSync(windows)) {
    console.error(`Windows template not built — run cargo build --release in player-windows first.\nMissing: ${windows}`);
    process.exit(process.env.npm_lifecycle_event === "predev" ? 0 : 1);
  }
  mkdirSync(join(out, "windows"), { recursive: true });
  copyFileSync(windows, join(out, "windows/TypePal.exe"));
  console.log("Windows desktop build: Windows template only");
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
  // Editing works without it, and so does making Windows pets (below), as
  // when developing on Windows; only a build to publish must have it.
  if (process.env.npm_lifecycle_event !== "predev") process.exit(1);
} else {
  mkdirSync(out, { recursive: true });
  for (const [name, from] of Object.entries(files)) copyFileSync(from, join(out, name));
  console.log(`template copied to ${out}`);
}

// The Windows template, built by player-windows on Windows (CI hands it to
// the Pages build). Optional here: without it only "Generate Windows Pet"
// fails, and the Pages workflow checks it is there before publishing.
if (existsSync(windows)) {
  mkdirSync(join(out, "windows"), { recursive: true });
  copyFileSync(windows, join(out, "windows/TypePal.exe"));
  console.log(`Windows template copied to ${join(out, "windows")}`);
} else {
  console.warn(`No Windows template (${windows}): this build can't make Windows pets.`);
}

import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import type { GenerateResult, Platform } from "./types";

const windows = navigator.userAgent.includes("Windows");

/** The file name at the end of a path, either system's. */
const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;

/** Bytes travel as the raw request body; paths and flags as headers, which
 *  must be ASCII — hence the encoding. */
function headers(values: Record<string, string>) {
  return { headers: Object.fromEntries(Object.entries(values).map(([k, v]) => [k, encodeURIComponent(v)])) };
}

/** The project file type, named in the interface language. */
const projectFilter = (label: string) => [{ name: label, extensions: ["typepalproj"] }];
const IMAGE_TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };

/** Where the last app was generated, offered first next time. */
const OUTPUT_DIR_KEY = "output-dir";

/** The desktop Maker: native dialogs, files on disk, and app generation. */
export const tauriPlatform: Platform = {
  kind: "desktop",
  system: windows ? "windows" : "mac",

  async openProject(label) {
    const path = await open({ multiple: false, filters: projectFilter(label) });
    if (typeof path !== "string") return null;
    const buffer = await invoke<ArrayBuffer>("read_binary", { path });
    return { bytes: new Uint8Array(buffer), name: fileName(path) };
  },

  async saveProject(bytes, suggestedName, label) {
    const path = await save({ defaultPath: `${suggestedName}.typepalproj`, filters: projectFilter(label) });
    if (!path) return false;
    await invoke("write_binary", bytes, headers({ "x-path": path }));
    return true;
  },

  async pickImages({ multiple, extensions, label }) {
    const picked = await open({ multiple, filters: [{ name: label, extensions }] });
    if (!picked) return null;
    const paths = Array.isArray(picked) ? picked : [picked];
    return Promise.all(
      paths.map(async (path) => {
        const buffer = await invoke<ArrayBuffer>("read_binary", { path });
        const name = fileName(path);
        return new File([buffer], name, { type: IMAGE_TYPES[name.split(".").pop()?.toLowerCase() ?? ""] ?? "" });
      }),
    );
  },

  async storeGet(key) {
    const buffer = await invoke<ArrayBuffer>("store_get", { key });
    return buffer.byteLength ? new Uint8Array(buffer) : null;
  },

  async storeSet(key, bytes) {
    await invoke("store_set", bytes, headers({ "x-key": key }));
  },

  async storeDelete(key) {
    await invoke("store_delete", { key });
  },

  async openLink(url) {
    await invoke("open_link", { url });
  },

  async chooseOutputDir(title) {
    const last = await this.storeGet(OUTPUT_DIR_KEY).catch(() => null);
    const start = last ? new TextDecoder().decode(last) : await invoke<string>("default_output_dir");
    const picked = await open({ directory: true, multiple: false, defaultPath: start, title });
    if (typeof picked !== "string") return null;
    await this.storeSet(OUTPUT_DIR_KEY, new TextEncoder().encode(picked)).catch(() => {});
    return picked;
  },

  async generateApp(bytes, { overwrite, outDir, lang }): Promise<GenerateResult> {
    try {
      let path: string;
      if (windows) {
        // Built in the page from the Windows template, as on the web, then
        // saved where the user chose.
        const { buildWindowsApp, loadWindowsTemplate } = await import("../model/appBuild/buildWindows");
        const built = await buildWindowsApp(bytes, await loadWindowsTemplate(`${import.meta.env.BASE_URL}template/windows/`));
        path = await invoke<string>(
          "save_pet",
          built.exe,
          headers({ "x-path": outDir, "x-name": built.exeName, "x-overwrite": overwrite ? "1" : "0" }),
        );
      } else {
        path = await invoke<string>(
          "generate_app",
          bytes,
          headers({ "x-path": outDir, "x-overwrite": overwrite ? "1" : "0", "x-lang": lang }),
        );
      }
      return { ok: true, path };
    } catch (error) {
      const text = String(error);
      const [code, ...rest] = text.split(":");
      const detail = rest.join(":");
      if (code === "EXISTS") return { ok: false, reason: "exists", path: detail };
      if (code === "RUNNING") return { ok: false, reason: "running", path: detail };
      return { ok: false, reason: "error", message: code === "ERROR" ? detail : text };
    }
  },

  async revealInFinder(path) {
    await invoke("reveal_in_finder", { path });
  },

  async openApp(path) {
    await invoke("open_app", { path });
  },
};

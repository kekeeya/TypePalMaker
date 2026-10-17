import { del, get, set } from "idb-keyval";
import { STRINGS, type Lang } from "../i18n/strings";
import type { GenerateResult, Platform } from "./types";

const PREFIX = "typepal-maker:";

/** The browser: files go through an <input> and a download, projects being
 *  edited live in IndexedDB, and pet apps are built in the page itself
 *  (`model/appBuild`) and downloaded as a zip. */
export const webPlatform: Platform = {
  kind: "web",

  openProject() {
    return new Promise((resolve) => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".typepalproj";
      input.onchange = async () => {
        const file = input.files?.[0];
        resolve(file ? { bytes: new Uint8Array(await file.arrayBuffer()), name: file.name } : null);
      };
      // No event fires on cancel in every browser; a focus return covers it.
      window.addEventListener("focus", () => setTimeout(() => !input.files?.length && resolve(null), 500), { once: true });
      input.click();
    });
  },

  async saveProject(bytes, suggestedName) {
    download(bytes, `${suggestedName}.typepalproj`);
    return true;
  },

  async storeGet(key) {
    return (await get<Uint8Array>(PREFIX + key)) ?? null;
  },

  async storeSet(key, bytes) {
    await set(PREFIX + key, bytes);
  },

  async storeDelete(key) {
    await del(PREFIX + key);
  },

  async openLink(url) {
    window.open(url, "_blank", "noopener");
  },

  async generateApp(bytes, { lang, target = "mac" }) {
    if (target === "windows") return generateWindows(bytes, lang);
    try {
      // Loaded only when needed: neither the builder nor the template is
      // part of the page until someone generates an app.
      let parts;
      try {
        const { buildApp, loadTemplate } = await import("../model/appBuild/buildApp");
        parts = { buildApp, template: await loadTemplate(`${import.meta.env.BASE_URL}template/`) };
      } catch {
        return { ok: false, reason: "error", message: STRINGS[lang].networkError };
      }
      const built = await parts.buildApp(bytes, parts.template);
      const fileName = `${built.appName.replace(/\.app$/, "")}.zip`;
      download(built.zip, fileName);
      return { ok: true, path: fileName };
    } catch (error) {
      return failed(lang, error);
    }
  },
};

/** A Windows pet, built in the page from the Windows template. */
async function generateWindows(bytes: Uint8Array, lang: Lang): Promise<GenerateResult> {
  try {
    let parts;
    try {
      const { buildWindowsApp, loadWindowsTemplate } = await import("../model/appBuild/buildWindows");
      parts = { buildWindowsApp, template: await loadWindowsTemplate(`${import.meta.env.BASE_URL}template/windows/`) };
    } catch {
      return { ok: false, reason: "error", message: STRINGS[lang].networkError };
    }
    const built = await parts.buildWindowsApp(bytes, parts.template);
    // Told apart from the Mac download of the same pet.
    const fileName = `${built.exeName.replace(/\.exe$/, "")} (Windows).zip`;
    download(built.zip, fileName);
    return { ok: true, path: fileName };
  } catch (error) {
    return failed(lang, error);
  }
}

/** A builder's error, in words the user can read, with the detail kept. */
function failed(lang: Lang, error: unknown): GenerateResult {
  const detail = error instanceof Error ? error.message : String(error);
  return { ok: false, reason: "error", message: STRINGS[lang].generateError(detail) };
}

/** Hands bytes to the browser as a file download. */
function download(bytes: Uint8Array, fileName: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/zip" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

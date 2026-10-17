import type { Platform } from "./types";
import { webPlatform } from "./web";

export type { AppTarget, GenerateResult, Platform } from "./types";

/**
 * Picked at runtime, so one build serves both targets: inside the Tauri shell
 * `__TAURI_INTERNALS__` is present and the desktop implementation is loaded
 * (lazily, so the web page never downloads it); anywhere else, the browser
 * one.
 */
export async function loadPlatform(): Promise<Platform> {
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    return (await import("./tauri")).tauriPlatform;
  }
  return webPlatform;
}

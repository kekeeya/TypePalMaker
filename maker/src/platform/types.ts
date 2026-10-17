/**
 * Everything the editor needs from its host. Components only ever talk to
 * this interface — never to `@tauri-apps/*` directly — so the same build runs
 * both as the desktop Maker and as a plain web page on GitHub Pages.
 */
export interface Platform {
  kind: "desktop" | "web";
  /** The system the desktop Maker runs on, which is the one its pets are
   *  for. Absent on the web. */
  system?: AppTarget;

  /** Lets the user pick a `.typepalproj`; null if they cancel. `label` names
   *  the file type in the system dialog, in the interface language. */
  openProject(label: string): Promise<{ bytes: Uint8Array; name: string } | null>;
  /** Saves a `.typepalproj`; returns false if the user cancels. */
  saveProject(bytes: Uint8Array, suggestedName: string, label: string): Promise<boolean>;

  /** The Maker's own storage, where projects are kept as they are edited
   *  (see `model/drafts.ts`). Keys are short `[a-z0-9-]` names. */
  storeGet(key: string): Promise<Uint8Array | null>;
  storeSet(key: string, bytes: Uint8Array): Promise<void>;
  storeDelete(key: string): Promise<void>;

  /** Lets the user pick images with the system's own dialog, which shows
   *  only the formats given; null if they cancel. Where absent (the web),
   *  an <input type=file> with the same formats is used instead. */
  pickImages?(options: { multiple: boolean; extensions: string[]; label: string }): Promise<File[] | null>;

  /** Opens an https link in the user's browser. */
  openLink(url: string): Promise<void>;

  /** Asks where to put the generated app, starting from the last place
   *  chosen (first time: ~/Applications); null if the user cancels. Absent
   *  on the web, where the browser downloads the app instead. */
  chooseOutputDir?(title: string): Promise<string | null>;
  /** Builds the pet app: on the desktop into `outDir`, signed by `codesign`;
   *  on the web in the browser, downloaded as a zip (`outDir` unused, and the
   *  result's path is the zip's file name). `lang` is the interface
   *  language, for the error messages. */
  generateApp?(bytes: Uint8Array, options: { overwrite: boolean; outDir: string; lang: "zh" | "en"; target?: AppTarget }): Promise<GenerateResult>;
  revealInFinder?(path: string): Promise<void>;
  openApp?(path: string): Promise<void>;
}

/** Which system the pet app is for. The desktop Maker makes only its own
 *  system's; the web Maker makes either. */
export type AppTarget = "mac" | "windows";

export type GenerateResult =
  | { ok: true; path: string }
  /** An app with this name is already there; ask, then retry with overwrite. */
  | { ok: false; reason: "exists"; path: string }
  /** The app to replace is running and must be quit first. */
  | { ok: false; reason: "running"; path: string }
  | { ok: false; reason: "error"; message: string };

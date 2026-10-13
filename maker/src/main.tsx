import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Development only, for scripted screenshots: lets a test harness load a
// project into the editor. Stripped from production builds.
if (import.meta.env.DEV) {
  void Promise.all([import("./store"), import("./model/projectFile"), import("./model/bake")]).then(([store, file, bake]) => {
    Object.assign(window, {
      __typepal: {
        loadProjectBase64: async (b64: string) => {
          const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
          store.useEditor.getState().loadProject(await file.decodeProject(bytes));
        },
        editor: store.useEditor,
        /** The project as generation would send it, base64. */
        bakedBase64: async () => {
          const baked = await bake.bakeProject(store.useEditor.getState().project);
          const bytes = file.encodeProject(baked);
          let s = "";
          for (const b of bytes) s += String.fromCharCode(b);
          return btoa(s);
        },
      },
    });
  });
}

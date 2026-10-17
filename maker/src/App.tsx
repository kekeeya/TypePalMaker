import { useCallback, useEffect, useRef, useState } from "react";
import { CanvasView, PlayIcon } from "./components/CanvasView";
import { CreateDialog, type NewPetSetup } from "./components/CreateDialog";
import { Dialog, type DialogButton } from "./components/Dialog";
import { GeneralPage } from "./components/GeneralPage";
import { Home } from "./components/Home";
import { Inspector } from "./components/Inspector";
import { NavIcon } from "./components/NavIcon";
import { Preview } from "./components/Preview";
import { Timeline } from "./components/Timeline";
import { Sparkle, TitleBar } from "./components/TitleBar";
import { issueText } from "./i18n/strings";
import { useT } from "./i18n/useT";
import { bakeProject, releaseBaked } from "./model/bake";
import { deleteDraft, listDrafts, loadDraft, saveDraft, type DraftInfo } from "./model/drafts";
import { claimProject, openElsewhere, releaseProject } from "./model/editLock";
import { decodeProject, encodeProject } from "./model/projectFile";
import { templateProject } from "./model/template";
import { emptyProject, newId, PET_STATES, type PetState, type Project } from "./model/types";
import { validate } from "./model/validate";
import { loadPlatform, type AppTarget, type GenerateResult, type Platform } from "./platform";
import { useEditor } from "./store";

interface DialogState {
  title: string;
  body?: string;
  buttons: DialogButton[];
}

type View = "home" | "general" | "animation";
const AUTOSAVE_DELAY_MS = 800;

/** A shortcut as this system writes it: ⇧⌘Z on a Mac, Ctrl+Shift+Z elsewhere. */
const onMac = !navigator.userAgent.includes("Windows");
function shortcut(key: string, shift = false) {
  return onMac ? `${shift ? "⇧" : ""}⌘${key}` : `Ctrl+${shift ? "Shift+" : ""}${key}`;
}

export function App() {
  const t = useT();
  const project = useEditor((s) => s.project);
  const revision = useEditor((s) => s.revision);
  const previewOpen = useEditor((s) => s.previewOpen);
  const selectedState = useEditor((s) => s.selectedState);
  const notice = useEditor((s) => s.notice);
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const { loadProject, selectState, setPreviewOpen, undo, redo } = useEditor.getState();

  const [view, setView] = useState<View>("home");
  const [createOpen, setCreateOpen] = useState(false);
  const [platform, setPlatform] = useState<Platform | null>(null);
  const [drafts, setDrafts] = useState<DraftInfo[]>([]);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  /** Which app is being generated, if one is. */
  const [busy, setBusy] = useState<AppTarget | null>(null);
  const [baked, setBaked] = useState<Project | null>(null);
  /** Set from the first click on 生成 App until it is done. */
  const generating = useRef(false);
  /** The revision last written to the Maker's storage. */
  const savedRevision = useRef(-1);

  const alert = useCallback(
    (title: string, body?: string) =>
      setDialog({ title, body, buttons: [{ label: t.ok, primary: true, onClick: () => setDialog(null) }] }),
    [t],
  );

  // The page's language follows the interface, for screen readers and type.
  const lang = useEditor((s) => s.lang);
  useEffect(() => {
    document.documentElement.lang = lang === "zh" ? "zh-CN" : "en";
  }, [lang]);

  useEffect(() => {
    void loadPlatform().then(async (p) => {
      setPlatform(p);
      setDrafts(await listDrafts(p));
    });
  }, []);

  const persist = useCallback(async () => {
    if (!platform) return;
    const { project: current, revision: rev } = useEditor.getState();
    if (rev === savedRevision.current) return;
    savedRevision.current = rev;
    await saveDraft(platform, current).catch((e) => console.warn("autosave failed", e));
    setDrafts(await listDrafts(platform));
  }, [platform]);

  // Another tab may have saved or deleted projects meanwhile.
  useEffect(() => {
    if (view !== "home" || !platform) return;
    const refresh = () => void listDrafts(platform).then(setDrafts);
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [view, platform]);

  // Every edit is kept a moment later, so "所有更改已自动保存" holds.
  useEffect(() => {
    if (view === "home") return;
    const timer = window.setTimeout(() => void persist(), AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [view, revision, persist]);

  /** Opens a project in the editor and keeps it among the recent ones. */
  const begin = useCallback(
    async (next: Project) => {
      // A new project is this tab's alone; an import that another tab has
      // open meanwhile becomes a copy, as one already in Recent does.
      if (!(await claimProject(next.id))) {
        next.id = newId();
        await claimProject(next.id);
      }
      loadProject(next);
      setView("general");
      void persist();
    },
    [loadProject, persist],
  );

  const goHome = async () => {
    // Saved before letting go, so another tab opening it next gets it whole.
    await persist();
    releaseProject();
    setView("home");
  };

  const create = (setup: NewPetSetup) => {
    setCreateOpen(false);
    void begin(emptyProject(setup.name, setup.canvas, setup.fps));
  };

  const fromTemplate = async () => {
    try {
      await begin(await templateProject(t.templateName));
    } catch (e) {
      alert(t.openFailed, String(e));
    }
  };

  const openDraft = async (id: string) => {
    if (!platform) return;
    if (!(await claimProject(id))) return alert(t.inUseTitle, t.inUseBody);
    try {
      const draft = await loadDraft(platform, id);
      if (!draft) throw new Error("missing");
      loadProject(draft);
      savedRevision.current = useEditor.getState().revision;
      setView("general");
    } catch {
      releaseProject();
      alert(t.openFailed);
    }
  };

  const confirmDelete = (draft: DraftInfo) =>
    setDialog({
      title: t.deleteDraftTitle(draft.name || t.untitled),
      body: t.deleteDraftBody,
      buttons: [
        { label: t.cancel, onClick: () => setDialog(null) },
        {
          label: t.deleteDraft,
          primary: true,
          onClick: async () => {
            setDialog(null);
            if (!platform) return;
            if (await openElsewhere(draft.id)) return alert(t.inUseTitle, t.inUseBody);
            await deleteDraft(platform, draft.id);
            setDrafts(await listDrafts(platform));
          },
        },
      ],
    });

  const importProject = useCallback(async () => {
    if (!platform) return;
    try {
      const picked = await platform.openProject(t.projectFiles);
      if (!picked) return;
      const project = await decodeProject(picked.bytes);
      // A project already in Recent keeps its own copy: an older export
      // brought in again becomes a separate project instead of replacing it.
      if (drafts.some((d) => d.id === project.id)) project.id = newId();
      await begin(project);
    } catch {
      alert(t.openFailed);
    }
  }, [platform, begin, alert, t, drafts]);

  const save = useCallback(async () => {
    if (!platform) return;
    const p = useEditor.getState().project;
    try {
      await platform.saveProject(encodeProject(p), p.name || t.untitled, t.projectFiles);
    } catch (e) {
      alert(t.exportFailed, String(e));
    }
  }, [platform, alert, t]);

  const generate = useCallback(
    async (overwrite = false, chosenDir?: string, target: AppTarget = "mac") => {
      if (!platform) return;
      if (!platform.generateApp) return;
      const p = useEditor.getState().project;
      const issues = validate(p);
      if (issues.length) return alert(t.failedTitle, issues.map((i) => `• ${issueText(t, i)}`).join("\n"));
      // One generation at a time, from the first click on: a quick second
      // click must not open another folder dialog.
      if (generating.current) return;
      generating.current = true;

      let outDir: string | null = null;
      let result: GenerateResult | null = null;
      try {
        // Where to put it: asked each time on the desktop (a retry to replace
        // keeps the answer); the web downloads it instead.
        if (platform.chooseOutputDir) {
          outDir = chosenDir ?? (await platform.chooseOutputDir(t.chooseOutputDir));
          if (!outDir) return;
        } else {
          outDir = "";
        }
        setBusy(target);
        const ready = await bakeProject(p);
        const bytes = encodeProject(ready);
        releaseBaked(ready);
        result = await platform.generateApp(bytes, { overwrite, outDir, lang: useEditor.getState().lang, target });
      } catch (e) {
        result = { ok: false, reason: "error", message: String(e) };
      } finally {
        generating.current = false;
        setBusy(null);
      }

      const dismiss = () => setDialog(null);
      if (!result) return;
      if (result.ok && platform.kind === "web") {
        alert(t.downloadedTitle, target === "windows" ? t.downloadedBodyWindows(result.path) : t.downloadedBody(result.path));
      } else if (result.ok) {
        const path = result.path;
        setDialog({
          title: t.generatedTitle,
          body: t.generatedBody(path),
          buttons: [
            {
              label: platform.system === "windows" ? t.showInFolder : t.showInFinder,
              onClick: () => (dismiss(), void platform.revealInFinder?.(path)),
            },
            { label: t.openNow, primary: true, onClick: () => (dismiss(), void platform.openApp?.(path)) },
          ],
        });
      } else if (result.reason === "exists") {
        const dir = outDir ?? undefined;
        setDialog({
          title: t.existsTitle,
          body: t.existsBody(result.path),
          buttons: [
            { label: t.cancel, onClick: dismiss },
            { label: t.replace, primary: true, onClick: () => (dismiss(), void generate(true, dir)) },
          ],
        });
      } else if (result.reason === "running") {
        alert(t.runningTitle, t.runningBody);
      } else {
        alert(t.failedTitle, result.message);
      }
    },
    [platform, alert, t],
  );

  // The preview shows exactly what the app will get: the baked pictures.
  useEffect(() => {
    if (!previewOpen) return;
    let alive = true;
    let made: Project | null = null;
    void bakeProject(useEditor.getState().project).then((p) => {
      made = p;
      if (alive) setBaked(p);
      else releaseBaked(p);
    });
    return () => {
      alive = false;
      setBaked(null);
      if (made) releaseBaked(made);
    };
  }, [previewOpen]);

  // A reaction switched off has no page; if it was showing, go to 通用.
  const shownStateOff = view === "animation" && !project.states[selectedState].enabled;
  useEffect(() => {
    if (shownStateOff) setView("general");
  }, [shownStateOff]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || dialog || previewOpen || createOpen) return;
      const typing = e.target instanceof HTMLInputElement && e.target.type === "text";
      if (e.key.toLowerCase() === "z" && view !== "home" && !typing) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (e.key === "s" && view !== "home") {
        e.preventDefault();
        void save();
      } else if (e.key === "o") {
        e.preventDefault();
        void importProject();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save, importProject, dialog, previewOpen, createOpen, view, undo, redo]);

  // Files dropped outside the timeline must not navigate away.
  useEffect(() => {
    const block = (e: DragEvent) => e.preventDefault();
    window.addEventListener("dragover", block);
    window.addEventListener("drop", block);
    return () => {
      window.removeEventListener("dragover", block);
      window.removeEventListener("drop", block);
    };
  }, []);

  const openState = (state: PetState) => {
    selectState(state);
    setView("animation");
  };

  return (
    <div className={`app view-${view}`}>
      <TitleBar onHome={goHome} showLanguage={view === "home"} windowControls={platform?.kind === "desktop" && platform.system === "windows"} />
      {view === "home" ? (
        <Home
          platform={platform}
          drafts={drafts}
          onCreate={() => setCreateOpen(true)}
          onTemplate={() => void fromTemplate()}
          onImport={() => void importProject()}
          onOpenDraft={(id) => void openDraft(id)}
          onDeleteDraft={confirmDelete}
        />
      ) : (
        <>
          <header className="editor-head">
            <button className="back-link" onClick={goHome}>
              <svg viewBox="0 0 6 10" aria-hidden="true">
                <path d="M5 1 1 5l4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              {t.backHome}
            </button>
            <div className="project-heading">
              <b>
                <i className="status-dot" />
                {project.name || t.untitled}
              </b>
              <small>{t.autosaved}</small>
            </div>
            <div className="history-buttons">
              <button className="history-button" aria-label={t.undo} title={`${t.undo} ${shortcut("Z")}`} disabled={!canUndo} onClick={undo}>
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d="M5.5 3.5 2.5 6.5l3 3M3 6.5h6.5a4 4 0 0 1 0 8H7" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <button className="history-button" aria-label={t.redo} title={`${t.redo} ${shortcut("Z", true)}`} disabled={!canRedo} onClick={redo}>
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path d="m10.5 3.5 3 3-3 3M13 6.5H6.5a4 4 0 0 0 0 8H9" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
            <div className="editor-actions">
              <button className="action action-save" onClick={() => void save()}>
                <span className="action-icon">⌘</span>
                {t.exportProject}
              </button>
              <button className="action action-preview" onClick={() => setPreviewOpen(true)}>
                <span className="action-icon">
                  <PlayIcon />
                </span>
                {t.previewPet}
              </button>
              {platform?.kind === "web" ? (
                // The web makes either; the desktop Maker only its own system's.
                (["mac", "windows"] as const).map((target) => (
                  <button key={target} className="action action-generate" disabled={busy !== null} onClick={() => void generate(false, undefined, target)}>
                    <span className="action-icon">
                      <Sparkle />
                    </span>
                    {busy === target ? t.generating : target === "mac" ? t.generateMac : t.generateWindows}
                  </button>
                ))
              ) : (
                <button className="action action-generate" disabled={busy !== null} onClick={() => void generate()}>
                  <span className="action-icon">
                    <Sparkle />
                  </span>
                  {busy ? t.generating : platform?.system === "windows" ? t.generatePet : t.generate}
                </button>
              )}
            </div>
          </header>
          <div className="editor-body">
            <nav className="editor-nav">
              <button className={view === "general" ? "active" : ""} onClick={() => setView("general")}>
                <NavIcon kind="general" />
                <b>{t.general}</b>
              </button>
              {PET_STATES.filter((state) => project.states[state].enabled).map((state) => (
                <button
                  key={state}
                  className={view === "animation" && selectedState === state ? "active" : ""}
                  onClick={() => openState(state)}
                >
                  <NavIcon kind={state} />
                  <b>{t.stateNames[state]}</b>
                </button>
              ))}
            </nav>
            {view === "general" ? (
              <GeneralPage onOpenState={openState} />
            ) : (
              <main className="animation-page">
                <CanvasView key={selectedState} />
                <Inspector />
                <Timeline />
              </main>
            )}
          </div>
        </>
      )}

      {createOpen && <CreateDialog onCancel={() => setCreateOpen(false)} onCreate={create} />}
      {previewOpen && baked && <Preview project={baked} />}
      {notice && !dialog && (
        <Dialog title={notice.title} buttons={[{ label: t.ok, primary: true, onClick: () => useEditor.getState().setNotice(null) }]}>
          {notice.body && <p style={{ whiteSpace: "pre-line" }}>{notice.body}</p>}
        </Dialog>
      )}
      {dialog && (
        <Dialog title={dialog.title} buttons={dialog.buttons}>
          {dialog.body && <p style={{ whiteSpace: "pre-line" }}>{dialog.body}</p>}
        </Dialog>
      )}
    </div>
  );
}

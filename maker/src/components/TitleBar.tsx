import { useEffect, useRef, useState } from "react";
import type { Lang } from "../i18n/strings";
import { useT } from "../i18n/useT";
import { useEditor } from "../store";

/**
 * The window's top bar: the TypePal Maker wordmark and the language menu.
 * In the Mac desktop Maker the window's own traffic lights sit in the empty
 * left column (overlay title bar); the Windows one has no system title bar,
 * so its minimise / maximise / close buttons are drawn at the right. Either
 * way the bar drags the window.
 */
export function TitleBar({
  onHome,
  showLanguage,
  windowControls = false,
}: {
  onHome: () => void;
  showLanguage: boolean;
  windowControls?: boolean;
}) {
  return (
    <div className={windowControls ? "titlebar with-controls" : "titlebar"} data-tauri-drag-region>
      <div data-tauri-drag-region />
      <button className="wordmark" onClick={onHome}>
        <span className="wordmark-type">Type</span>
        <span className="wordmark-pal">Pal</span>
        <b>MAKER</b>
        <Sparkle className="wordmark-spark" />
      </button>
      <div className="titlebar-end" data-tauri-drag-region>
        {showLanguage && <LanguageMenu />}
        {windowControls && <WindowControls />}
      </div>
    </div>
  );
}

/** Windows' caption buttons, in its own shapes and hover colours. */
function WindowControls() {
  const t = useT();
  const [win, setWin] = useState<import("@tauri-apps/api/window").Window | null>(null);
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let stop: (() => void) | undefined;
    let cancelled = false;
    void import("@tauri-apps/api/window").then(async ({ getCurrentWindow }) => {
      const current = getCurrentWindow();
      if (cancelled) return;
      setWin(current);
      setMaximized(await current.isMaximized());
      stop = await current.onResized(async () => setMaximized(await current.isMaximized()));
    });
    return () => {
      cancelled = true;
      stop?.();
    };
  }, []);

  return (
    <div className="window-controls">
      <button className="window-control" aria-label={t.minimize} title={t.minimize} onClick={() => void win?.minimize()}>
        <svg viewBox="0 0 10 10" aria-hidden="true">
          <path d="M0 5h10" />
        </svg>
      </button>
      <button
        className="window-control"
        aria-label={maximized ? t.restore : t.maximize}
        title={maximized ? t.restore : t.maximize}
        onClick={() => void win?.toggleMaximize()}
      >
        <svg viewBox="0 0 10 10" aria-hidden="true">
          {maximized ? <path d="M2.5 2.5V.5h7v7h-2M.5 2.5h7v7h-7z" /> : <path d="M.5.5h9v9h-9z" />}
        </svg>
      </button>
      <button className="window-control close" aria-label={t.closeWindow} title={t.closeWindow} onClick={() => void win?.close()}>
        <svg viewBox="0 0 10 10" aria-hidden="true">
          <path d="M.5.5l9 9M9.5.5l-9 9" />
        </svg>
      </button>
    </div>
  );
}

/** A small TypePal-styled listbox. Native selects cannot match the rounded,
 *  illustrated controls used by the rest of the Maker. */
function LanguageMenu() {
  const t = useT();
  const lang = useEditor((s) => s.lang);
  const setLang = useEditor((s) => s.setLang);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const escape = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    window.addEventListener("pointerdown", outside);
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("pointerdown", outside);
      window.removeEventListener("keydown", escape);
    };
  }, [open]);

  return (
    <div className="lang-menu" ref={root}>
      <button
        className="lang-trigger"
        aria-label={t.language}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="lang-mark"><i>文</i><i>EN</i></span>
        <b>{t.langNames[lang]}</b>
        <Chevron />
      </button>
      {open && (
        <div className="lang-popover" role="listbox" aria-label={t.language}>
          {(Object.keys(t.langNames) as Lang[]).map((option) => (
            <button
              key={option}
              role="option"
              aria-selected={option === lang}
              className={option === lang ? "selected" : ""}
              onClick={() => {
                setLang(option);
                setOpen(false);
              }}
            >
              <span className={`lang-option-mark mark-${option}`}>{option === "zh" ? "文" : "EN"}</span>
              <b>{t.langNames[option]}</b>
              {option === lang && <span className="lang-check">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function Sparkle({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 20 20" aria-hidden="true">
      <path d="M10 0c.7 5.3 4.7 9.3 10 10-5.3.7-9.3 4.7-10 10-.7-5.3-4.7-9.3-10-10C5.3 9.3 9.3 5.3 10 0Z" fill="currentColor" />
    </svg>
  );
}

export function Chevron() {
  return (
    <svg className="chevron" viewBox="0 0 10 6" aria-hidden="true">
      <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

import { useEffect, useRef, useState } from "react";
import type { Lang } from "../i18n/strings";
import { useT } from "../i18n/useT";
import { useEditor } from "../store";

/**
 * The window's top bar: the TypePal Maker wordmark and the language menu.
 * In the desktop Maker the window's own traffic lights sit in the empty
 * left column (overlay title bar), and the bar drags the window.
 */
export function TitleBar({ onHome, showLanguage }: { onHome: () => void; showLanguage: boolean }) {
  return (
    <div className="titlebar" data-tauri-drag-region>
      <div />
      <button className="wordmark" onClick={onHome}>
        <span className="wordmark-type">Type</span>
        <span className="wordmark-pal">Pal</span>
        <b>MAKER</b>
        <Sparkle className="wordmark-spark" />
      </button>
      {showLanguage && <LanguageMenu />}
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

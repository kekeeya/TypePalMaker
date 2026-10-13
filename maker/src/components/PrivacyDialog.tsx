import { useEffect } from "react";
import { POLICY, POLICY_TITLE } from "../i18n/privacy";
import { useT } from "../i18n/useT";
import { useEditor } from "../store";

/** The privacy policy: title, × top-right, scrolling selectable text. */
export function PrivacyDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const lang = useEditor((s) => s.lang);
  const sections = POLICY[lang];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="overlay" role="dialog" aria-modal="true" onClick={onClose}>
      <div className="policy-dialog" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="dialog-close" aria-label={t.close} onClick={onClose}>
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <path d="M2 2l6 6M8 2 2 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
        <h2>{POLICY_TITLE[lang]}</h2>
        <div className="policy-body">
          {sections.map((section, i) => (
            <section key={i} className={i === sections.length - 1 ? "policy-closing" : undefined}>
              {section.heading && <h3>{section.heading}</h3>}
              <p>{section.body}</p>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}

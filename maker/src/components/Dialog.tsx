import { useEffect, type ReactNode } from "react";

export interface DialogButton {
  label: string;
  primary?: boolean;
  onClick: () => void;
}

/** A small centred modal: title, text, buttons. Esc picks the last
 *  non-primary button (the "cancel"), Return the primary one. */
export function Dialog({ title, children, buttons }: { title: string; children?: ReactNode; buttons: DialogButton[] }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") [...buttons].reverse().find((b) => !b.primary)?.onClick();
      if (e.key === "Enter") buttons.find((b) => b.primary)?.onClick();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [buttons]);

  return (
    <div className="overlay" role="dialog" aria-modal="true">
      <div className="dialog">
        <h2>{title}</h2>
        {children && <div className="dialog-body">{children}</div>}
        <div className="dialog-buttons">
          {buttons.map((b) => (
            <button key={b.label} className={b.primary ? "primary" : ""} onClick={b.onClick}>
              {b.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

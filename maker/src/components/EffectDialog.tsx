import { useEffect } from "react";
import { useT } from "../i18n/useT";
import { assetUrl, EFFECT_KINDS, type BuiltInEffect } from "../model/template";

/** "新增内置特效": a dialog like "新建一只桌宠", listing the built-in
 *  effects as buttons with their names underneath. Choosing one adds it;
 *  the × or Esc adds nothing. */
export function EffectDialog({
  busy,
  onCancel,
  onPick,
}: {
  busy: boolean;
  onCancel: () => void;
  onPick: (effect: BuiltInEffect) => void;
}) {
  const t = useT();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label={t.addBuiltInEffect}>
      <div className="create-dialog effect-dialog">
        <button type="button" className="dialog-close" aria-label={t.close} onClick={onCancel}>
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <path d="M2 2l6 6M8 2 2 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
        <h2>{t.addBuiltInEffect}</h2>
        <div className="effect-grid">
          {EFFECT_KINDS.map((effect) => (
            <button key={effect} className="effect-tile" disabled={busy} onClick={() => onPick(effect)}>
              <span className="effect-tile-art" style={{ backgroundImage: `url(${assetUrl(`${effect}-effect-icon.png`)})` }} />
              <b>{t.effectNames[effect]}</b>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

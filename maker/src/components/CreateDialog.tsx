import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n/useT";
import { HERO_URL } from "../model/template";
import { CANVAS_LIMITS, clamp, DEFAULT_CANVAS, DEFAULT_FPS, FPS_OPTIONS, type Canvas } from "../model/types";
import { Chevron, Sparkle } from "./TitleBar";

export interface NewPetSetup {
  name: string;
  canvas: Canvas;
  fps: number;
}

/** "新建一只桌宠": the pet's name, canvas size and frame rate. The canvas is
 *  always Retina (144 dpi): the default size on the desktop is half its pixels
 *  in points, and the pet's own size slider does the rest. */
export function CreateDialog({ onCancel, onCreate }: { onCancel: () => void; onCreate: (setup: NewPetSetup) => void }) {
  const t = useT();
  const [fpsOpen, setFpsOpen] = useState(false);
  const fpsMenu = useRef<HTMLDivElement>(null);
  // Kept as typed, so a field can be cleared while editing; limits apply on
  // the way out.
  const [form, setForm] = useState({
    name: t.untitled,
    width: String(DEFAULT_CANVAS.width),
    height: String(DEFAULT_CANVAS.height),
    fps: String(DEFAULT_FPS),
  });
  const submit = () =>
    onCreate({
      name: form.name.trim() || t.untitled,
      canvas: {
        width: clamp(Number(form.width), CANVAS_LIMITS.min, CANVAS_LIMITS.max),
        height: clamp(Number(form.height), CANVAS_LIMITS.min, CANVAS_LIMITS.max),
        dpi: DEFAULT_CANVAS.dpi,
      },
      fps: Number(form.fps),
    });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (fpsOpen) setFpsOpen(false);
      else onCancel();
    };
    const outside = (e: PointerEvent) => {
      if (!fpsMenu.current?.contains(e.target as Node)) setFpsOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", outside);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", outside);
    };
  }, [onCancel, fpsOpen]);

  /** A choice from a short list, shown like the number fields. */
  const choice = (key: "fps", label: string, unit: string, options: readonly number[]) => (
    <div className="field">
      <span>{label}</span>
      <div className="choice-menu" ref={fpsMenu}>
        <button
          type="button"
          className={`unit-input choice-trigger${fpsOpen ? " open" : ""}`}
          aria-haspopup="listbox"
          aria-expanded={fpsOpen}
          onClick={() => setFpsOpen((value) => !value)}
        >
          <b>{form[key]}</b>
          <span className="unit-suffix">{unit}</span>
          <Chevron />
        </button>
        {fpsOpen && (
          <div className="choice-popover" role="listbox" aria-label={label}>
            {options.map((option) => {
              const selected = String(option) === form[key];
              return (
                <button
                  type="button"
                  key={option}
                  role="option"
                  aria-selected={selected}
                  className={selected ? "selected" : ""}
                  onClick={() => {
                    setForm((f) => ({ ...f, [key]: String(option) }));
                    setFpsOpen(false);
                  }}
                >
                  <b>{option}</b><span>{unit}</span>{selected && <i>✓</i>}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );

  const number = (key: "width" | "height", label: string, unit: string, limits: { min: number; max: number }) => (
    <label className="field">
      <span>{label}</span>
      <div className="unit-input">
        <input
          inputMode="numeric"
          value={form[key]}
          min={limits.min}
          max={limits.max}
          onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value.replace(/[^\d]/g, "") }))}
          onBlur={() => setForm((f) => ({ ...f, [key]: String(clamp(Number(f[key]), limits.min, limits.max)) }))}
        />
        <i className="unit-suffix">{unit}</i>
      </div>
    </label>
  );

  return (
    <div className="overlay" role="dialog" aria-modal="true">
      <form
        className="create-dialog"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <button type="button" className="dialog-close" aria-label={t.close} onClick={onCancel}>
          <svg viewBox="0 0 10 10" aria-hidden="true">
            <path d="M2 2l6 6M8 2 2 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
        </button>
        <img className="create-mascot" src={HERO_URL} alt="" draggable={false} />
        <h2>{t.createTitle}</h2>
        <label className="field">
          <span>{t.projectName}</span>
          <input
            className="name-input"
            value={form.name}
            maxLength={40}
            autoFocus
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
        </label>
        <div className="size-row">
          {number("width", t.width, "px", CANVAS_LIMITS)}
          <b aria-hidden="true">×</b>
          {number("height", t.height, "px", CANVAS_LIMITS)}
        </div>
        <div className="rate-row">
          {choice("fps", t.frameRate, "fps", FPS_OPTIONS)}
        </div>
        <div className="dialog-actions">
          <button type="button" className="soft-button" onClick={onCancel}>
            {t.cancel}
          </button>
          <button type="submit" className="primary-button">
            {t.startCreating} <Sparkle className="button-spark" />
          </button>
        </div>
      </form>
    </div>
  );
}

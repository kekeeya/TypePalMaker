import { useRef, useState } from "react";
import { useT } from "../i18n/useT";
import { importNotice } from "../i18n/strings";
import { IMAGE_ACCEPT, importFiles } from "../model/imageImport";
import { DEFAULT_ICON_STYLE, loops, PET_STATES, type FrameAsset, type PetState } from "../model/types";
import { useEditor } from "../store";
import { IconDialog, IconPreview, useCrop, useIconSource } from "./IconDialog";
import { NavIcon } from "./NavIcon";
import { Stepper } from "./Stepper";
import { pickImages } from "./pickImages";

/** "通用": the pet's name and icon, and which reactions it has. */
export function GeneralPage({ onOpenState }: { onOpenState: (state: PetState) => void }) {
  const t = useT();
  const project = useEditor((s) => s.project);
  const { setName, setIcon, setEnabled, setSleepAfterMinutes } = useEditor.getState();
  const iconInput = useRef<HTMLInputElement>(null);
  /** The icon being adjusted: a freshly chosen picture, or the current one. */
  const [adjusting, setAdjusting] = useState<{ picked?: FrameAsset } | null>(null);
  const source = useIconSource(project);

  /** A picked picture opens the icon dialog; problems are explained. */
  const chooseIcon = async (files: File[]) => {
    const result = await importFiles(files);
    const notice = importNotice(t, result);
    if (notice) useEditor.getState().setNotice(notice);
    const [first] = result.frames;
    if (first) setAdjusting({ picked: first.asset });
  };
  // Idle is framed without its transparent margin.
  const crop = useCrop(source, !project.icon);

  return (
    <main className="general-page">
      <div className="general-inner">
        <h1>{t.general}</h1>
        <section className="settings-card">
          <div className="settings-heading">
            <NavIcon kind="general" />
            <h2>{t.basicInfo}</h2>
          </div>
          <div className="settings-content">
            <label className="field">
              <span>{t.petName}</span>
              <input className="wide-input" value={project.name} maxLength={40} onChange={(e) => setName(e.target.value)} />
            </label>
            <div className="icon-setting">
              <button className="app-icon" aria-label={t.iconTitle} onClick={() => setAdjusting({})}>
                <IconPreview source={source} crop={crop} style={project.iconStyle} side={82} />
              </button>
              <b>{t.appIcon}</b>
              <button
                className="soft-button small"
                onClick={async () => {
                  const files = await pickImages({ multiple: false, label: t.imageFiles, fallback: () => iconInput.current?.click() });
                  if (files?.length) void chooseIcon(files);
                }}
              >
                {t.chooseImage}
              </button>
            </div>
            <input
              ref={iconInput}
              type="file"
              hidden
              accept={IMAGE_ACCEPT}
              onChange={(e) => {
                void chooseIcon(Array.from(e.target.files ?? []));
                e.target.value = "";
              }}
            />
          </div>
        </section>
        <section className="settings-card">
          <div className="settings-heading">
            <NavIcon kind="idle" />
            <h2>{t.reactions}</h2>
          </div>
          <div className="reaction-list">
            {PET_STATES.map((state) => {
              const spec = project.states[state];
              const minutes = spec.sleepAfterMinutes ?? 15;
              const actions = spec.variants?.length ?? 0;
              const hasLines = (!loops(state) && !!spec.lines?.length) || !!spec.variants?.some((v) => v.lines.length);
              return (
                <div key={state} className={`reaction-item${state === "sleep" && spec.enabled ? " sleep-open" : ""}`}>
                  <div className="reaction-row" role="button" tabIndex={0} onClick={() => onOpenState(state)} onKeyDown={(e) => e.key === "Enter" && onOpenState(state)}>
                    <NavIcon kind={state} />
                    <span className="reaction-name">
                      <b>{t.stateNames[state]}</b>
                      {(actions > 0 || hasLines) && (
                        <span className={`variant-badge${hasLines ? " with-lines" : ""}`}>{t.variantsBadge(actions, hasLines)}</span>
                      )}
                    </span>
                    {state === "idle" ? (
                      <em className="required">{t.required}</em>
                    ) : (
                      <input
                        className="switch"
                        type="checkbox"
                        role="switch"
                        aria-label={t.stateNames[state]}
                        checked={spec.enabled}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => setEnabled(state, e.target.checked)}
                      />
                    )}
                    <svg className="row-chevron" viewBox="0 0 6 10" aria-hidden="true">
                      <path d="M1 1l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                  {state === "sleep" && spec.enabled && (
                    <div className="sleep-delay">
                      <span>{t.sleepIdleFor}</span>
                      <Stepper
                        value={minutes}
                        min={1}
                        max={1440}
                        onChange={setSleepAfterMinutes}
                        label={t.minutesThenSleep}
                        fewer={t.fewerMinutes}
                        more={t.moreMinutes}
                      />
                      <span>{t.minutesThenSleep}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>
        {adjusting && (
          <IconDialog
            source={adjusting.picked ?? source}
            crop={adjusting.picked ? null : crop}
            // A new picture starts centred, keeping the background.
            initial={adjusting.picked ? { ...DEFAULT_ICON_STYLE, background: project.iconStyle.background } : project.iconStyle}
            onCancel={() => {
              if (adjusting.picked) URL.revokeObjectURL(adjusting.picked.url);
              setAdjusting(null);
            }}
            onDone={(style) => {
              setIcon(adjusting.picked ?? project.icon, style);
              setAdjusting(null);
            }}
          />
        )}
        <div className="page-actions">
          <button className="primary-button" onClick={() => onOpenState("idle")}>
            {t.nextAnimate} →
          </button>
        </div>
      </div>
    </main>
  );
}

import { closestCenter, DndContext, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { horizontalListSortingStrategy, SortableContext, useSortable } from "@dnd-kit/sortable";
import { useState } from "react";
import { useT } from "../i18n/useT";
import {
  FREQUENCIES,
  LINE_MAX_CHARS,
  LINES_PER_POOL,
  loops,
  type Frequency,
  type PetState,
  type StateVariant,
} from "../model/types";
import { useEditor } from "../store";
import { Stepper } from "./Stepper";

const PRESETS: Frequency[] = ["rare", "sometimes", "often"];

/**
 * Above a reaction's timeline: its tabs (the usual animation, then its
 * random actions) and the selected tab's settings: how often a random
 * action comes, and the lines either may say.
 */
export function VariantPanel({ state }: { state: PetState }) {
  const t = useT();
  const spec = useEditor((s) => s.project.states[state]);
  const selectedId = useEditor((s) => s.selectedVariantId);
  const { selectVariant, addVariant, moveVariant, setLines } = useEditor.getState();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const variants = spec.variants ?? [];
  const variant = variants.find((v) => v.id === selectedId) ?? null;
  const ids = variants.map((v) => v.id);

  /** The first "小动作 N" not taken. */
  const nextName = () => {
    const names = new Set(variants.map((v) => v.name));
    let n = 1;
    while (names.has(t.newVariantName(n))) n += 1;
    return t.newVariantName(n);
  };

  return (
    <div className="variant-panel">
      <div className="variant-tabs" role="tablist">
        <button role="tab" aria-selected={!variant} className={`variant-tab regular${variant ? "" : " selected"}`} onClick={() => selectVariant(null)}>
          <span className="variant-dot" aria-hidden="true" />
          {t.regularTab}
          <small>{t.regularBadge}</small>
        </button>
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={({ active, over }) => {
            if (over && active.id !== over.id) moveVariant(state, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
          }}
        >
          <SortableContext items={ids} strategy={horizontalListSortingStrategy}>
            {variants.map((v) => (
              <VariantTab key={v.id} state={state} variant={v} selected={v.id === selectedId} />
            ))}
          </SortableContext>
        </DndContext>
        <button className="variant-add" onClick={() => addVariant(state, nextName())}>
          ＋ {t.addVariant}
        </button>
      </div>
      <div className="variant-settings">
        <div className="variant-row">
          {variant ? (
            <>
              <b>{t.frequency}</b>
              <FrequencyControl key={variant.id} state={state} variant={variant} />
            </>
          ) : (
            <>
              <b>{t.regularNote}</b>
              <span className="no-frequency">{t.noFrequency}</span>
            </>
          )}
        </div>
        {/* Idle and sleep speak only in their random actions. */}
        {(variant || !loops(state)) && (
          <div className="variant-row">
            <b>{t.lines}</b>
            <LinesEditor
              key={variant?.id ?? "regular"}
              lines={variant ? variant.lines : (spec.lines ?? [])}
              onChange={(lines) => setLines(state, variant?.id ?? null, lines)}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/** A random action's tab: click to edit it, double-click to rename, × to
 *  delete (it can be undone), drag to reorder. */
function VariantTab({ state, variant, selected }: { state: PetState; variant: StateVariant; selected: boolean }) {
  const t = useT();
  const { selectVariant, renameVariant, removeVariant } = useEditor.getState();
  const [renaming, setRenaming] = useState(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: variant.id, disabled: renaming });

  return (
    <div
      ref={setNodeRef}
      className={`variant-tab${selected ? " selected" : ""}${isDragging ? " dragging" : ""}`}
      style={{ transform: transform ? `translate3d(${transform.x}px, 0, 0)` : undefined, transition }}
      {...listeners}
      aria-roledescription={attributes["aria-roledescription"]}
    >
      {renaming ? (
        <input
          className="variant-name-input"
          autoFocus
          maxLength={20}
          defaultValue={variant.name}
          aria-label={t.variantName}
          onFocus={(e) => e.target.select()}
          onBlur={(e) => {
            const name = e.target.value.trim();
            if (name) renameVariant(state, variant.id, name);
            setRenaming(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            if (e.key === "Escape") setRenaming(false);
          }}
        />
      ) : (
        <button role="tab" aria-selected={selected} onClick={() => selectVariant(variant.id)} onDoubleClick={() => setRenaming(true)}>
          {variant.name}
          {variant.lines.length > 0 && <small>{t.hasLines}</small>}
        </button>
      )}
      <button className="variant-delete" aria-label={t.deleteVariant(variant.name)} title={t.deleteVariant(variant.name)} onClick={() => removeVariant(state, variant.id)}>
        ×
      </button>
    </div>
  );
}

/** Three ready-made frequencies, or numbers of one's own: minutes between
 *  plays for a looping reaction, a chance per trigger for any other. */
function FrequencyControl({ state, variant }: { state: PetState; variant: StateVariant }) {
  const t = useT();
  const { setVariantFrequency } = useEditor.getState();
  const timed = loops(state);
  const every = variant.every ?? FREQUENCIES.every.sometimes;
  const chance = variant.chance ?? FREQUENCIES.chance.sometimes;
  const preset = PRESETS.find((f) =>
    timed ? FREQUENCIES.every[f][0] === every[0] && FREQUENCIES.every[f][1] === every[1] : FREQUENCIES.chance[f] === chance,
  );
  const [custom, setCustom] = useState(!preset);
  const set = (frequency: Pick<StateVariant, "every" | "chance">) => setVariantFrequency(state, variant.id, frequency);
  const [shortest, longest] = every.map((seconds) => Math.max(1, Math.round(seconds / 60)));

  return (
    <div className="frequency">
      <div className="segmented" role="radiogroup" aria-label={t.frequency}>
        {PRESETS.map((f) => (
          <button
            key={f}
            role="radio"
            aria-checked={preset === f}
            className={preset === f ? "on" : undefined}
            onClick={() => {
              set(timed ? { every: FREQUENCIES.every[f] } : { chance: FREQUENCIES.chance[f] });
              setCustom(false);
            }}
          >
            {t.frequencies[f]}
          </button>
        ))}
      </div>
      <button className="link-button" aria-expanded={custom} onClick={() => setCustom(!custom)}>
        {t.customFrequency}
      </button>
      {custom && (
        <div className="frequency-custom">
          {timed ? (
            <>
              {t.everyBefore}
              <Stepper
                value={shortest}
                min={1}
                max={1440}
                onChange={(m) => set({ every: [m * 60, Math.max(m, longest) * 60] })}
                label={t.shortestMinutes}
                fewer={t.less}
                more={t.more}
              />
              –
              <Stepper
                value={longest}
                min={1}
                max={1440}
                onChange={(m) => set({ every: [Math.min(m, shortest) * 60, m * 60] })}
                label={t.longestMinutes}
                fewer={t.less}
                more={t.more}
              />
              {t.everyAfter}
            </>
          ) : (
            <>
              {t.chanceBefore}
              <Stepper
                value={Math.round(chance * 100)}
                min={1}
                max={100}
                step={5}
                onChange={(p) => set({ chance: p / 100 })}
                label={t.chanceLabel}
                fewer={t.less}
                more={t.more}
              />
              {t.chanceAfter}
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Lines as chips, and a field to add one: Enter or ＋ adds it. */
function LinesEditor({ lines, onChange }: { lines: string[]; onChange: (lines: string[]) => void }) {
  const t = useT();
  const [draft, setDraft] = useState("");
  const add = () => {
    const line = draft.trim();
    if (line && !lines.includes(line)) onChange([...lines, line]);
    setDraft("");
  };
  return (
    <div className="lines">
      {lines.map((line) => (
        <span key={line} className="line-chip">
          {line}
          <button aria-label={t.deleteLine(line)} onClick={() => onChange(lines.filter((l) => l !== line))}>
            ×
          </button>
        </span>
      ))}
      {lines.length < LINES_PER_POOL && (
        <>
          <button className="line-add" aria-label={t.addLine} title={t.addLine} disabled={!draft.trim()} onClick={add}>
            ＋
          </button>
          <label className="line-input">
            <input
              value={draft}
              placeholder={t.linePlaceholder}
              aria-label={t.linePlaceholder}
              onChange={(e) => setDraft(Array.from(e.target.value).slice(0, LINE_MAX_CHARS).join(""))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) add();
                if (e.key === "Escape") setDraft("");
              }}
            />
            <small>
              {Array.from(draft).length}/{LINE_MAX_CHARS}
            </small>
          </label>
        </>
      )}
    </div>
  );
}

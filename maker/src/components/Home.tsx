import { useEffect, useRef, useState } from "react";
import { PrivacyDialog } from "./PrivacyDialog";
import { useT } from "../i18n/useT";
import { draftThumbUrl, type DraftInfo } from "../model/drafts";
import type { Platform } from "../platform";

/** Same as the pet's settings footer (player AppInfo.githubURL). */
const GITHUB_URL = "https://github.com/kekeeya/TypePalMaker";

/** The start page: create, start from the template, import, or carry on
 *  with a recent pet (newest first; two rows, then it scrolls). */
export function Home({
  platform,
  drafts,
  onCreate,
  onTemplate,
  onImport,
  onOpenDraft,
  onDeleteDraft,
}: {
  platform: Platform | null;
  drafts: DraftInfo[];
  onCreate: () => void;
  onTemplate: () => void;
  onImport: () => void;
  onOpenDraft: (id: string) => void;
  onDeleteDraft: (draft: DraftInfo) => void;
}) {
  const t = useT();
  const thumbs = useDraftThumbs(platform, drafts);
  const [policyOpen, setPolicyOpen] = useState(false);
  const grid = useRef<HTMLDivElement>(null);
  const { scrolls, above, below } = useScrolls(grid, drafts.length);
  return (
    <main className={`home${drafts.length ? " has-recent" : ""}`}>
      <span className="home-blob home-blob-yellow" aria-hidden="true" />
      <span className="home-blob home-blob-green" aria-hidden="true" />
      <div className="home-content">
        <section className="start-cards">
          <StartCard kind="create" label={t.create} onClick={onCreate} />
          <StartCard kind="template" label={t.template} onClick={onTemplate} />
          <StartCard kind="import" label={t.import} onClick={onImport} />
        </section>
        {drafts.length > 0 && (
          <section className="recent">
            <h2>{t.recent}</h2>
            <div
              className={`recent-grid${scrolls ? " scrolls" : ""}${above ? " more-above" : ""}${below ? " more-below" : ""}`}
              ref={grid}
            >
              {drafts.map((d) => (
                <div key={d.id} className="recent-item">
                  <button className="recent-card" onClick={() => onOpenDraft(d.id)}>
                    <span className="recent-art">
                      {thumbs[d.id] && <img src={thumbs[d.id]!} alt="" draggable={false} />}
                    </span>
                    <b>{d.name || t.untitled}</b>
                  </button>
                  <button className="recent-delete" aria-label={t.deleteDraft} title={t.deleteDraft} onClick={() => onDeleteDraft(d)}>
                    <svg viewBox="0 0 10 10" aria-hidden="true">
                      <path d="M2 2l6 6M8 2 2 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
      <footer className="home-footer">
        Powered by{" "}
        <button className="footer-link" onClick={() => void platform?.openLink(GITHUB_URL)}>
          keya
        </button>
        <span className="footer-sep">|</span>
        <button className="footer-link" onClick={() => setPolicyOpen(true)}>
          Privacy Policy
        </button>
      </footer>
      {policyOpen && <PrivacyDialog onClose={() => setPolicyOpen(false)} />}
    </main>
  );
}

function StartCard({ kind, label, onClick }: { kind: "create" | "template" | "import"; label: string; onClick: () => void }) {
  return (
    <button className={`start-card start-${kind}`} onClick={onClick}>
      <span className="start-icon">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          {kind === "create" && <path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" />}
          {kind === "template" && (
            <>
              {[0, 72, 144, 216, 288].map((a) => (
                <ellipse key={a} cx="12" cy="7.6" rx="2.9" ry="3.3" transform={`rotate(${a} 12 12)`} fill="currentColor" />
              ))}
              <circle cx="12" cy="12" r="2.1" fill="#ffd56f" />
            </>
          )}
          {kind === "import" && (
            <path
              d="M9.6 4.5h4.8v7h3.4L12 18.5l-5.8-7h3.4v-7Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinejoin="round"
            />
          )}
        </svg>
      </span>
      <b>{label}</b>
      <span className="start-corner" aria-hidden="true" />
    </button>
  );
}

/** Blob URLs for the cards' pictures, freed when the list changes. */
function useDraftThumbs(platform: Platform | null, drafts: DraftInfo[]) {
  const [thumbs, setThumbs] = useState<Record<string, string | null>>({});
  useEffect(() => {
    if (!platform) return;
    let alive = true;
    const made: string[] = [];
    void Promise.all(drafts.map(async (d) => [d.id, await draftThumbUrl(platform, d.id)] as const)).then((pairs) => {
      for (const [, url] of pairs) if (url) made.push(url);
      if (alive) setThumbs(Object.fromEntries(pairs));
      else made.forEach((u) => URL.revokeObjectURL(u));
    });
    return () => {
      alive = false;
      made.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [platform, drafts]);
  return thumbs;
}

/** Whether an element scrolls, and whether there is more of it above and
 *  below what shows — kept up to date as it scrolls or resizes. */
function useScrolls(ref: React.RefObject<HTMLElement | null>, count: number) {
  const [state, setState] = useState({ scrolls: false, above: false, below: false });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => {
      const scrolls = el.scrollHeight > el.clientHeight + 1;
      const next = {
        scrolls,
        above: scrolls && el.scrollTop > 1,
        below: scrolls && el.scrollTop + el.clientHeight < el.scrollHeight - 1,
      };
      setState((s) => (s.scrolls === next.scrolls && s.above === next.above && s.below === next.below ? s : next));
    };
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    el.addEventListener("scroll", check, { passive: true });
    return () => {
      observer.disconnect();
      el.removeEventListener("scroll", check);
    };
  }, [ref, count]);
  return state;
}

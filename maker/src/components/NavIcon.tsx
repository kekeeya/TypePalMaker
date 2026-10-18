import type { PetState } from "../model/types";

/** The hand-drawn icons of the side bar, one per page. */
export function NavIcon({ kind }: { kind: PetState | "general" }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return <span className={`cute-nav-icon icon-${kind}`} aria-hidden="true"><svg viewBox="0 0 40 40">
    {kind === "general" && <><path {...common} d="M20 8v4m0 16v4M8 20h4m16 0h4m-3.5-8.5-2.8 2.8m-11.4 11.4-2.8 2.8m17 0-2.8-2.8M14.3 14.3l-2.8-2.8"/><circle {...common} cx="20" cy="20" r="7"/><circle cx="20" cy="20" r="2.5" fill="currentColor"/></>}
    {kind === "idle" && <><path {...common} d="M9 24c2.5-8 19.5-8 22 0-2 5-20 5-22 0Z"/><path {...common} d="m14 22 3 2m9-2-3 2"/><path {...common} d="M18 27c1.4 1 2.6 1 4 0"/><path {...common} d="M28 10h5l-5 5h5"/></>}
    {kind === "typing" && <><rect {...common} x="7" y="20" width="26" height="11" rx="3"/><path {...common} d="M11 24h3m3 0h3m3 0h3m3 0h1M12 28h16"/><path {...common} d="M12 18c0-5 16-5 16 0"/><circle cx="17" cy="16" r="1.2" fill="currentColor"/><circle cx="23" cy="16" r="1.2" fill="currentColor"/></>}
    {kind === "mouseClick" && <><path {...common} d="m12 8 14 13-7 1-3 7-4-21Z"/><path {...common} d="m25 11 3-3m-1 8h5m-10-7V5"/><path {...common} d="m22 22 5 7"/></>}
    {kind === "tap" && <><path {...common} d="M16 29V14a3 3 0 0 1 6 0v7-3a3 3 0 0 1 6 0v7c0 5-3 8-8 8-4 0-7-2-9-6l-2-4a3 3 0 0 1 5-3l2 2"/><path {...common} d="M11 10 8 7m9 1V4m6 6 3-3"/></>}
    {kind === "pet" && <><path {...common} d="M9 12c4-5 9-1 11 2 2-3 7-7 11-2 5 6-5 14-11 18-6-4-16-12-11-18Z"/><path {...common} d="M14 17c2-2 4-2 6 0 2-2 4-2 6 0"/><path {...common} d="M17 22c2 1 4 1 6 0"/></>}
    {kind === "sleep" && <><path {...common} d="M26.5 28.5A11 11 0 1 1 18 10a9 9 0 0 0 8.5 18.5Z"/><path {...common} d="M25 9h6l-6 6h6M21 16h4l-4 4h4"/></>}
  </svg></span>;
}

import { useSyncExternalStore } from "react";

/**
 * What the Crew rail icon shows: how many things wait on Salem and whether a
 * bot is working or failed. The sidebar list publishes it (it already reads
 * needs and bot state); the icon only subscribes, so it needs no SDK context.
 */
export interface CrewSignal { needs: number; working: boolean; failed: boolean }
const EMPTY: CrewSignal = { needs: 0, working: false, failed: false };
let current = EMPTY;
const listeners = new Set<() => void>();

export function publishCrewSignal(next: CrewSignal) {
  if (next.needs === current.needs && next.working === current.working && next.failed === current.failed) return;
  current = next;
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function useCrewSignal(): CrewSignal {
  return useSyncExternalStore(subscribe, () => current, () => EMPTY);
}

/** The Crew glyph with a count of what needs Salem, or a dot while bots work. */
export function CrewRailIcon({ className }: { className?: string }) {
  const { needs, working, failed } = useCrewSignal();
  const badge = needs > 0 ? (needs > 9 ? "9+" : String(needs)) : null;
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden="true" data-crew-needs={needs} data-crew-working={working || undefined}>
      <g stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="9" cy="7" r="3" />
        <path d="M3 20v-2a6 6 0 0 1 12 0v2" />
        {badge ? null : <path d="M16 4a3 3 0 0 1 0 6M18 14a5 5 0 0 1 3 4v2" />}
      </g>
      {badge ? <g>
        <circle cx="18" cy="6.5" r="6" fill={failed ? "var(--destructive, #e5484d)" : "var(--warning, #e5484d)"} />
        <text x="18" y="9.3" textAnchor="middle" fontSize={badge.length > 1 ? 7 : 8.5} fontWeight="700" fill="#fff" fontFamily="system-ui, sans-serif">{badge}</text>
      </g> : failed ? <circle cx="19.5" cy="19.5" r="3.2" fill="var(--destructive, #e5484d)" />
        : working ? <circle className="crew-rail-working" cx="19.5" cy="19.5" r="3.2" fill="var(--info, #3b82f6)" /> : null}
    </svg>
  );
}

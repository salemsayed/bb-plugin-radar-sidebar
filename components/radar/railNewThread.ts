import { useSyncExternalStore } from "react";

/** The rail hands its New thread action to the list while its own heading is
 * hidden (no bot or crew scope), so the button sits beside the search instead
 * of costing a row. Null whenever the rail shows the heading itself. */

export interface NewThread {
  open: (openInSplit: boolean) => void;
  /** Label with the shortcut, for the tooltip. */
  label: string;
  keyShortcuts: string | undefined;
}

let handoff: NewThread | null = null;
const listeners = new Set<() => void>();

export function setRailNewThread(next: NewThread | null): void {
  if (next === handoff) return;
  handoff = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useRailNewThread(): NewThread | null {
  return useSyncExternalStore(
    subscribe,
    () => handoff,
    () => null,
  );
}

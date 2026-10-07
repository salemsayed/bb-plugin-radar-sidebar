import { useEffect, useSyncExternalStore } from "react";
import type { RosterBot } from "./bots";

/** Bot identity shared between the rail and list, remembered per client.
 * A new storage key intentionally ignores the retired project tile filter. */

const SCOPE_KEY = "radar-sidebar:rail-bot-scope:v1";

/** Scope for the crew overview: every bot's card at once, no single bot chosen. */
export const CREW_SCOPE = "__crew__";

function readScope(): string | null {
  try {
    return localStorage.getItem(SCOPE_KEY) || null;
  } catch {
    return null;
  }
}

let scope: string | null = readScope();
const listeners = new Set<() => void>();

export function setRailScope(botKey: string | null): void {
  if (botKey === scope) return;
  scope = botKey;
  try {
    if (botKey) localStorage.setItem(SCOPE_KEY, botKey);
    else localStorage.removeItem(SCOPE_KEY);
  } catch {
    // Preference simply won't persist.
  }
  for (const listener of listeners) listener();
}

/** Stable subscription prevents needless listener churn on rerenders. */
export function subscribeRailScope(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The selected bot key, or null for all threads. */
export function useRailScope(): string | null {
  return useSyncExternalStore(
    subscribeRailScope,
    () => scope,
    () => null,
  );
}

/** Disabled/empty/unavailable rosters always leave all threads accessible.
 * Keep the saved key through reloads and transient failures. */
export function useValidatedRailScope(bots: readonly RosterBot[], enabled: boolean): string | null {
  const chosen = useRailScope();
  if (!enabled) return null;
  if (chosen === CREW_SCOPE) return bots.length > 0 ? chosen : null;
  return bots.some(bot => bot.key === chosen) ? chosen : null;
}

// The list owns BB's mobile-drawer dismissal callback. Share it with the
// coordinator link in the navigation slot, without touching host DOM.
const navigationHandlers = new Set<() => void>();
export function useRailThreadNavigation(onNavigate: () => void): void {
  useEffect(() => {
    navigationHandlers.add(onNavigate);
    return () => { navigationHandlers.delete(onNavigate); };
  }, [onNavigate]);
}
export function notifyRailThreadNavigation(): void {
  for (const handler of navigationHandlers) handler();
}

/** Test hook: clear the scope and every subscriber. */
export function resetRailScope(): void {
  scope = null;
  listeners.clear();
  try {
    localStorage.removeItem(SCOPE_KEY);
  } catch {
    // Ignore.
  }
}

import { useSyncExternalStore } from "react";
import type { RosterBot } from "./bots";

/** Bot identity shared between the shortcut row and list, remembered per client.
 * A new storage key intentionally ignores the retired project tile filter. */

const SCOPE_KEY = "radar-sidebar:rail-bot-scope:v1";

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
 * Keep the saved key through reloads and transient failures; a key that names
 * no bot (such as the retired in-list Crew view) shows all threads. */
export function useValidatedRailScope(bots: readonly RosterBot[], enabled: boolean): string | null {
  const chosen = useRailScope();
  if (!enabled) return null;
  return bots.some(bot => bot.key === chosen) ? chosen : null;
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

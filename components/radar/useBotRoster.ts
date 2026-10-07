import { useEffect, useState } from "react";
import { useSdk } from "@get-bb/plugin-sdk/app";
import { rosterSchema, type RosterBot } from "./bots";

const ROSTER_PLUGIN = "orchestrator-mode";
const REFRESH_MS = 60_000;
const CACHE_KEY = "radar.botRoster.v1";
/** Consecutive failures after which the cached roster is dropped: three missed minutes is no longer a reload. */
const MAX_FAILURES = 3;

function readCache(): RosterBot[] {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? rosterSchema.parse(JSON.parse(raw)).bots : [];
  } catch {
    return [];
  }
}
function writeCache(bots: RosterBot[]): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ bots }));
  } catch {
    // Private browsing or full storage: the next load just fetches again.
  }
}
function clearCache(): void {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {
    // Ignore.
  }
}
/** The server says the roster plugin is gone (uninstalled, disabled, or missing the method): nothing to wait for. */
export function isPluginAbsentError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return /unknown plugin|has no rpc method|not installed|is disabled|plugin not found/i.test(message);
}

/**
 * The registered coordinators, from bb-salem-bots. An absent or failing plugin
 * yields an empty roster on a fresh client; a validated cached roster survives
 * transient reloads and errors, but is dropped once the plugin reports itself
 * absent or the RPC has failed MAX_FAILURES times in a row.
 */
export function useBotRoster(enabled: boolean, refreshKey = ""): RosterBot[] {
  const sdk = useSdk();
  // The last roster paints immediately, so coordinators never flash as pinned rows before the RPC answers.
  const [bots, setBots] = useState<RosterBot[]>(() => (enabled ? readCache() : []));
  useEffect(() => {
    if (!enabled) {
      setBots([]);
      return;
    }
    let cancelled = false;
    let request = 0;
    let failures = 0;
    const load = async () => {
      const current = ++request;
      try {
        const result = await sdk.plugins.callRpc({ pluginId: ROSTER_PLUGIN, method: "bot_roster", input: null, outputSchema: rosterSchema });
        if (cancelled || current !== request) return;
        failures = 0;
        setBots(result.bots);
        writeCache(result.bots);
      } catch (error) {
        if (cancelled || current !== request) return;
        // Keep a previously validated roster during transient reload/RPC failures.
        failures += 1;
        if (failures >= MAX_FAILURES || isPluginAbsentError(error)) {
          setBots([]);
          clearCache();
        }
      }
    };
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [sdk, enabled, refreshKey]);
  return bots;
}

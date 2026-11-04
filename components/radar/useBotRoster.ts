import { useBotTasks } from "./useBotTasks";
import { useEffect, useMemo, useState } from "react";
import { useSdk } from "@get-bb/plugin-sdk/app";
import { rosterSchema, type RosterBot } from "./bots";
import { useBotsPush } from "@/lib/botsPush";
import { needsChanged } from "@/lib/needsClient";

const ROSTER_PLUGIN = "orchestrator-mode";
/** A fallback: bb-salem-bots pushes each change (bb 0.47), which reloads through radar:needs-changed. */
const REFRESH_MS = 60_000;
const CACHE_KEY = "radar.botRoster.v1";

function readCache(): RosterBot[] {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? rosterSchema.parse(JSON.parse(raw)).bots.filter(bot => bot.key !== "crew") : [];
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
 * reloads, errors and a crashed plugin, and is dropped only once the plugin
 * reports itself absent.
 */
export function useBotRoster(enabled: boolean, refreshKey = ""): RosterBot[] {
  const sdk = useSdk();
  const desks = useBotTasks(enabled).data;
  useBotsPush(enabled, needsChanged);
  // The last roster paints immediately, so coordinators never flash as pinned rows before the RPC answers.
  const [bots, setBots] = useState<RosterBot[]>(() => (enabled ? readCache() : []));
  useEffect(() => {
    if (!enabled) {
      setBots([]);
      return;
    }
    let cancelled = false;
    let request = 0;
    const load = async () => {
      const current = ++request;
      try {
        const result = await sdk.plugins.callRpc({ pluginId: ROSTER_PLUGIN, method: "bot_roster", input: null, outputSchema: rosterSchema });
        if (cancelled || current !== request) return;
        const specialists = result.bots.filter(bot => bot.key !== "crew");
        // Polls return fresh objects. Equal facts must not invalidate the
        // sidebar's family filtering, grouping and row projections.
        setBots(previous => JSON.stringify(previous) === JSON.stringify(specialists) ? previous : specialists);
        writeCache(specialists);
      } catch (error) {
        if (cancelled || current !== request) return;
        if (isPluginAbsentError(error)) {
          setBots([]);
          clearCache();
        }
      }
    };
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    window.addEventListener("radar:needs-changed", onFocus);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("radar:needs-changed", onFocus);
    };
  }, [sdk, enabled, refreshKey]);
  return useMemo(() => bots.map(bot => ({ ...bot, deskThreadIds: desks?.bots.find(row => row.key === bot.key)?.desks.map(desk => desk.threadId).filter((id): id is string => !!id) ?? [] })), [bots, desks]);
}

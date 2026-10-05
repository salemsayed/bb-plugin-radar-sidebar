import { useEffect, useState } from "react";
import { useSdk } from "@get-bb/plugin-sdk/app";
import { rosterSchema, type RosterBot } from "./bots";

const ROSTER_PLUGIN = "orchestrator-mode";
const REFRESH_MS = 60_000;

/**
 * The registered coordinators, from bb-salem-bots. An absent or failing plugin
 * yields an empty roster, so the deck simply does not render.
 */
export function useBotRoster(enabled: boolean): RosterBot[] {
  const sdk = useSdk();
  const [bots, setBots] = useState<RosterBot[]>([]);
  useEffect(() => {
    if (!enabled) {
      setBots([]);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const result = await sdk.plugins.callRpc({ pluginId: ROSTER_PLUGIN, method: "bot_roster", input: null, outputSchema: rosterSchema });
        if (!cancelled) setBots(result.bots);
      } catch {
        if (!cancelled) setBots([]);
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
  }, [sdk, enabled]);
  return bots;
}

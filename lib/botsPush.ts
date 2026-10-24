import { useEffect } from "react";
import { experimental_useRpcQuery } from "@get-bb/plugin-sdk/app";
import { z } from "zod";

/**
 * bb 0.47 push refresh: bb-salem-bots bumps bots_version, tagged "bots", whenever a bot's asks, alerts or coordinators
 * change, and bb refreshes every watcher at once. Radar's roster and Needs reads keep their own loading; they only learn
 * when to load, so their fast polls become slow fallbacks.
 */
const contract = { bots_version: { input: z.null(), output: z.object({ version: z.number() }), tags: () => ["bots"] } } as const;

/** Shared by every watcher, so one change calls back once however many hooks watch. */
let lastVersion: number | null = null;

export function useBotsPush(enabled: boolean, onChange: () => void) {
  const { data } = experimental_useRpcQuery({ pluginId: "orchestrator-mode", contract, method: "bots_version", input: null, enabled });
  const version = data?.version;
  useEffect(() => {
    if (version === undefined) return;
    const changed = lastVersion !== null && version !== lastVersion;
    lastVersion = version;
    if (changed) onChange();
  }, [version, onChange]);
}

/** Test seam: forget the last version seen. */
export function resetBotsPush() { lastVersion = null; }

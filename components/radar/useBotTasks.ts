import { useSyncExternalStore } from "react";
import { useSdk } from "@get-bb/plugin-sdk/app";
import { useBotsPush } from "@/lib/botsPush";
import { NEEDS_CHANGED, needsChanged } from "@/lib/needsClient";
import { botTasksSchema, type BotTasksData } from "@/lib/botTasks";
import { createSharedRead } from "@/lib/sharedRead";
const isPluginAbsentError = (error: unknown) => /unknown plugin|has no rpc method|not installed|is disabled|plugin not found/i.test(error instanceof Error ? error.message : String(error));

const TASKS_PLUGIN = "orchestrator-mode";
/** A fallback: bb-salem-bots pushes each change (the roster's signal), which reloads through radar:needs-changed. */
export const BOT_TASKS_REFRESH_MS = 60_000;
const CACHE_KEY = "radar.botTasks.v1";
export type BotTasksStatus =
  /** Nothing loaded yet; a cached copy may already be painted. */
  | "loading"
  | "ready"
  /** The bots core has no bot_tasks (older release) or orchestrator-mode is absent. */
  | "missing"
  /** A transient failure: the last good copy stays, and the next poll retries. */
  | "error";

export interface BotTasksState {
  data: BotTasksData | null;
  status: BotTasksStatus;
  /** Whether `data` came from this device's last session rather than this load. */
  cached: boolean;
}

function readCache(): BotTasksData | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? botTasksSchema.parse(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}
function writeCache(data: BotTasksData | null): void {
  try {
    if (data) localStorage.setItem(CACHE_KEY, JSON.stringify(data));
    else localStorage.removeItem(CACHE_KEY);
  } catch {
    // Private browsing or full storage: the next load just fetches again.
  }
}

function tasksKey(data: BotTasksData): string {
  return JSON.stringify(data, (name, value: unknown) => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
    const row = value as { observedAt?: unknown; ageMs?: unknown };
    if (name === "") return { ...row, observedAt: undefined };
    if (typeof row.observedAt === "number" && typeof row.ageMs === "number") return { ...row, observedAt: undefined, ageMs: undefined, startedAt: row.observedAt - row.ageMs };
    return value;
  });
}
let latestSdk: ReturnType<typeof useSdk> | null = null;
const tasks = createSharedRead<BotTasksData>({
  load: () => latestSdk!.plugins.callRpc({ pluginId: TASKS_PLUGIN, method: "bot_tasks", input: {}, outputSchema: botTasksSchema }),
  readCache,
  writeCache,
  absent: isPluginAbsentError,
  refreshMs: BOT_TASKS_REFRESH_MS,
  events: ["focus", NEEDS_CHANGED],
  key: tasksKey,
});
const IDLE: BotTasksState = { data: null, status: "loading", cached: false };
const idleState = () => IDLE;
const idleSubscribe = () => () => {};

/**
 * Every bot's tasks from orchestrator-mode `bot_tasks`. Refreshes on the same
 * push the roster and Needs use (bots_version), on focus and after Radar's
 * own changes; a slow poll is the fallback. A missing RPC is reported as
 * "missing" so the view can say so instead of showing an empty list.
 */
export function useBotTasks(enabled: boolean): BotTasksState {
  latestSdk = useSdk();
  useBotsPush(enabled, needsChanged);
  return useSyncExternalStore(enabled ? tasks.subscribe : idleSubscribe, enabled ? tasks.get : idleState);
}

export function refreshBotTasks(): Promise<void> {
  return tasks.refresh();
}

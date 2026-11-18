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

function readCache(key: string): BotTasksData | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? botTasksSchema.parse(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}
function writeCache(key: string, data: BotTasksData | null): void {
  try {
    if (data) localStorage.setItem(key, JSON.stringify(data));
    else localStorage.removeItem(key);
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
function tasksRead(bot?: string, sidebar = false) {
  const cacheKey = sidebar ? "radar.botSidebar.v1" : bot ? `${CACHE_KEY}.${bot}` : CACHE_KEY;
  return createSharedRead<BotTasksData>({
    load: async () => {
      if (sidebar) {
        try { return await latestSdk!.plugins.callRpc({ pluginId: TASKS_PLUGIN, method: "bot_sidebar", input: {}, outputSchema: botTasksSchema }); }
        catch (error) { if (!/unknown.*method|has no rpc method|method.*not found/i.test(String(error))) throw error; }
      }
      return latestSdk!.plugins.callRpc({ pluginId: TASKS_PLUGIN, method: "bot_tasks", input: bot ? { bot } : {}, outputSchema: botTasksSchema });
    },
    readCache: () => readCache(cacheKey),
    writeCache: data => writeCache(cacheKey, data),
    absent: isPluginAbsentError,
    refreshMs: BOT_TASKS_REFRESH_MS,
    events: ["focus", NEEDS_CHANGED],
    key: tasksKey,
  });
}
const fleet = tasksRead();
const sidebar = tasksRead(undefined, true);
const scoped = new Map<string, ReturnType<typeof tasksRead>>();
function readFor(bot?: string) {
  if (!bot) return fleet;
  let read = scoped.get(bot);
  if (!read) { read = tasksRead(bot); scoped.set(bot, read); }
  return read;
}
const IDLE: BotTasksState = { data: null, status: "loading", cached: false };
const idleState = () => IDLE;
const idleSubscribe = () => () => {};

/**
 * Every bot's tasks from orchestrator-mode `bot_tasks`. Refreshes on the same
 * push the roster and Needs use (bots_version), on focus and after Radar's
 * own changes; a slow poll is the fallback. A missing RPC is reported as
 * "missing" so the view can say so instead of showing an empty list.
 */
export function useBotTasks(enabled: boolean, bot?: string): BotTasksState {
  return useTasksRead(enabled, readFor(bot));
}

export function useBotSidebar(enabled: boolean): BotTasksState {
  return useTasksRead(enabled, sidebar);
}

export const refreshBotSidebar = () => sidebar.refresh();

function useTasksRead(enabled: boolean, tasks: typeof fleet): BotTasksState {
  latestSdk = useSdk();
  useBotsPush(enabled, needsChanged);
  return useSyncExternalStore(enabled ? tasks.subscribe : idleSubscribe, enabled ? tasks.get : idleState);
}

export function refreshBotTasks(bot?: string): Promise<void> {
  return readFor(bot).refresh();
}

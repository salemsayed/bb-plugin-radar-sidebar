import { useEffect, useState } from "react";
import { useSdk } from "@get-bb/plugin-sdk/app";
import { useBotsPush } from "@/lib/botsPush";
import { NEEDS_CHANGED, needsChanged } from "@/lib/needsClient";
import { botTasksSchema, type BotTasksData } from "@/lib/botTasks";
import { isPluginAbsentError } from "./useBotRoster";

const TASKS_PLUGIN = "orchestrator-mode";
/** A fallback: bb-salem-bots pushes each change (the roster's signal), which reloads through radar:needs-changed. */
export const BOT_TASKS_REFRESH_MS = 60_000;
const CACHE_KEY = "radar.botTasks.v1";
let pending: Promise<BotTasksData> | null = null;
function loadTasks(sdk: ReturnType<typeof useSdk>) {
  if (!pending) {
    pending = sdk.plugins.callRpc({ pluginId: TASKS_PLUGIN, method: "bot_tasks", input: {}, outputSchema: botTasksSchema });
    queueMicrotask(() => { pending = null; });
  }
  return pending;
}

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

/**
 * Every bot's tasks from orchestrator-mode `bot_tasks`. Refreshes on the same
 * push the roster and Needs use (bots_version), on focus and after Radar's
 * own changes; a slow poll is the fallback. A missing RPC is reported as
 * "missing" so the view can say so instead of showing an empty list.
 */
export function useBotTasks(enabled: boolean): BotTasksState {
  const sdk = useSdk();
  useBotsPush(enabled, needsChanged);
  const [state, setState] = useState<BotTasksState>(() => {
    const cached = enabled ? readCache() : null;
    return { data: cached, status: "loading", cached: cached !== null };
  });
  useEffect(() => {
    if (!enabled) {
      setState({ data: null, status: "loading", cached: false });
      return;
    }
    let cancelled = false;
    let request = 0;
    const load = async () => {
      const current = ++request;
      try {
        const data = await loadTasks(sdk);
        if (cancelled || current !== request) return;
        writeCache(data);
        setState(previous => previous.status === "ready" && JSON.stringify(previous.data) === JSON.stringify(data)
          ? previous
          : { data, status: "ready", cached: false });
      } catch (error) {
        if (cancelled || current !== request) return;
        if (isPluginAbsentError(error)) {
          writeCache(null);
          setState({ data: null, status: "missing", cached: false });
        } else {
          setState(previous => ({ ...previous, status: "error" }));
        }
      }
    };
    const reload = () => void load();
    void load();
    const timer = setInterval(reload, BOT_TASKS_REFRESH_MS);
    window.addEventListener("focus", reload);
    window.addEventListener(NEEDS_CHANGED, reload);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("focus", reload);
      window.removeEventListener(NEEDS_CHANGED, reload);
    };
  }, [sdk, enabled]);
  return state;
}

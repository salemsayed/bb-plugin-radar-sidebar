import { useCallback, useEffect, useRef, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { needsListSchema, needsRpcContract, openNeeds, type NeedsItem } from "./needs";
import { useBotsPush } from "./botsPush";

export const NEEDS_CHANGED = "radar:needs-changed";
const CACHE_KEY = "radar-sidebar:needs-cache:v1";

function cachedNeeds(): NeedsItem[] | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    const parsed = raw ? needsListSchema.safeParse(JSON.parse(raw)) : null;
    return parsed?.success ? openNeeds(parsed.data.items) : null;
  } catch { return null; }
}

function saveNeeds(items: readonly NeedsItem[]) {
  try { localStorage.setItem(CACHE_KEY, JSON.stringify({ items })); } catch { return; }
}
export function needsChanged() { window.dispatchEvent(new Event(NEEDS_CHANGED)); }

/** Reloads when bb-salem-bots pushes a change (bb 0.47) and after a reminder or row action; a slow poll is the fallback. */
export function useNeedsYou(enabled = true) {
  const rpc = useRpc<typeof needsRpcContract>();
  useBotsPush(enabled, needsChanged);
  const [items, setItems] = useState<NeedsItem[] | null>(() => enabled ? cachedNeeds() : null);
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable">("loading");
  const generation = useRef(0);
  useEffect(() => {
    if (!enabled) { setItems(null); setStatus("loading"); return; }
    let cancelled = false;
    const load = async () => {
      const request = ++generation.current;
      try {
        const result = await rpc.call("crew_needs_list", {});
        if (!cancelled && request === generation.current) {
          setItems(result.items === null ? null : openNeeds(result.items));
          if (result.items !== null) saveNeeds(result.items);
          setStatus(result.items === null ? "unavailable" : "ready");
        }
      } catch { if (!cancelled && request === generation.current) { setItems(null); setStatus("unavailable"); } }
    };
    const reload = () => { void load(); };
    void load();
    const timer = setInterval(reload, 120_000);
    window.addEventListener("focus", reload);
    window.addEventListener(NEEDS_CHANGED, reload);
    return () => { cancelled = true; clearInterval(timer); window.removeEventListener("focus", reload); window.removeEventListener(NEEDS_CHANGED, reload); };
  }, [rpc, enabled]);
  const update = useCallback(async (id: string, action: "done" | "snooze" | "reopen", until?: string) => {
    const result = await rpc.call("crew_needs_update", { id, action, ...(until ? { until } : {}) });
    ++generation.current;
    setItems(previous => openNeeds([...(previous ?? []).filter(item => item.id !== id), result.item]));
    setStatus("ready");
    needsChanged();
  }, [rpc]);
  return { items, status, update };
}

export type NeedsYouData = ReturnType<typeof useNeedsYou>;

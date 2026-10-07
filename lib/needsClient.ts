import { useCallback, useEffect, useRef, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { needsRpcContract, openNeeds, type NeedsItem, type NeedsSeen } from "./needs";

export const NEEDS_CHANGED = "radar:needs-changed";
export function needsChanged() { window.dispatchEvent(new Event(NEEDS_CHANGED)); }

/**
 * Short polling plus immediate refresh after a reminder or row action. `seen`
 * marks, by item id, saved decisions Salem replied to since they were saved
 * without the resolver confirming the answer: "reply seen, not confirmed".
 */
export function useNeedsYou(enabled = true) {
  const rpc = useRpc<typeof needsRpcContract>();
  const [items, setItems] = useState<NeedsItem[] | null>(null);
  const [seen, setSeen] = useState<NeedsSeen>({});
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable">("loading");
  const generation = useRef(0);
  useEffect(() => {
    if (!enabled) { setItems(null); setSeen({}); setStatus("loading"); return; }
    let cancelled = false;
    const load = async () => {
      const request = ++generation.current;
      try {
        const result = await rpc.call("crew_needs_list", {});
        if (!cancelled && request === generation.current) {
          setItems(result.items === null ? null : openNeeds(result.items));
          setSeen(result.seen ?? {});
          setStatus(result.items === null ? "unavailable" : "ready");
        }
      } catch { if (!cancelled && request === generation.current) { setItems(null); setStatus("unavailable"); } }
    };
    const reload = () => { void load(); };
    void load();
    const timer = setInterval(reload, 30_000);
    window.addEventListener("focus", reload);
    window.addEventListener(NEEDS_CHANGED, reload);
    return () => { cancelled = true; clearInterval(timer); window.removeEventListener("focus", reload); window.removeEventListener(NEEDS_CHANGED, reload); };
  }, [rpc, enabled]);
  const update = useCallback(async (id: string, action: "done" | "snooze" | "reopen", until?: string) => {
    const result = await rpc.call("crew_needs_update", { id, action, ...(until ? { until } : {}) });
    ++generation.current;
    setItems(previous => openNeeds([...(previous ?? []).filter(item => item.id !== id), result.item]));
    if (action === "done") setSeen(previous => { const { [id]: _closed, ...rest } = previous; return rest; });
    setStatus("ready");
    needsChanged();
  }, [rpc]);
  return { items, seen, status, update };
}

export type NeedsYouData = ReturnType<typeof useNeedsYou>;

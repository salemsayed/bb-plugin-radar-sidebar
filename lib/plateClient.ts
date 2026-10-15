import { useCallback, useEffect, useRef, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { plateRpcContract, type PlateAction, type PlateItem, type PlateMode } from "./plate";

export const PLATE_CHANGED = "radar:plate-changed";
export function plateChanged() { window.dispatchEvent(new Event(PLATE_CHANGED)); }
/** Done rows come along so the lane can show what closed today. */
const LANE_STATES = ["open", "running", "waiting", "stalled", "done"] as const;

/** The plate, polled on the Needs-you cadence and re-read after every row action. */
export function usePlate(enabled = true) {
  const rpc = useRpc<typeof plateRpcContract>();
  const [items, setItems] = useState<PlateItem[] | null>(null);
  const [modes, setModes] = useState<Record<string, PlateMode>>({});
  const generation = useRef(0);
  const load = useCallback(async () => {
    const request = ++generation.current;
    try {
      const result = await rpc.call("crew_plate_list", { states: [...LANE_STATES] });
      if (request === generation.current) { setItems(result.items); setModes(result.modes); }
    } catch { if (request === generation.current) { setItems(null); setModes({}); } }
  }, [rpc]);
  useEffect(() => {
    if (!enabled) { ++generation.current; setItems(null); setModes({}); return; }
    const reload = () => { void load(); };
    void load();
    const timer = setInterval(reload, 30_000);
    window.addEventListener("focus", reload);
    window.addEventListener(PLATE_CHANGED, reload);
    return () => { ++generation.current; clearInterval(timer); window.removeEventListener("focus", reload); window.removeEventListener(PLATE_CHANGED, reload); };
  }, [enabled, load]);
  const update = useCallback(async (id: string, action: PlateAction, evidence?: string) => {
    const result = await rpc.call("crew_plate_update", { id, action, ...(evidence ? { evidence } : {}) });
    ++generation.current;
    setItems(previous => previous ? previous.map(item => item.id === id ? result.item : item) : previous);
    plateChanged();
  }, [rpc]);
  return { items, modes, update };
}

export type PlateData = ReturnType<typeof usePlate>;

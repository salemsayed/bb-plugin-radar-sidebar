import { useEffect, useMemo, useRef, useState } from "react";
import { useSdk, type PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { parsePulse, type Pulse } from "./bots";

type Snapshot = { usedTokens?: number; contextWindowTokens?: number; modelContextWindow?: number; estimated?: boolean };

/**
 * The latest reply of each given thread, fetched once per `updatedAt` and never
 * while the thread is mid-turn. A handful of coordinators, so sequential is fine.
 */
export function useThreadPulses(threads: readonly PluginSidebarThread[], enabled: boolean): ReadonlyMap<string, Pulse> {
  const sdk = useSdk();
  const cache = useRef(new Map<string, { updatedAt: number; pulse: Pulse | null }>());
  const [version, setVersion] = useState(0);
  const key = threads.map((thread) => `${thread.id}:${thread.updatedAt}:${thread.status}`).join("|");
  useEffect(() => {
    if (!enabled) return;
    const stale = threads.filter(
      (thread) => thread.status !== "active" && cache.current.get(thread.id)?.updatedAt !== thread.updatedAt,
    );
    if (stale.length === 0) return;
    let cancelled = false;
    void (async () => {
      for (const thread of stale) {
        let pulse: Pulse | null = null;
        try {
          const result = (await sdk.threads.output({ threadId: thread.id })) as { output?: string | null };
          pulse = parsePulse(result.output ?? null) ?? { subject: "", decision: null, quiet: false };
        } catch {
          pulse = null;
        }
        try {
          // bb reports either a flat usage or a snapshot; an estimate is good enough for a gauge.
          const ctx = (await sdk.threads.context({ threadId: thread.id })) as { usage?: { snapshot?: Snapshot | null } & Snapshot | null };
          const u = ctx.usage?.snapshot ?? ctx.usage;
          const window = u?.contextWindowTokens ?? u?.modelContextWindow;
          const ratio = u && typeof u.usedTokens === "number" && window ? u.usedTokens / window : null;
          if (pulse) pulse.context = ratio;
        } catch {
          // No context figure: the ring simply stays empty.
        }
        if (cancelled) return;
        cache.current.set(thread.id, { updatedAt: thread.updatedAt, pulse });
        setVersion((v) => v + 1);
      }
    })();
    return () => {
      cancelled = true;
    };
    // `key` folds the ids, timestamps and statuses that decide what is stale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, sdk]);
  return useMemo(() => {
    const map = new Map<string, Pulse>();
    for (const [id, entry] of cache.current) if (entry.pulse) map.set(id, entry.pulse);
    return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);
}

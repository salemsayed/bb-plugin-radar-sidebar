import { useEffect, useMemo, useRef, useState } from "react";
import { useSdk, type PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { parsePulse, pulsePreview, type Pulse } from "./bots";

/** When the last reply landed; falls back to updatedAt for threads without an attention stamp. */
function replyStamp(thread: PluginSidebarThread): number {
  return thread.latestAttentionAt ?? thread.updatedAt;
}

type Snapshot = { model?: string; usedTokens?: number; contextWindowTokens?: number; modelContextWindow?: number; estimated?: boolean };

/** Requests in flight at once: a big roster must not flood the server. */
export const PULSE_CONCURRENCY = 4;

/**
 * Read settled replies once; refresh live context without fetching streaming
 * output. Only threads that are live, or whose reply stamp moved since the
 * cache, are read, at most {@link PULSE_CONCURRENCY} at a time, and nothing
 * is read while the page is hidden: a return to the page refreshes at once.
 */
export function useThreadPulses(threads: readonly PluginSidebarThread[], enabled: boolean): ReadonlyMap<string, Pulse> {
  const sdk = useSdk();
  const cache = useRef(new Map<string, { attentionAt: number | null; pulse: Pulse }>());
  const latest = useRef(threads);
  latest.current = threads;
  const [version, setVersion] = useState(0);
  // Streaming timestamps must not restart polling or cancel an in-flight context read.
  // A reply moves latestAttentionAt; a mark-read only moves updatedAt, so it must not refetch.
  const key = threads.map(t => `${t.id}:${t.status}:${t.status === "active" ? "live" : replyStamp(t)}`).join("|");
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let loading = false;
    const readThread = async (thread: PluginSidebarThread) => {
      const cached = cache.current.get(thread.id);
      const live = thread.status === "active";
      let pulse: Pulse = { ...(cached?.pulse ?? { subject: "", decision: null, quiet: false }) };
      if (!live) {
        try {
          const result = (await sdk.threads.output({ threadId: thread.id })) as { output?: string | null };
          const reply = parsePulse(result.output ?? null) ?? { subject: "", decision: null, quiet: false };
          pulse = { ...pulse, ...reply, preview: pulsePreview(result.output) };
        } catch {
          // A context gauge is useful even when output is unavailable.
        }
      }
      try {
        const ctx = (await sdk.threads.context({ threadId: thread.id })) as { usage?: { snapshot?: Snapshot | null } & Snapshot | null };
        const u = ctx.usage?.snapshot ?? ctx.usage;
        const window = u?.contextWindowTokens ?? u?.modelContextWindow;
        pulse.context = u && typeof u.usedTokens === "number" && window ? u.usedTokens / window : null;
        pulse.contextUsedTokens = typeof u?.usedTokens === "number" ? u.usedTokens : null;
        pulse.contextWindowTokens = window ?? null;
        pulse.contextEstimated = u?.estimated ?? false;
        pulse.contextModel = ctx.usage?.snapshot?.model ?? null;
      } catch {
        // Keep the last known gauge through transient failures.
      }
      if (cancelled) return;
      cache.current.set(thread.id, { attentionAt: live ? null : replyStamp(thread), pulse });
      setVersion(v => v + 1);
    };
    const refresh = async () => {
      if (loading || document.visibilityState === "hidden") return;
      loading = true;
      try {
        // Settled threads whose reply was already read are skipped.
        const due = latest.current.filter(thread =>
          thread.status === "active" || cache.current.get(thread.id)?.attentionAt !== replyStamp(thread));
        let next = 0;
        const worker = async () => {
          while (!cancelled && next < due.length) await readThread(due[next++]!);
        };
        await Promise.all(Array.from({ length: Math.min(PULSE_CONCURRENCY, due.length) }, worker));
      } finally {
        loading = false;
      }
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    void refresh();
    document.addEventListener("visibilitychange", onVisibilityChange);
    const timer = threads.some(t => t.status === "active") ? setInterval(() => void refresh(), 15_000) : null;
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      if (timer !== null) clearInterval(timer);
    };
    // The key covers reply freshness and live/settled transitions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, sdk]);
  return useMemo(() => new Map([...cache.current].map(([id, entry]) => [id, entry.pulse])), [version]);
}

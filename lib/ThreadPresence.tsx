import { useEffect, useRef, useState } from "react";
import { experimental_useSidebarThreads, useBbContext, useRpc, useSdk, useSidebarSplitLayout } from "@get-bb/plugin-sdk/app";
import { displayedMessageSeq } from "./displayedMessage";
import { HEARTBEAT_MS, presenceContract } from "./presence";

export function ThreadPresence() {
  const context = useBbContext();
  const layout = useSidebarSplitLayout();
  const focusedThreadId = layout ? layout.panes.find(p => p.isFocused)?.threadId ?? null : context.threadId;
  const threadId = context.threadId && focusedThreadId === context.threadId ? context.threadId : null;
  const { threads } = experimental_useSidebarThreads();
  const thread = threads.find(t => t.id === threadId);
  const rpc = useRpc<typeof presenceContract>();
  const sdk = useSdk();
  const [active, setActive] = useState(() => document.visibilityState === "visible" && document.hasFocus());
  const boundary = useRef<{ threadId: string; through: number; messageSeq: number } | null>(null);
  const client = useRef({ id: crypto.randomUUID(), sequence: 0 });
  const latest = useRef({ threadId, active, rpc });
  latest.current = { threadId, active, rpc };
  useEffect(() => {
    const changed = () => setActive(document.visibilityState === "visible" && document.hasFocus());
    document.addEventListener("visibilitychange", changed);
    window.addEventListener("focus", changed);
    window.addEventListener("blur", changed);
    const send = (closing = false) => {
      const current = latest.current;
      void current.rpc.call("presence_heartbeat", { clientId: client.current.id, sequence: ++client.current.sequence, threadId: closing ? null : current.threadId, visible: !closing && document.visibilityState === "visible" && document.hasFocus(), through: !closing && boundary.current?.threadId === current.threadId ? boundary.current.through : null, messageSeq: !closing && boundary.current?.threadId === current.threadId ? boundary.current.messageSeq : null, confirmed: !closing && current.threadId !== null && boundary.current?.threadId === current.threadId && displayedMessageSeq(current.threadId) === boundary.current.messageSeq }).catch(() => {});
    };
    const leaving = () => send(true);
    window.addEventListener("pagehide", leaving);
    const resumed = () => { changed(); send(); };
    window.addEventListener("pageshow", resumed);
    const timer = setInterval(() => { if (latest.current.active) send(); }, HEARTBEAT_MS);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", changed);
      window.removeEventListener("focus", changed);
      window.removeEventListener("blur", changed);
      window.removeEventListener("pagehide", leaving);
      window.removeEventListener("pageshow", resumed);
      send(true);
    };
  }, []);
  useEffect(() => {
    void rpc.call("presence_heartbeat", { clientId: client.current.id, sequence: ++client.current.sequence, threadId, visible: active, through: active && boundary.current?.threadId === threadId ? boundary.current.through : null, messageSeq: active && boundary.current?.threadId === threadId ? boundary.current.messageSeq : null, confirmed: active && threadId !== null && boundary.current?.threadId === threadId && displayedMessageSeq(threadId) === boundary.current.messageSeq }).catch(() => {});
  }, [rpc, threadId, active]);
  useEffect(() => {
    if (!active || !threadId) return;
    let disposed = false, busy = false, confirmedSeq = boundary.current?.threadId === threadId ? boundary.current.messageSeq : 0;
    let failures = 0, retryAt = 0;
    const backoff = () => { retryAt = performance.now() + Math.min(60_000, 1000 * 2 ** Math.min(failures++, 6)); };
    const controller = new AbortController();
    const confirm = async () => {
      if (busy || performance.now() < retryAt) return;
      const seq = displayedMessageSeq(threadId);
      if (seq === null || seq === confirmedSeq) return;
      busy = true;
      try {
        const [event] = await sdk.threads.events.list({ threadId, afterSeq: String(seq - 1), beforeSeq: String(seq + 1), order: "asc", limit: "1", signal: controller.signal });
        if (disposed || latest.current.threadId !== threadId || displayedMessageSeq(threadId) !== seq) return;
        if (!event || event.seq !== seq || !Number.isFinite(event.createdAt) || event.createdAt < 0) { backoff(); return; }
        confirmedSeq = seq; failures = 0; retryAt = 0;
        const through = event.createdAt;
        boundary.current = { threadId, through, messageSeq: seq };
        await latest.current.rpc.call("presence_heartbeat", { clientId: client.current.id, sequence: ++client.current.sequence, threadId, visible: true, through, messageSeq: seq, confirmed: true });
      } catch { if (!disposed) backoff(); } finally { busy = false; }
    };
    void confirm();
    const timer = setInterval(() => { void confirm(); }, 400);
    return () => { disposed = true; controller.abort(); clearInterval(timer); };
  }, [sdk, active, threadId]);
  useEffect(() => {
    if (active && threadId) void sdk.threads.markRead({ threadId }).catch(() => {});
  }, [sdk, active, threadId, thread?.latestAttentionAt, thread?.isUnread]);
  return null;
}

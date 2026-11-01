import { useEffect, useRef, useState } from "react";
import { experimental_useSidebarThreads, useBbContext, useRpc, useSdk, useSidebarSplitLayout } from "@get-bb/plugin-sdk/app";
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
      void current.rpc.call("presence_heartbeat", { clientId: client.current.id, sequence: ++client.current.sequence, threadId: closing ? null : current.threadId, visible: !closing && document.visibilityState === "visible" && document.hasFocus() }).catch(() => {});
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
    void rpc.call("presence_heartbeat", { clientId: client.current.id, sequence: ++client.current.sequence, threadId, visible: active }).catch(() => {});
  }, [rpc, threadId, active]);
  useEffect(() => {
    if (active && threadId) void sdk.threads.markRead({ threadId }).catch(() => {});
  }, [sdk, active, threadId, thread?.latestAttentionAt, thread?.isUnread]);
  return null;
}

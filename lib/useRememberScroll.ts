import { useLayoutEffect, useRef } from "react";
import { useRpc, useSettings } from "@get-bb/plugin-sdk/app";
import { scrollContract, positionSchema } from "./scrollPosition";
import { coldReloadThreadId } from "./primeScrollRoute";
import { rememberScroll } from "./scrollController";

function browserId() {
  try {
    const key = "radar-scroll-device";
    let id = localStorage.getItem(key);
    if (!id) { id = crypto.randomUUID(); localStorage.setItem(key, id); }
    return id;
  } catch { return null; }
}
export function useRememberScroll(threadId: string | null, active: boolean) {
  const coldThread = useRef(coldReloadThreadId);
  if (threadId && threadId !== coldThread.current) coldThread.current = null;
  const autoHash = useRef<{ threadId: string; hash: string } | null>(null);
  const rpc = useRpc<typeof scrollContract>();
  const { values } = useSettings();
  const configured = typeof values?.rememberScroll === "boolean";
  const enabled = values?.rememberScroll === true;
  useLayoutEffect(() => {
    if (!configured) return;
    try { localStorage.setItem("radar-scroll-enabled", String(enabled)); } catch {}
    if (!enabled) {
      try {
        const marker = JSON.parse(sessionStorage.getItem("radar-scroll-route") ?? "null");
        if (marker?.hash === location.hash && location.pathname.endsWith(`/threads/${marker.threadId}`)) {
          history.replaceState(history.state, "", `${location.pathname}${location.search}`);
          sessionStorage.removeItem("radar-scroll-route");
        }
      } catch {}
      return;
    }
    if (!active || location.hash) return;
    const routeId = location.pathname.match(/\/threads\/([^/]+)/)?.[1];
    if (!routeId || coldThread.current === routeId) return;
    try { const marker = JSON.parse(sessionStorage.getItem("radar-scroll-route") ?? "null"); if (marker?.threadId === routeId && Date.now() - marker.at < 5000) return; } catch {}
    try {
      const point = positionSchema.parse(JSON.parse(localStorage.getItem(`radar-scroll:${routeId}`) ?? "null"));
      if (point.atBottom) return;
      const hash = `#msg=${point.messageSeq}`;
      autoHash.current = { threadId: routeId, hash };
      sessionStorage.setItem("radar-scroll-route", JSON.stringify({ threadId: routeId, hash, at: Date.now() }));
      history.replaceState(history.state, "", `${location.pathname}${hash}`);
      window.dispatchEvent(new PopStateEvent("popstate"));
    } catch {}
  }, [configured, enabled, active, threadId]);
  useLayoutEffect(() => {
    if (!enabled || !threadId || !active) return;
    let generated = false;
    try { const marker = JSON.parse(sessionStorage.getItem("radar-scroll-route") ?? "null"); generated = marker?.threadId === threadId && marker.hash === location.hash; } catch {}
    const explicitLink = /^#msg=/.test(location.hash) && !generated && !(autoHash.current?.threadId === threadId && autoHash.current.hash === location.hash);
    const deviceId = browserId();
    if (!deviceId) return;
    const key = `radar-scroll:${threadId}`;
    let cached = null;
    try { cached = positionSchema.parse(JSON.parse(localStorage.getItem(key) ?? "null")); } catch {}
    let pending = Promise.resolve();
    const stop = rememberScroll(threadId, {
      cached: explicitLink ? null : cached,
      deferUntilVisible: coldThread.current === threadId,
      cancelAnchor: () => {
        try {
          const marker = JSON.parse(sessionStorage.getItem("radar-scroll-route") ?? "null");
          if (marker?.threadId !== threadId || marker.hash !== location.hash) return;
          history.replaceState(history.state, "", `${location.pathname}${location.search}`);
          sessionStorage.removeItem("radar-scroll-route");
          autoHash.current = null;
          window.dispatchEvent(new PopStateEvent("popstate"));
        } catch {}
      },
      loadAnchor: seq => { autoHash.current = { threadId, hash: `#msg=${seq}` };
        try { sessionStorage.setItem("radar-scroll-route", JSON.stringify({ threadId, hash: `#msg=${seq}`, at: Date.now() })); } catch {} history.replaceState(history.state, "", `${location.pathname}#msg=${seq}`);
        window.dispatchEvent(new PopStateEvent("popstate")); },
      load: () => explicitLink ? Promise.resolve(null) : rpc.call("scroll_get", { threadId, deviceId }),
      save: position => {
        try {
          localStorage.setItem(key, JSON.stringify(position));
          const owned = JSON.parse(sessionStorage.getItem("radar-scroll-route") ?? "null");
          if (position.atBottom && owned?.threadId === threadId && owned.hash === location.hash) {
            history.replaceState(history.state, "", `${location.pathname}${location.search}`);
            sessionStorage.removeItem("radar-scroll-route");
          }
          if (!position.atBottom && owned?.threadId === threadId && owned.hash === location.hash) {
            history.replaceState(history.state, "", `${location.pathname}${location.search}`);
            sessionStorage.removeItem("radar-scroll-route");
          }
        } catch {}
        pending = pending.then(() => rpc.call("scroll_set", { threadId, deviceId, position })).then(() => {}, () => {});
      },
    });
    return () => { stop(); coldThread.current = null; };
  }, [rpc, threadId, active, enabled]);
}

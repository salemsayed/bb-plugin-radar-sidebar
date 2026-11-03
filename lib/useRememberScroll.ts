import { useLayoutEffect, useRef } from "react";
import { useRpc, useSettings } from "@get-bb/plugin-sdk/app";
import { scrollContract, positionSchema } from "./scrollPosition";
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
  const autoHash = useRef<{ threadId: string; hash: string } | null>(null);
  const rpc = useRpc<typeof scrollContract>();
  const { values } = useSettings();
  const enabled = values?.rememberScroll !== false;
  useLayoutEffect(() => {
    if (!enabled || !active || location.hash) return;
    const routeId = location.pathname.match(/\/threads\/([^/]+)/)?.[1];
    if (!routeId) return;
    try {
      const point = positionSchema.parse(JSON.parse(localStorage.getItem(`radar-scroll:${routeId}`) ?? "null"));
      if (point.atBottom) return;
      const hash = `#msg=${point.messageSeq}`;
      autoHash.current = { threadId: routeId, hash };
      sessionStorage.setItem("radar-scroll-route", JSON.stringify({ threadId: routeId, hash, at: Date.now() }));
      history.replaceState(history.state, "", `${location.pathname}${hash}`);
      window.dispatchEvent(new PopStateEvent("popstate"));
    } catch {}
  }, [enabled, active, threadId]);
  useLayoutEffect(() => {
    if (!enabled || !threadId || !active) return;
    let generated = false;
    try { const marker = JSON.parse(sessionStorage.getItem("radar-scroll-route") ?? "null"); generated = marker?.threadId === threadId && marker.hash === location.hash && Date.now() - marker.at < 5000; } catch {}
    const explicitLink = /^#msg=/.test(location.hash) && !generated && !(autoHash.current?.threadId === threadId && autoHash.current.hash === location.hash);
    const deviceId = browserId();
    if (!deviceId) return;
    const key = `radar-scroll:${threadId}`;
    let cached = null;
    try { cached = positionSchema.parse(JSON.parse(localStorage.getItem(key) ?? "null")); } catch {}
    let pending = Promise.resolve();
    return rememberScroll(threadId, {
      cached: explicitLink ? null : cached,
      loadAnchor: seq => { autoHash.current = { threadId, hash: `#msg=${seq}` };
        try { sessionStorage.setItem("radar-scroll-route", JSON.stringify({ threadId, hash: `#msg=${seq}`, at: Date.now() })); } catch {} history.replaceState(history.state, "", `${location.pathname}#msg=${seq}`);
        window.dispatchEvent(new PopStateEvent("popstate")); },
      load: () => explicitLink ? Promise.resolve(null) : rpc.call("scroll_get", { threadId, deviceId }),
      save: position => {
        try { localStorage.setItem(key, JSON.stringify(position)); } catch {}
        pending = pending.then(() => rpc.call("scroll_set", { threadId, deviceId, position })).then(() => {}, () => {});
      },
    });
  }, [rpc, threadId, active, enabled]);
}

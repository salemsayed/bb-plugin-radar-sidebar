import { useEffect, useLayoutEffect } from "react";
import { useRpc, useSettings } from "@get-bb/plugin-sdk/app";
import { scrollContract, type ScrollPosition } from "./scrollPosition";
import { explicitLink, mirrorScrollEnabled, releaseScrollAnchor, requestScrollAnchor, savedScroll, scrollEnabled } from "./primeScrollRoute";
import { rememberScroll } from "./scrollController";
import { flushScrollTrace } from "./scrollTrace";

const SAVE_MS = 400;

function browserId() {
  try {
    const key = "radar-scroll-device";
    let id = localStorage.getItem(key);
    if (!id) { id = crypto.randomUUID(); localStorage.setItem(key, id); }
    return id;
  } catch { return null; }
}
export function useRememberScroll(threadId: string | null, active: boolean) {
  const rpc = useRpc<typeof scrollContract>();
  const { values } = useSettings();
  const setting = typeof values?.rememberScroll === "boolean" ? values.rememberScroll : null;
  const enabled = setting ?? scrollEnabled();
  useLayoutEffect(() => {
    if (setting === null) return;
    mirrorScrollEnabled(setting);
    if (!setting) releaseScrollAnchor(null, true);
  }, [setting]);
  useEffect(() => {
    const deviceId = browserId();
    return deviceId ? flushScrollTrace(rpc, deviceId) : undefined;
  }, [rpc]);
  useLayoutEffect(() => {
    if (!enabled || !threadId || !active) return;
    const linked = explicitLink(threadId);
    const deviceId = browserId();
    if (!deviceId) return;
    const key = `radar-scroll:${threadId}`;
    const cached = savedScroll(threadId);
    let latest: ScrollPosition | null = null, sending = false, timer: ReturnType<typeof setTimeout> | undefined;
    const send = () => {
      clearTimeout(timer);
      timer = undefined;
      if (sending || !latest) return;
      const position = latest;
      latest = null;
      sending = true;
      void rpc.call("scroll_set", { threadId, deviceId, position }).then(() => {}, () => {}).then(() => { sending = false; if (latest) timer = setTimeout(send, SAVE_MS); });
    };
    const flush = () => { if (document.visibilityState === "hidden") send(); };
    document.addEventListener("visibilitychange", flush);
    window.addEventListener("pagehide", send);
    const stop = rememberScroll(threadId, {
      cached: linked ? null : cached,
      load: linked || cached ? undefined : () => rpc.call("scroll_get", { threadId, deviceId }),
      loadAnchor: seq => requestScrollAnchor(threadId, seq),
      anchorReady: () => releaseScrollAnchor(threadId, false),
      cancelAnchor: () => releaseScrollAnchor(threadId, true),
      save: position => {
        try { localStorage.setItem(key, JSON.stringify(position)); } catch {}
        latest = position;
        if (timer === undefined && !sending) timer = setTimeout(send, SAVE_MS);
      },
    });
    return () => {
      stop();
      send();
      document.removeEventListener("visibilitychange", flush);
      window.removeEventListener("pagehide", send);
    };
  }, [rpc, threadId, active, enabled]);
}

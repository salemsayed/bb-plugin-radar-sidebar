import { useEffect, useLayoutEffect } from "react";
import { useRpc, useSettings } from "@get-bb/plugin-sdk/app";
import { scrollContract } from "./scrollPosition";
import { explicitLink, mirrorScrollEnabled, releaseScrollAnchor, requestScrollAnchor, savedScroll, scrollEnabled } from "./primeScrollRoute";
import { rememberScroll } from "./scrollController";
import { flushScrollTrace } from "./scrollTrace";

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
    let pending = Promise.resolve();
    return rememberScroll(threadId, {
      cached: linked ? null : cached,
      load: linked || cached ? undefined : () => rpc.call("scroll_get", { threadId, deviceId }),
      loadAnchor: seq => requestScrollAnchor(threadId, seq),
      anchorReady: () => releaseScrollAnchor(threadId, false),
      cancelAnchor: () => releaseScrollAnchor(threadId, true),
      save: position => {
        try { localStorage.setItem(key, JSON.stringify(position)); } catch {}
        pending = pending.then(() => rpc.call("scroll_set", { threadId, deviceId, position })).then(() => {}, () => {});
      },
    });
  }, [rpc, threadId, active, enabled]);
}

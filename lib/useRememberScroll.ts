import { useLayoutEffect } from "react";
import { useRpc, useSettings } from "@get-bb/plugin-sdk/app";
import { scrollContract, positionSchema } from "./scrollPosition";
import { ownedRouteHash, releaseScrollAnchor, requestScrollAnchor } from "./primeScrollRoute";
import { rememberScroll } from "./scrollController";

const ENABLED_KEY = "radar-scroll-enabled";

function browserId() {
  try {
    const key = "radar-scroll-device";
    let id = localStorage.getItem(key);
    if (!id) { id = crypto.randomUUID(); localStorage.setItem(key, id); }
    return id;
  } catch { return null; }
}
function mirroredSetting() {
  try { return localStorage.getItem(ENABLED_KEY) !== "false"; } catch { return true; }
}
export function useRememberScroll(threadId: string | null, active: boolean) {
  const rpc = useRpc<typeof scrollContract>();
  const { values } = useSettings();
  const setting = typeof values?.rememberScroll === "boolean" ? values.rememberScroll : null;
  const enabled = setting ?? mirroredSetting();
  useLayoutEffect(() => {
    if (setting === null) return;
    try { localStorage.setItem(ENABLED_KEY, String(setting)); } catch {}
    if (!setting) releaseScrollAnchor(null, true);
  }, [setting]);
  useLayoutEffect(() => {
    if (!enabled || !threadId || !active) return;
    const explicitLink = /^#msg=/.test(location.hash) && ownedRouteHash(threadId) !== location.hash;
    const deviceId = browserId();
    if (!deviceId) return;
    const key = `radar-scroll:${threadId}`;
    let cached = null;
    try { cached = positionSchema.parse(JSON.parse(localStorage.getItem(key) ?? "null")); } catch {}
    let pending = Promise.resolve();
    return rememberScroll(threadId, {
      cached: explicitLink ? null : cached,
      load: explicitLink || cached ? undefined : () => rpc.call("scroll_get", { threadId, deviceId }),
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

import { positionSchema } from "./scrollPosition";

export function primeScrollRoute() {
  try {
    if (localStorage.getItem("radar-scroll-enabled") === "false" || location.hash) return;
    const threadId = location.pathname.match(/\/threads\/([^/]+)/)?.[1];
    if (!threadId) return;
    const point = positionSchema.parse(JSON.parse(localStorage.getItem(`radar-scroll:${threadId}`) ?? "null"));
    if (point.atBottom) return;
    const hash = `#msg=${point.messageSeq}`;
    sessionStorage.setItem("radar-scroll-route", JSON.stringify({ threadId, hash, at: Date.now() }));
    history.replaceState(history.state, "", `${location.pathname}${hash}`);
    window.dispatchEvent(new PopStateEvent("popstate"));
  } catch {}
}

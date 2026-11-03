import { positionSchema } from "./scrollPosition";

export const coldReloadThreadId = performance.getEntriesByType("navigation").some(entry => (entry as PerformanceNavigationTiming).type === "reload") ? location.pathname.match(/\/threads\/([^/]+)/)?.[1] ?? null : null;

export function requestScrollAnchor(threadId: string, messageSeq: number) {
  if (!location.pathname.endsWith(`/threads/${threadId}`)) return;
  const hash = `#msg=${messageSeq}`;
  try { sessionStorage.setItem("radar-scroll-route", JSON.stringify({ threadId, hash, at: Date.now() })); } catch {}
  history.replaceState(history.state, "", `${location.pathname}${location.search}${hash}`);
  try { window.dispatchEvent(new PopStateEvent("popstate")); }
  finally {
    if (location.pathname.endsWith(`/threads/${threadId}`) && location.hash === hash) history.replaceState(history.state, "", `${location.pathname}${location.search}`);
  }
}

export function primeScrollRoute() {
  try {
    if (coldReloadThreadId) {
      const marker = JSON.parse(sessionStorage.getItem("radar-scroll-route") ?? "null");
      if (marker?.hash === location.hash && location.pathname.endsWith(`/threads/${marker.threadId}`)) {
        history.replaceState(history.state, "", `${location.pathname}${location.search}`);
        sessionStorage.removeItem("radar-scroll-route");
        window.dispatchEvent(new PopStateEvent("popstate"));
      }
      return;
    }
    if (localStorage.getItem("radar-scroll-enabled") === "false" || location.hash) return;
    const threadId = location.pathname.match(/\/threads\/([^/]+)/)?.[1];
    if (!threadId) return;
    const point = positionSchema.parse(JSON.parse(localStorage.getItem(`radar-scroll:${threadId}`) ?? "null"));
    if (point.atBottom) return;
    requestScrollAnchor(threadId, point.messageSeq);
  } catch {}
}

export const coldReloadThreadId = performance.getEntriesByType("navigation").some(entry => (entry as PerformanceNavigationTiming).type === "reload") ? location.pathname.match(/\/threads\/([^/]+)/)?.[1] ?? null : null;

export function primeScrollRoute() {
  if (!coldReloadThreadId) return;
  try {
    const marker = JSON.parse(sessionStorage.getItem("radar-scroll-route") ?? "null");
    if (marker?.hash === location.hash && location.pathname.endsWith(`/threads/${marker.threadId}`)) {
      history.replaceState(history.state, "", `${location.pathname}${location.search}`);
      sessionStorage.removeItem("radar-scroll-route");
    }
  } catch {}
}

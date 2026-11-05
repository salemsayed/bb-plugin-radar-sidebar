const ROUTE_KEY = "radar-scroll-route";
const VIEWPORT = "[data-page-scroll-viewport]";
const MESSAGE = "[data-notification-thread][data-notification-message]";

type RouteMarker = { threadId: string; hash: string; at: number };

function readMarker(): RouteMarker | null {
  try {
    const marker = JSON.parse(sessionStorage.getItem(ROUTE_KEY) ?? "null");
    return marker && typeof marker.threadId === "string" && typeof marker.hash === "string" ? marker : null;
  } catch { return null; }
}

export function ownedRouteHash(threadId: string) {
  const marker = readMarker();
  return marker?.threadId === threadId ? marker.hash : null;
}

export function requestScrollAnchor(threadId: string, messageSeq: number) {
  if (!location.pathname.endsWith(`/threads/${threadId}`)) return;
  const hash = `#msg=${messageSeq}`;
  try { sessionStorage.setItem(ROUTE_KEY, JSON.stringify({ threadId, hash, at: Date.now() })); } catch {}
  history.replaceState(history.state, "", `${location.pathname}${location.search}${hash}`);
  try { window.dispatchEvent(new PopStateEvent("popstate")); }
  finally {
    if (location.pathname.endsWith(`/threads/${threadId}`) && location.hash === hash) history.replaceState(history.state, "", `${location.pathname}${location.search}`);
  }
}

export function releaseScrollAnchor(threadId: string | null, notify: boolean) {
  try {
    const marker = readMarker();
    if (!marker || threadId !== null && marker.threadId !== threadId) return;
    sessionStorage.removeItem(ROUTE_KEY);
    if (!location.pathname.endsWith(`/threads/${marker.threadId}`)) return;
    if (location.hash && location.hash !== marker.hash) return;
    if (location.hash) history.replaceState(history.state, "", `${location.pathname}${location.search}`);
    if (notify) window.dispatchEvent(new PopStateEvent("popstate"));
  } catch {}
}

const shown = new WeakMap<Element, { threadId: string; at: number }>();
const painted: { at: number; element: Element }[] = [];
let paintObserver: PerformanceObserver | null = null;

function threadOf(element: Element) {
  const message = element.closest<HTMLElement>(MESSAGE) ?? element.querySelector<HTMLElement>(MESSAGE);
  return message?.dataset.notificationThread ?? null;
}

function notePaints(entries: PerformanceEntryList) {
  for (const entry of entries) {
    const element = (entry as PerformanceEntry & { element?: Element | null }).element;
    if (element) painted.push({ at: entry.startTime, element });
  }
}

function noteViewports(at: number) {
  for (const viewport of document.querySelectorAll(VIEWPORT)) {
    const message = viewport.querySelector<HTMLElement>(MESSAGE);
    const threadId = message?.dataset.notificationThread;
    if (!threadId) continue;
    if (shown.get(viewport)?.threadId !== threadId) shown.set(viewport, { threadId, at });
  }
}

export function chatShownAt(container: Element, threadId: string): number | null {
  if (paintObserver) notePaints(paintObserver.takeRecords());
  const times = painted.filter(p => p.element.isConnected && container.contains(p.element) && threadOf(p.element) === threadId).map(p => p.at);
  if (times.length) return Math.min(...times);
  const seen = shown.get(container);
  return seen?.threadId === threadId ? seen.at : null;
}

export function primeScrollRoute() {
  try {
    paintObserver = new PerformanceObserver(list => notePaints(list.getEntries()));
    paintObserver.observe({ type: "largest-contentful-paint", buffered: true });
  } catch { paintObserver = null; }
  try {
    const firstPaint = performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? 0;
    noteViewports(firstPaint);
    new MutationObserver(() => noteViewports(performance.now())).observe(document.documentElement, { childList: true, subtree: true });
  } catch {}
  try {
    const reloaded = performance.getEntriesByType("navigation").some(entry => (entry as PerformanceNavigationTiming).type === "reload");
    const marker = readMarker();
    if (!marker) return;
    if (reloaded && marker.hash === location.hash && location.pathname.endsWith(`/threads/${marker.threadId}`)) {
      history.replaceState(history.state, "", `${location.pathname}${location.search}`);
      sessionStorage.removeItem(ROUTE_KEY);
      window.dispatchEvent(new PopStateEvent("popstate"));
      return;
    }
    if (Date.now() - marker.at > 60000) sessionStorage.removeItem(ROUTE_KEY);
  } catch {}
}

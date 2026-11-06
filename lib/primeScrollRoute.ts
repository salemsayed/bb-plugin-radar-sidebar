import { BOTTOM_GAP, positionSchema, type ScrollPosition } from "./scrollPosition";
import { startScrollTrace } from "./scrollTrace";

const ROUTE_KEY = "radar-scroll-route";
const ENABLED_KEY = "radar-scroll-enabled";
const VEIL_ID = "radar-scroll-veil";
const VIEWPORT = "[data-page-scroll-viewport]";
const MESSAGE = "[data-notification-thread][data-notification-message]";
export const LATE_MS = 300;
export const LATE_CUT_MS = 2000;
const VEIL_MIN_MS = 1200;
const VEIL_MAX_MS = 3000;

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

export function messageAnchors(threadId: string) {
  return Array.from(document.querySelectorAll<HTMLElement>(MESSAGE)).filter(e => e.dataset.notificationThread === threadId && Number.isSafeInteger(Number(e.dataset.notificationMessage)) && Number(e.dataset.notificationMessage) > 0);
}
export function chatScroller(threadId: string): HTMLElement | null {
  for (const anchor of messageAnchors(threadId)) {
    for (let el = anchor.parentElement; el && el !== document.body; el = el.parentElement) {
      if (/^(auto|scroll)$/.test(getComputedStyle(el).overflowY) && el.clientHeight > 0) return el;
    }
  }
  return null;
}
export function scrollEnabled() {
  try { return localStorage.getItem(ENABLED_KEY) !== "false"; } catch { return true; }
}
export function mirrorScrollEnabled(value: boolean) {
  try { localStorage.setItem(ENABLED_KEY, String(value)); } catch {}
}
export function savedScroll(threadId: string): ScrollPosition | null {
  try { return positionSchema.parse(JSON.parse(localStorage.getItem(`radar-scroll:${threadId}`) ?? "null")); } catch { return null; }
}
export function explicitLink(threadId: string) {
  return /^#msg=/.test(location.hash) && ownedRouteHash(threadId) !== location.hash;
}
export function veilCap() {
  const timings = [...performance.getEntriesByType("navigation"), ...performance.getEntriesByType("resource").filter(e => /\/api\/v1\/plugins$/.test(e.name))] as PerformanceResourceTiming[];
  const rtt = Math.max(0, ...timings.map(t => t.responseStart > t.requestStart ? t.responseStart - t.requestStart : 0));
  return Math.round(Math.min(VEIL_MAX_MS, Math.max(VEIL_MIN_MS, VEIL_MIN_MS + 2 * rtt)));
}

let veil: { threadId: string; at: number; timer: number } | null = null;
export function veilChat(threadId: string, capMs = veilCap()) {
  if (veil?.threadId === threadId) return veil.at;
  unveilChat(null);
  let style = document.getElementById(VEIL_ID);
  if (!style) {
    style = document.createElement("style");
    style.id = VEIL_ID;
    document.head.appendChild(style);
  }
  const id = CSS.escape(threadId);
  style.textContent = `${VIEWPORT}:has([data-notification-thread="${id}"]) > * > :not([data-scroll-footer]) { opacity: 0; animation: radar-scroll-unveil 1ms linear ${capMs}ms forwards; } @keyframes radar-scroll-unveil { to { opacity: 1; } }`;
  veil = { threadId, at: performance.now(), timer: window.setTimeout(() => unveilChat(threadId), capMs + 100) };
  return veil.at;
}
export function unveilChat(threadId: string | null) {
  if (!veil || threadId !== null && veil.threadId !== threadId) return false;
  clearTimeout(veil.timer);
  veil = null;
  const style = document.getElementById(VEIL_ID);
  if (style) style.textContent = "";
  return true;
}
export function veiledSince(threadId: string) {
  return veil?.threadId === threadId ? veil.at : null;
}

let firstInputAt: number | null = null;
let primed: { threadId: string; before: boolean; requested: boolean; timer: number } | null = null;
let inputObserver: PerformanceObserver | null = null;

function noteFirstInput() {
  if (!inputObserver) return;
  for (const entry of inputObserver.takeRecords()) firstInputAt = Math.min(firstInputAt ?? Infinity, entry.startTime);
}
export function untouchedSince(container: HTMLElement, shownAt: number) {
  if (container.scrollHeight - container.clientHeight - container.scrollTop > BOTTOM_GAP) return false;
  noteFirstInput();
  if (inputObserver) return firstInputAt === null || firstInputAt < shownAt;
  const activation = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation;
  return activation ? !activation.hasBeenActive : true;
}
export function claimPrime(threadId: string) {
  if (!primed || primed.threadId !== threadId) return null;
  clearTimeout(primed.timer);
  const claimed = { before: primed.before, requested: primed.requested };
  primed = null;
  return claimed;
}

function primeVeil() {
  const threadId = /\/threads\/([^/?#]+)$/.exec(location.pathname)?.[1];
  if (!threadId || !scrollEnabled() || explicitLink(threadId)) return;
  const saved = savedScroll(threadId);
  if (!saved || saved.atBottom) return;
  const container = chatScroller(threadId);
  if (container) {
    const shownAt = chatShownAt(container, threadId);
    if (shownAt !== null && (performance.now() - shownAt > LATE_CUT_MS || !untouchedSince(container, shownAt))) return;
  }
  veilChat(threadId);
  const loaded = messageAnchors(threadId).some(e => Number(e.dataset.notificationMessage) === saved.messageSeq);
  if (!loaded) {
    document.documentElement.setAttribute("data-radar-scroll-restore", "");
    requestScrollAnchor(threadId, saved.messageSeq);
  }
  primed = { threadId, before: container === null, requested: !loaded, timer: window.setTimeout(() => {
    primed = null;
    unveilChat(threadId);
    if (!loaded) {
      releaseScrollAnchor(threadId, true);
      document.documentElement.removeAttribute("data-radar-scroll-restore");
    }
  }, veilCap()) };
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
  startScrollTrace();
  try {
    inputObserver = new PerformanceObserver(() => noteFirstInput());
    inputObserver.observe({ type: "first-input", buffered: true });
  } catch { inputObserver = null; }
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
    if (marker && reloaded && marker.hash === location.hash && location.pathname.endsWith(`/threads/${marker.threadId}`)) {
      history.replaceState(history.state, "", `${location.pathname}${location.search}`);
      sessionStorage.removeItem(ROUTE_KEY);
      window.dispatchEvent(new PopStateEvent("popstate"));
    } else if (marker && Date.now() - marker.at > 60000) sessionStorage.removeItem(ROUTE_KEY);
  } catch {}
  try { primeVeil(); } catch {}
}

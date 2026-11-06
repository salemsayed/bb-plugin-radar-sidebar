import { BOTTOM_GAP, positionSchema, type ScrollPosition } from "./scrollPosition";
import { startScrollTrace } from "./scrollTrace";
import { installTouchCoast } from "./touchCoast";
import { releaseScrollHooks } from "./scrollHook";

const ROUTE_KEY = "radar-scroll-route";
const PENDING_KEY = "radar-scroll-pending";
const PENDING_MS = 20000;
const ENABLED_KEY = "radar-scroll-enabled";
const VEIL_ID = "radar-scroll-veil";
const VIEWPORT = "[data-page-scroll-viewport]";
const MESSAGE = "[data-notification-thread][data-notification-message]";
export const LATE_MS = 300;
export const LATE_CUT_MS = 4000;
export const VEIL_BUDGET_MS = 12000;
export const VEIL_MAX_MS = 20000;
export const VEIL_SAFETY_MS = 2000;
const PRIME_CLAIM_MS = 4000;
const UNVEIL = "radar-scroll-unveil";
const BOOT_KEY = "__radarScrollBoot";
const instance = Math.random().toString(36).slice(2, 10);
let retired = false;
const stops: (() => void)[] = [];

export function scrollRetired() {
  return retired;
}

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
export function markPendingRestore(threadId: string) {
  try { sessionStorage.setItem(PENDING_KEY, JSON.stringify({ threadId, at: Date.now() })); } catch {}
}
export function takePendingRestore(threadId: string) {
  try {
    const marker = JSON.parse(sessionStorage.getItem(PENDING_KEY) ?? "null");
    sessionStorage.removeItem(PENDING_KEY);
    return marker?.threadId === threadId && typeof marker.at === "number" && Date.now() - marker.at < PENDING_MS;
  } catch { return false; }
}
export function explicitLink(threadId: string) {
  return /^#msg=/.test(location.hash) && ownedRouteHash(threadId) !== location.hash;
}
let veil: { threadId: string; at: number; timer: number | null; lifted: boolean } | null = null;
let unveilWatch = false;
function veilStyle(create: boolean) {
  let style = document.getElementById(VEIL_ID);
  if (!style && create) {
    style = document.createElement("style");
    style.id = VEIL_ID;
    document.head.appendChild(style);
  }
  return style;
}
function clearVeilStyle() {
  const style = veilStyle(false);
  if (style && (!style.dataset.owner || style.dataset.owner === instance)) style.textContent = "";
}
export function veilChat(threadId: string, capMs = VEIL_MAX_MS + VEIL_SAFETY_MS) {
  if (veil?.threadId === threadId) return veil.at;
  unveilChat(null);
  const style = veilStyle(true)!;
  style.dataset.owner = instance;
  if (!unveilWatch) {
    unveilWatch = true;
    const lifted = (event: AnimationEvent) => { if (event.animationName === UNVEIL && veil) veil.lifted = true; };
    document.addEventListener("animationend", lifted, true);
    stops.push(() => document.removeEventListener("animationend", lifted, true));
  }
  const id = CSS.escape(threadId);
  style.textContent = `${VIEWPORT}:has([data-notification-thread="${id}"]) > * > :not([data-scroll-footer]) { opacity: 0; animation: ${UNVEIL} 1ms linear ${capMs}ms forwards; } @keyframes ${UNVEIL} { to { opacity: 1; } }`;
  veil = { threadId, at: performance.now(), timer: null, lifted: false };
  return veil.at;
}
export function armVeil(threadId: string, ms: number) {
  if (!veil || veil.threadId !== threadId || veil.timer !== null) return;
  const current = veil;
  current.timer = window.setTimeout(() => {
    if (veil !== current) return;
    current.lifted = true;
    clearVeilStyle();
  }, ms);
}
export function veilLifted(threadId: string) {
  return veil?.threadId === threadId && veil.lifted;
}
export function unveilChat(threadId: string | null) {
  if (!veil || threadId !== null && veil.threadId !== threadId) return false;
  if (veil.timer !== null) clearTimeout(veil.timer);
  veil = null;
  clearVeilStyle();
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
  }, PRIME_CLAIM_MS) };
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
  const slot = window as Window & { [BOOT_KEY]?: { id: string; dispose: () => void } };
  try { if (slot[BOOT_KEY]?.id !== instance) slot[BOOT_KEY]?.dispose(); } catch {}
  slot[BOOT_KEY] = { id: instance, dispose: () => {
    retired = true;
    if (primed) { clearTimeout(primed.timer); primed = null; }
    for (const stop of stops.splice(0)) {
      try { stop(); } catch {}
    }
  } };
  stops.push(startScrollTrace());
  stops.push(releaseScrollHooks);
  try { stops.push(installTouchCoast(scrollEnabled)); } catch {}
  try {
    inputObserver = new PerformanceObserver(() => noteFirstInput());
    inputObserver.observe({ type: "first-input", buffered: true });
    const observer = inputObserver;
    stops.push(() => observer.disconnect());
  } catch { inputObserver = null; }
  try {
    paintObserver = new PerformanceObserver(list => notePaints(list.getEntries()));
    paintObserver.observe({ type: "largest-contentful-paint", buffered: true });
    const observer = paintObserver;
    stops.push(() => observer.disconnect());
  } catch { paintObserver = null; }
  try {
    const firstPaint = performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? 0;
    noteViewports(firstPaint);
    const viewports = new MutationObserver(() => noteViewports(performance.now()));
    viewports.observe(document.documentElement, { childList: true, subtree: true });
    stops.push(() => viewports.disconnect());
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

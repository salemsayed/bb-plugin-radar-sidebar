import { emitTrace } from "./scrollTrace";

const TIMELINE = '[data-timeline-row-list="top-level"]';
const PAN_PX = 4;
const COAST_MS = 3000;

type Touch = { scroller: HTMLElement; x: number; y: number; at: number; panned: boolean };
type Coast = { scroller: HTMLElement; until: number; nudges: number; from: number };

let touch: Touch | null = null;
let coast: Coast | null = null;
let installed = false;

const threadId = () => /\/threads\/([^/?#]+)$/.exec(location.pathname)?.[1] ?? null;

function chatScrollerOf(target: EventTarget | null) {
  for (let el = target instanceof Element ? target : null; el && el !== document.body; el = el.parentElement) {
    if (!(el instanceof HTMLElement) || el.clientHeight <= 0) continue;
    if (!/^(auto|scroll)$/.test(getComputedStyle(el).overflowY)) continue;
    return el.querySelector(TIMELINE) ? el : null;
  }
  return null;
}

function nudge(scroller: HTMLElement) {
  scroller.dispatchEvent(new WheelEvent("wheel", { deltaY: 0, bubbles: false, cancelable: false }));
}

function endCoast(reason: string) {
  if (!coast) return;
  emitTrace("coast-end", threadId(), { reason, nudges: coast.nudges, moved: Math.round(coast.scroller.scrollTop - coast.from) });
  coast = null;
}

function onTouchStart(event: TouchEvent) {
  if (!event.isTrusted) return;
  if (event.touches.length > 1) { if (touch) touch.panned = true; return; }
  endCoast("touch");
  const footer = event.target instanceof Element && event.target.closest("[data-scroll-footer]");
  const scroller = footer ? null : chatScrollerOf(event.target);
  const point = event.touches[0];
  touch = scroller && point ? { scroller, x: point.clientX, y: point.clientY, at: performance.now(), panned: false } : null;
}

function onTouchMove(event: TouchEvent) {
  const point = event.touches[0];
  if (!event.isTrusted || !touch || touch.panned || !point) return;
  if (Math.hypot(point.clientX - touch.x, point.clientY - touch.y) >= PAN_PX) touch.panned = true;
}

function onPointerCancel(event: PointerEvent) {
  if (event.isTrusted && touch && event.pointerType === "touch") touch.panned = true;
}

function onTouchEnd(event: TouchEvent) {
  if (!event.isTrusted || event.touches.length > 0 || !touch) return;
  const ended = touch;
  touch = null;
  if (!ended.panned || !ended.scroller.isConnected || !enabled()) return;
  coast = { scroller: ended.scroller, until: performance.now() + COAST_MS, nudges: 0, from: ended.scroller.scrollTop };
  emitTrace("coast", threadId(), { heldMs: Math.round(performance.now() - ended.at), gap: Math.round(ended.scroller.scrollHeight - ended.scroller.clientHeight - ended.scroller.scrollTop) });
  nudge(ended.scroller);
}

function onScroll(event: Event) {
  if (!coast || event.target !== coast.scroller) return;
  if (performance.now() > coast.until || !coast.scroller.isConnected) { endCoast("time"); return; }
  coast.nudges++;
  nudge(coast.scroller);
}

let enabled = () => true;

export function installTouchCoast(isEnabled: () => boolean) {
  enabled = isEnabled;
  if (installed || typeof window === "undefined" || !("ontouchstart" in window || navigator.maxTouchPoints > 0)) return;
  installed = true;
  const options = { capture: true, passive: true } as const;
  document.addEventListener("touchstart", onTouchStart, options);
  document.addEventListener("touchmove", onTouchMove, options);
  document.addEventListener("pointercancel", onPointerCancel, options);
  document.addEventListener("touchend", onTouchEnd, options);
  document.addEventListener("touchcancel", onTouchEnd, options);
  document.addEventListener("scroll", onScroll, options);
}

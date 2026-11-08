import type { TraceEvent } from "./scrollPosition";
import { onScrollWrite } from "./scrollHook";
import { messageRows, rowSeq } from "./messageRows";

const FLAG_KEY = "radar-scroll-debug";
const BUFFER_MAX = 4000;
const BATCH_MAX = 400;

type DebugWindow = Window & { __radarScrollDebug?: boolean };
const buffer: TraceEvent[] = [];
const page = `${Math.round(performance.timeOrigin)}-${Math.random().toString(36).slice(2, 8)}`;
let installed = false, retired = false;
const hooked = new WeakSet<Element>();
const unhooks: (() => void)[] = [];
const removers: (() => void)[] = [];

function hookWrites(scroller: HTMLElement, threadId: string) {
  if (hooked.has(scroller)) return;
  hooked.add(scroller);
  unhooks.push(onScrollWrite(scroller, write => {
    if (traceOn()) emitTrace("write", threadId, { from: Math.round(write.from), to: Math.round(write.to), by: write.own ? "radar" : "host", via: write.via, gap: Math.round(scroller.scrollHeight - scroller.clientHeight - write.to) });
  }));
}

export function traceOn() {
  return Boolean((window as DebugWindow).__radarScrollDebug);
}
export function emitTrace(event: string, threadId: string | null, data: unknown = null) {
  if (!traceOn()) return;
  window.dispatchEvent(new CustomEvent("radar-scroll-trace", { detail: { event, threadId, data, at: performance.now(), wallTime: performance.timeOrigin + performance.now(), hash: location.hash } }));
}

function scrollerOf(threadId: string) {
  for (const anchor of messageRows(threadId)) {
    for (let el = anchor.parentElement; el && el !== document.body; el = el.parentElement) {
      if (/^(auto|scroll)$/.test(getComputedStyle(el).overflowY) && el.clientHeight > 0) return el;
    }
    return null;
  }
  return null;
}
function opacityOf(el: Element | null) {
  let value = 1;
  for (let node = el; node && node !== document.documentElement; node = node.parentElement) value *= Number(getComputedStyle(node).opacity) || 0;
  return Math.round(value * 100) / 100;
}

function sample() {
  let scroller: HTMLElement | null = null, threadId: string | null = null, last = "", path = "";
  const step = () => {
    if (location.pathname !== path) { path = location.pathname; emitTrace("route", null, { path }); scroller = null; last = ""; }
    threadId = /\/threads\/([^/?#]+)$/.exec(location.pathname)?.[1] ?? null;
    if (threadId && !scroller?.isConnected) scroller = scrollerOf(threadId);
    if (threadId && scroller) {
      hookWrites(scroller, threadId);
      const rect = scroller.getBoundingClientRect();
      const top = rect.top + scroller.clientTop;
      const first = messageRows(undefined, scroller).find(e => { const b = e.getBoundingClientRect(); return b.bottom > top && b.top < rect.bottom; });
      const hit = document.elementFromPoint(rect.left + rect.width / 2, top + 8);
      const line = hit && scroller.contains(hit) && !hit.closest("[data-scroll-footer]") ? hit : null;
      const row = {
        seq: first ? rowSeq(first) : null,
        off: first ? Math.round(first.getBoundingClientRect().top - top) : null,
        st: Math.round(scroller.scrollTop),
        sh: scroller.scrollHeight,
        ch: scroller.clientHeight,
        gap: Math.round(scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop),
        op: opacityOf(first ?? scroller),
        line: line ? [(line.textContent ?? "").trim().slice(0, 24), Math.round(line.getBoundingClientRect().top - top)] : null,
      };
      const key = JSON.stringify(row);
      if (key !== last) { last = key; emitTrace("sample", threadId, row); }
    }
  };
  const loop = () => {
    if (!traceOn() || retired) return;
    try { step(); } catch (error) { emitTrace("sample-error", null, String(error).slice(0, 200)); }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

function listen(target: EventTarget, type: string, listener: (event: Event) => void, options: AddEventListenerOptions) {
  target.addEventListener(type, listener, options);
  removers.push(() => target.removeEventListener(type, listener, options));
}

function install() {
  if (installed || retired) return;
  installed = true;
  (window as DebugWindow).__radarScrollDebug = true;
  listen(window, "radar-scroll-trace", event => {
    buffer.push((event as CustomEvent<TraceEvent>).detail);
    if (buffer.length > BUFFER_MAX) buffer.splice(0, buffer.length - BUFFER_MAX);
  }, {});
  for (const type of ["visibilitychange", "pagehide", "pageshow", "freeze", "resume"]) listen(document, type, () => emitTrace(type, null, { state: document.visibilityState }), { capture: true });
  for (const type of ["touchstart", "touchend", "touchcancel", "pointercancel"]) listen(document, type, event => emitTrace(`in:${type}`, null, (event as TouchEvent).touches ? { touches: (event as TouchEvent).touches.length } : null), { capture: true, passive: true });
  emitTrace("page", null, { agent: navigator.userAgent, width: innerWidth, height: innerHeight, dpr: devicePixelRatio, path: location.pathname });
  sample();
}

export function startScrollTrace() {
  try { if (localStorage.getItem(FLAG_KEY) === "1") install(); } catch {}
  return () => {
    retired = true;
    for (const remove of removers.splice(0)) remove();
    for (const unhook of unhooks.splice(0)) unhook();
    buffer.length = 0;
  };
}

type TraceRpc = {
  call(method: "scroll_debug", input: Record<string, never>): Promise<{ on: boolean }>;
  call(method: "scroll_trace", input: { deviceId: string; page: string; agent?: string; events: TraceEvent[] }): Promise<{ on: boolean }>;
};
export function flushScrollTrace(rpc: TraceRpc, deviceId: string) {
  let stopped = false, sending = false, sentAgent = false;
  const setFlag = (on: boolean) => {
    try { if (on) localStorage.setItem(FLAG_KEY, "1"); else localStorage.removeItem(FLAG_KEY); } catch {}
    if (on) install();
  };
  void rpc.call("scroll_debug", {}).then(result => { if (!stopped) setFlag(result.on); }, () => {});
  const send = async () => {
    sending = true;
    const events = buffer.splice(0, BATCH_MAX);
    try {
      const result = await rpc.call("scroll_trace", sentAgent ? { deviceId, page, events } : { deviceId, page, agent: navigator.userAgent.slice(0, 400), events });
      sentAgent = true;
      if (!result.on) { setFlag(false); (window as DebugWindow).__radarScrollDebug = false; buffer.length = 0; }
    } catch {
      if (buffer.length < BUFFER_MAX) buffer.unshift(...events);
    } finally {
      sending = false;
    }
  };
  const timer = setInterval(() => {
    if (stopped || retired || sending || !installed || !buffer.length) return;
    void send();
  }, 1000);
  return () => { stopped = true; clearInterval(timer); };
}

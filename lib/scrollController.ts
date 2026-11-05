import { capturePosition, restoreDelta, type ScrollPosition } from "./scrollPosition";
import { chatShownAt } from "./primeScrollRoute";

const LATE_MS = 300;
const HIDE_MAX_MS = 1200;
const FIND_MAX_MS = 10000;
const WAIT_MAX_MS = 5000;
const SETTLE_QUIET_MS = 1200;
const SETTLE_MAX_MS = 4000;
const PIN_GAP = 4;
const GESTURE_TAIL_MS = 300;
const MOMENTUM_MS = 1500;
const HELD_MAX_MS = 15000;
const FINGER_MS = 60;
const scrollKeys = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "]);
const PLACED_PX = 1;
const FLASH_MS = 2000;

export type ScrollStore = {
  cached?: ScrollPosition | null;
  load?: () => Promise<ScrollPosition | null>;
  save: (position: ScrollPosition) => void;
  loadAnchor?: (seq: number) => void;
  anchorReady?: () => void;
  cancelAnchor?: () => void;
};

type Phase = "waiting" | "restoring" | "settling" | "live";

export function messageAnchors(threadId: string) {
  return Array.from(document.querySelectorAll<HTMLElement>("[data-notification-thread][data-notification-message]")).filter(e => e.dataset.notificationThread === threadId && Number.isSafeInteger(Number(e.dataset.notificationMessage)) && Number(e.dataset.notificationMessage) > 0);
}
export function chatScroller(threadId: string): HTMLElement | null {
  for (const anchor of messageAnchors(threadId)) {
    for (let el = anchor.parentElement; el && el !== document.body; el = el.parentElement) {
      if (/^(auto|scroll)$/.test(getComputedStyle(el).overflowY) && el.clientHeight > 0) return el;
    }
  }
  return null;
}
function rowsColumn(container: HTMLElement) {
  const list = container.querySelector<HTMLElement>('[data-timeline-row-list="top-level"]');
  if (!list) return null;
  for (let el: HTMLElement | null = list; el && el !== container; el = el.parentElement) {
    if (el.parentElement?.parentElement === container) return el.hasAttribute("data-scroll-footer") ? list : el;
  }
  return list;
}

export function rememberScroll(threadId: string, store: ScrollStore, isActive = () => document.visibilityState === "visible" && document.hasFocus()) {
  const trace = (event: string, data: unknown = null) => {
    if ((window as Window & { __radarScrollDebug?: boolean }).__radarScrollDebug) window.dispatchEvent(new CustomEvent("radar-scroll-trace", { detail: { event, threadId, data, at: performance.now(), wallTime: performance.timeOrigin + performance.now(), hash: location.hash } }));
  };
  const startedAt = performance.now();
  let position: ScrollPosition | null = store.cached ?? null;
  let phase: Phase = position && !position.atBottom ? "restoring" : position || !store.load ? "live" : "waiting";
  trace("begin", { position, phase });
  let disposed = false, frozen = false, keepSaved = false;
  let container: HTMLElement | null = null, boundAt = 0, resize: ResizeObserver | null = null, frame = 0;
  let veil: { element: HTMLElement; visibility: string; behavior: string } | null = null, veiledAt = 0;
  let requested = false, stable = 0, settledAt = 0, lastFixAt = 0;
  let fingerRef: { seq: number; offset: number } | null = null, fingerMovedAt = -Infinity;
  let fine: { element: Element; offset: number } | null = null;
  let touching = false, pointerDown = false, touchAt = -Infinity, gestureAt = -Infinity, userScrollAt = -Infinity, ownTop: number | null = null;
  let pinned = false, lastHeight = 0, lastScrollHeight = 0, lastWidth = 0;
  let muted: HTMLElement | null = null;
  let lastFine: { element: Element; offset: number } | null = null;
  let lastSaved = "", lastAnchor: ScrollPosition | null = null, saveTimer: ReturnType<typeof setTimeout> | undefined;

  const now = () => performance.now();
  const held = () => (touching || pointerDown) && now() - touchAt < HELD_MAX_MS;
  const gestureActive = () => held() || now() - gestureAt < GESTURE_TAIL_MS || now() - userScrollAt < GESTURE_TAIL_MS;
  const deferredByHost = () => container !== null && Boolean(rowsColumn(container)?.style.transform);
  const measure = () => {
    if (!container) return;
    lastHeight = container.clientHeight;
    lastWidth = container.clientWidth;
    lastScrollHeight = container.scrollHeight;
    pinned = lastScrollHeight - lastHeight - container.scrollTop <= PIN_GAP;
  };
  const write = (top: number) => {
    if (!container) return;
    container.dispatchEvent(new WheelEvent("wheel", { deltaY: 0, bubbles: false, cancelable: false }));
    const behavior = container.style.scrollBehavior;
    container.style.scrollBehavior = "auto";
    container.scrollTop = top;
    container.style.scrollBehavior = behavior;
    ownTop = container.scrollTop;
  };
  const hide = () => {
    if (veil && !veil.element.isConnected) veil = null;
    if (veil || !container) return;
    const element = rowsColumn(container);
    if (!element) return;
    veil = { element, visibility: element.style.visibility, behavior: container.style.scrollBehavior };
    element.style.visibility = "hidden";
    container.style.scrollBehavior = "auto";
    veiledAt = now();
    trace("hide");
  };
  const show = () => {
    if (!veil) return;
    veil.element.style.visibility = veil.visibility;
    if (container) container.style.scrollBehavior = veil.behavior;
    trace("show", { hiddenMs: Math.round(now() - veiledAt) });
    veil = null;
  };
  const anchorFor = (seq: number) => messageAnchors(threadId).find(e => Number(e.dataset.notificationMessage) === seq && container!.contains(e)) ?? null;
  const targetFor = (anchor: HTMLElement, offset: number) => {
    const delta = restoreDelta(anchor.getBoundingClientRect().top, container!.getBoundingClientRect().top + container!.clientTop, offset);
    return Math.min(Math.max(container!.scrollTop + delta, 0), Math.max(0, container!.scrollHeight - container!.clientHeight));
  };
  const lateFor = (found: HTMLElement, at: number) => {
    const shownAt = chatShownAt(found, threadId);
    return shownAt === null ? 0 : at - shownAt;
  };

  const mute = (element: HTMLElement) => {
    muted?.removeAttribute("data-radar-scroll-restore");
    muted = element;
    element.setAttribute("data-radar-scroll-restore", "");
  };
  const unmute = (delay: number) => {
    const element = muted;
    muted = null;
    if (!element) return;
    if (delay <= 0) element.removeAttribute("data-radar-scroll-restore");
    else setTimeout(() => element.removeAttribute("data-radar-scroll-restore"), delay);
  };
  const goLive = (reason: string) => {
    if (phase === "live") return;
    unmute(FLASH_MS);
    show();
    phase = "live";
    observer.disconnect();
    measure();
    trace("live", { reason, keepSaved });
  };
  const abandon = (reason: string) => {
    keepSaved = true;
    if (requested && phase === "restoring") store.cancelAnchor?.();
    goLive(reason);
  };
  const topElement = () => {
    if (!container) return null;
    const bounds = container.getBoundingClientRect();
    const top = bounds.top + container.clientTop;
    const hit = document.elementFromPoint(bounds.left + bounds.width / 2, top + 6);
    const message = hit?.closest<HTMLElement>("[data-notification-thread][data-notification-message]");
    if (!hit || !message || message.dataset.notificationThread !== threadId || !container.contains(message)) return null;
    return { element: hit, offset: hit.getBoundingClientRect().top - top };
  };
  const pickFine = () => {
    fine = position && !position.atBottom ? topElement() : null;
  };
  const settle = () => {
    show();
    phase = "settling";
    settledAt = lastFixAt = now();
    pickFine();
    if (requested) store.anchorReady?.();
    trace("placed", { position, top: container ? Math.round(container.scrollTop) : null });
    measure();
  };

  const attempt = (frameTick = false) => {
    if (disposed || phase !== "restoring") return;
    const found = bind();
    if (phase !== "restoring") return;
    if (!found) { if (now() - startedAt > FIND_MAX_MS) abandon("no-chat"); return; }
    if (!position || position.atBottom) { goLive("bottom"); return; }
    if (deferredByHost()) return;
    const anchor = anchorFor(position.messageSeq);
    const expired = veil !== null && now() - veiledAt > HIDE_MAX_MS;
    if (!anchor) {
      hide();
      if (!requested && store.loadAnchor) { requested = true; mute(found); trace("load-anchor", position.messageSeq); store.loadAnchor(position.messageSeq); }
      if (expired) abandon("anchor-timeout");
      return;
    }
    const target = targetFor(anchor, position.offset);
    if (Math.abs(target - found.scrollTop) > PLACED_PX) {
      trace("adjust", { from: Math.round(found.scrollTop), to: Math.round(target) });
      write(target);
      stable = 0;
      if (expired) settle();
      return;
    }
    if (frameTick) stable++;
    if (!veil) { settle(); return; }
    if (stable >= 2 || expired) settle();
  };
  const keep = () => {
    if (disposed || phase !== "settling") return;
    if (!container?.isConnected || !position || position.atBottom) { goLive("settled"); return; }
    if (gestureActive()) { goLive("gesture"); return; }
    const t = now();
    if (t - settledAt > SETTLE_MAX_MS || t - lastFixAt > SETTLE_QUIET_MS) { goLive("settled"); return; }
    if (deferredByHost()) return;
    const pin = fine?.element.isConnected ? fine : null;
    const anchor = pin ? pin.element as HTMLElement : anchorFor(position.messageSeq);
    if (!anchor) return;
    const target = targetFor(anchor, pin ? pin.offset : position.offset);
    if (Math.abs(target - container.scrollTop) > PLACED_PX) {
      trace("keep", { from: Math.round(container.scrollTop), to: Math.round(target) });
      write(target);
      lastFixAt = t;
    }
  };
  const hold = (reason: string) => {
    if (!lastAnchor || lastAnchor.atBottom || !container) return;
    position = lastAnchor;
    phase = "settling";
    settledAt = lastFixAt = now();
    observer.observe(document.documentElement, { childList: true, subtree: true });
    fine = lastFine?.element.isConnected ? lastFine : null;
    trace("hold", { reason, position, fine: fine ? Math.round(fine.offset) : null });
    frame = requestAnimationFrame(tick);
    keep();
  };

  const firstVisible = () => {
    if (!container) return null;
    const top = container.getBoundingClientRect().top + container.clientTop;
    let best: { seq: number; offset: number } | null = null;
    for (const anchor of messageAnchors(threadId)) {
      if (!container.contains(anchor)) continue;
      const bounds = anchor.getBoundingClientRect();
      if (bounds.bottom <= top || bounds.top >= top + container.clientHeight) continue;
      if (!best || bounds.top - top < best.offset) best = { seq: Number(anchor.dataset.notificationMessage), offset: bounds.top - top };
    }
    return best;
  };
  const keepFinger = () => {
    if (!container || !fingerRef || deferredByHost()) return;
    const anchor = anchorFor(fingerRef.seq);
    if (!anchor) return;
    const target = targetFor(anchor, fingerRef.offset);
    if (Math.abs(target - container.scrollTop) <= 0.5) return;
    trace("finger-hold", { from: Math.round(container.scrollTop), to: Math.round(target) });
    write(target);
  };
  const capture = (force = false) => {
    if (disposed || frozen || phase !== "live" || keepSaved || !force && !isActive()) return;
    const found = bind();
    if (!found?.isConnected) return;
    if (Math.abs(found.clientWidth - lastWidth) >= 1) return;
    const anchors = messageAnchors(threadId).filter(e => found.contains(e));
    if (!anchors.length) return;
    const rect = found.getBoundingClientRect();
    const next = capturePosition(found.scrollTop, found.clientHeight, found.scrollHeight, rect.top + found.clientTop, anchors.filter(e => {
      const row = e.closest<HTMLElement>("[data-timeline-row-id]") ?? e;
      const bounds = row.getBoundingClientRect();
      return bounds.bottom > rect.top && bounds.top < rect.bottom;
    }).map(e => ({ seq: Number(e.dataset.notificationMessage), top: e.getBoundingClientRect().top, bottom: e.getBoundingClientRect().bottom })));
    if (!next) return;
    lastAnchor = next;
    lastFine = next.atBottom ? null : topElement();
    if (JSON.stringify(next) === lastSaved) return;
    lastSaved = JSON.stringify(next);
    trace("capture", next);
    store.save(next);
  };

  const onScroll = () => {
    if (!container) return;
    const ours = ownTop !== null && Math.abs(container.scrollTop - ownTop) < 1;
    if (!ours && (held() || now() - gestureAt < MOMENTUM_MS)) userScrollAt = now();
    if (phase === "restoring") { attempt(); return; }
    if (phase === "settling") { keep(); return; }
    if (Math.abs(container.clientWidth - lastWidth) >= 1) { resized(); return; }
    if (held() && touching) {
      if (ours) return;
      if (now() - fingerMovedAt < FINGER_MS) fingerRef = firstVisible();
      else keepFinger();
    }
    measure();
    capture();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => capture(), 120);
  };
  const resized = () => {
    if (!container || disposed) return;
    if (phase === "restoring") { attempt(); return; }
    if (phase === "settling") { keep(); return; }
    if (phase !== "live") { measure(); return; }
    if (held() && touching && fingerRef) { keepFinger(); measure(); return; }
    const widthChanged = Math.abs(container.clientWidth - lastWidth) >= 1;
    const changed = widthChanged || lastHeight !== container.clientHeight || lastScrollHeight !== container.scrollHeight;
    if (changed && pinned && !gestureActive()) {
      const bottom = container.scrollHeight - container.clientHeight;
      if (bottom - container.scrollTop > 0.5) {
        trace("follow", { from: Math.round(container.scrollTop), to: Math.round(bottom) });
        container.scrollTop = bottom;
        ownTop = container.scrollTop;
      }
    } else if (widthChanged && !pinned && !gestureActive() && !keepSaved) {
      hold("width");
      return;
    }
    measure();
  };
  const bind = () => {
    if (container?.isConnected) return container;
    const found = chatScroller(threadId);
    if (found === container) return container;
    show();
    resize?.disconnect();
    container?.removeEventListener("scroll", onScroll);
    container = found;
    if (!container) return null;
    boundAt = now();
    ownTop = null;
    measure();
    container.addEventListener("scroll", onScroll, { passive: true });
    if (typeof ResizeObserver !== "undefined") {
      resize = new ResizeObserver(resized);
      resize.observe(container);
      if (container.firstElementChild) resize.observe(container.firstElementChild);
    }
    if (phase === "restoring") {
      const late = lateFor(container, boundAt);
      if (late > LATE_MS) { trace("late-skip", { shownMs: Math.round(late) }); keepSaved = true; goLive("late"); }
    }
    return container;
  };

  const interacted = (type: string) => {
    frozen = false;
    keepSaved = false;
    if (phase === "live") return;
    trace("input", type);
    if (phase === "restoring" && requested) store.cancelAnchor?.();
    goLive("input");
  };
  const onInput = (event: Event) => {
    if (!event.isTrusted) return;
    const t = now();
    const inside = container !== null && event.target instanceof Node && container.contains(event.target);
    switch (event.type) {
      case "touchend": case "touchcancel": if (touching) { touching = (event as TouchEvent).touches.length > 0; gestureAt = t; } return;
      case "pointerup": case "pointercancel": if (pointerDown) { pointerDown = false; gestureAt = t; } return;
      case "touchmove": if (touching) fingerMovedAt = t; return;
      case "touchstart": if (inside) { touching = true; touchAt = t; fingerRef = phase === "live" ? firstVisible() : null; } break;
      case "pointerdown": if (inside && (event as PointerEvent).pointerType !== "touch") { pointerDown = true; touchAt = t; } break;
      case "wheel": if (inside) gestureAt = t; break;
      case "keydown": if (scrollKeys.has((event as KeyboardEvent).key)) gestureAt = t; break;
    }
    if (inside || event.type === "keydown" || event.type === "beforeinput") interacted(event.type);
  };
  const inputEvents = ["touchstart", "touchmove", "touchend", "touchcancel", "pointerdown", "pointerup", "pointercancel", "wheel", "keydown", "beforeinput"];
  for (const type of inputEvents) document.addEventListener(type, onInput, { capture: true, passive: true });
  const freeze = () => { frozen = true; clearTimeout(saveTimer); };
  const thaw = (event: PageTransitionEvent) => { if (event.persisted) frozen = false; };
  window.addEventListener("pagehide", freeze);
  window.addEventListener("beforeunload", freeze);
  document.addEventListener("freeze", freeze);
  window.addEventListener("pageshow", thaw);

  const observer = new MutationObserver(() => { if (phase === "restoring") attempt(); else if (phase === "settling") keep(); });
  const tick = () => {
    if (phase === "restoring") attempt(true);
    else if (phase === "settling") keep();
    if (phase === "restoring" || phase === "settling") frame = requestAnimationFrame(tick);
  };
  if (phase === "waiting") {
    void store.load!().then(value => {
      if (disposed || phase !== "waiting") return;
      position = value;
      trace("loaded", value);
      if (!value || value.atBottom) { goLive("loaded"); return; }
      const found = bind();
      const late = found ? lateFor(found, now()) : 0;
      if (found && late > LATE_MS) { trace("late-skip", { shownMs: Math.round(late) }); keepSaved = true; goLive("late"); return; }
      phase = "restoring";
      observer.observe(document.documentElement, { childList: true, subtree: true });
      attempt();
      frame = requestAnimationFrame(tick);
    }, () => goLive("load-failed"));
  }
  if (phase === "restoring") {
    observer.observe(document.documentElement, { childList: true, subtree: true });
    attempt();
    frame = requestAnimationFrame(tick);
  } else bind();
  const timer = setInterval(() => {
    if (phase === "restoring") attempt();
    else if (phase === "settling") keep();
    else if (phase === "waiting" && now() - startedAt > WAIT_MAX_MS) { keepSaved = true; goLive("load-timeout"); }
    else capture();
  }, 200);

  return () => {
    trace("dispose", { phase });
    if (phase === "live" && !frozen) capture(true);
    if (phase === "restoring" && requested) store.cancelAnchor?.();
    disposed = true;
    show();
    unmute(FLASH_MS);
    observer.disconnect();
    resize?.disconnect();
    cancelAnimationFrame(frame);
    clearInterval(timer);
    clearTimeout(saveTimer);
    container?.removeEventListener("scroll", onScroll);
    for (const type of inputEvents) document.removeEventListener(type, onInput, true);
    window.removeEventListener("pagehide", freeze);
    window.removeEventListener("beforeunload", freeze);
    document.removeEventListener("freeze", freeze);
    window.removeEventListener("pageshow", thaw);
  };
}

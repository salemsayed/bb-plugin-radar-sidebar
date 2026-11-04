import { capturePosition, restoreDelta, type ScrollPosition } from "./scrollPosition";

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
export function rememberScroll(threadId: string, store: { load: () => Promise<ScrollPosition | null>; save: (position: ScrollPosition) => void; cached?: ScrollPosition | null; deferUntilVisible?: boolean; cancelAnchor?: () => void; loadAnchor?: (seq: number) => void; anchorReady?: () => void }, isActive = () => document.visibilityState === "visible" && document.hasFocus()) {
  const trace = (event: string, data: unknown = null) => {
    if ((window as Window & { __radarScrollDebug?: boolean }).__radarScrollDebug) window.dispatchEvent(new CustomEvent("radar-scroll-trace", { detail: { event, threadId, data, at: performance.now(), wallTime: performance.timeOrigin + performance.now(), hash: location.hash } }));
  };
  trace("begin", store.cached);
  trace("mode", { cold: store.deferUntilVisible === true });
  let disposed = false, restoring = true, loaded = store.cached != null, interacted = false, failed = false;
  let position = store.cached ?? null;
  let container: HTMLElement | null = null;
  let resize: ResizeObserver | null = null;
  let previousBehavior = "";
  let frame = 0, started = performance.now(), requestedAnchor = false, firstContainerAt: number | null = null, matched = false, matchedAt: number | null = null, releasedRoute = false;
  let visibleAt: number | null = null;
  let handlingScroll = false;
  let bottomPinned = false, lastHeight = 0, lastScrollHeight = 0;
  const inputEvents = ["wheel", "touchstart", "pointerdown", "keydown", "beforeinput", "input"];
  const measure = () => {
    if (!container) return;
    lastHeight = container.clientHeight;
    lastScrollHeight = container.scrollHeight;
    bottomPinned = lastScrollHeight - lastHeight - container.scrollTop <= 24;
  };
  const resized = () => {
    if (!container || disposed) return;
    if (restoring) apply();
    else if (bottomPinned && (lastHeight !== container.clientHeight || lastScrollHeight !== container.scrollHeight)) {
      container.scrollTop = container.scrollHeight;
    }
    measure();
  };
  let lastSaved = "", saveTimer: ReturnType<typeof setTimeout> | undefined;
  const reveal = () => {
    if (container) { container.style.scrollBehavior = previousBehavior; }
  };
  const bind = () => {
    if (container?.isConnected) return;
    const found = chatScroller(threadId);
    if (found !== container) {
      reveal();
      resize?.disconnect();
      container?.removeEventListener("scroll", onScroll);
      container = found;
      if (container) {
        measure();
        previousBehavior = container.style.scrollBehavior;
        container.addEventListener("scroll", onScroll, { passive: true });
        if (typeof ResizeObserver !== "undefined") {
          resize = new ResizeObserver(resized);
          resize.observe(container);
          if (container.firstElementChild) resize.observe(container.firstElementChild);
        }
      }
    }
  };
  const capture = (force = false) => {
    if (disposed || restoring || failed || !force && !isActive()) return;
    bind();
    if (!container?.isConnected) return;
    const anchors = messageAnchors(threadId).filter(e => container!.contains(e));
    if (!anchors.length) return;
    const rect = container.getBoundingClientRect();
    const next = capturePosition(container.scrollTop, container.clientHeight, container.scrollHeight, rect.top + container.clientTop, anchors.filter(e => {
      const row = e.closest<HTMLElement>("[data-timeline-row-id]") ?? e;
      const bounds = row.getBoundingClientRect();
      return bounds.bottom > rect.top && bounds.top < rect.bottom;
    }).map(e => ({ seq: Number(e.dataset.notificationMessage), top: e.getBoundingClientRect().top, bottom: e.getBoundingClientRect().bottom })));
    if (!next || JSON.stringify(next) === lastSaved) return;
    lastSaved = JSON.stringify(next);
    trace("capture", next);
    store.save(next);
  };
  const finish = () => { trace("finish", { position, matched, failed, interacted }); restoring = false; measure(); reveal(); if (failed) store.cancelAnchor?.(); };
  const input = (event: Event) => {
    if (interacted) return;
    trace("input", event.type);
    interacted = true;
    failed = false;
    finish();
    if (!matched) store.cancelAnchor?.();
  };
  const onScroll = () => {
    if (restoring) {
      if (!handlingScroll) {
        handlingScroll = true;
        try { apply(); } finally { handlingScroll = false; }
      }
      return;
    }
    resized();
    capture();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(capture, 120);
  };
  const apply = () => {
    if (disposed || !restoring) return;
    bind();
    if (loaded && (!position || position.atBottom)) { finish(); return; }
    if (store.deferUntilVisible && position && !position.atBottom) {
      if (!container) {
        if (performance.now() - started > 10000) { failed = true; finish(); }
        return;
      }
      if (visibleAt === null) {
        const bounds = container.getBoundingClientRect();
        const visible = [0.05, 0.15, 0.25, 0.35, 0.45, 0.55, 0.65, 0.75, 0.85, 0.95].some(fraction => {
          const hit = document.elementFromPoint((bounds.left + bounds.right) / 2, bounds.top + bounds.height * fraction);
          const message = hit?.closest<HTMLElement>("[data-notification-thread][data-notification-message]");
          if (!message || message.dataset.notificationThread !== threadId || !container!.contains(message)) return false;
          for (let node: HTMLElement | null = message; node; node = node.parentElement) {
            const style = getComputedStyle(node);
            if (style.visibility !== "visible" || style.display === "none" || style.opacity === "0") return false;
          }
          return true;
        });
        if (!visible) { if (performance.now() - started > 10000) { failed = true; finish(); } return; }
        visibleAt = performance.now(); trace("native-visible");
      }
      if (performance.now() - visibleAt < 40) return;
    }
    if (position && !position.atBottom) {
      const anchor = messageAnchors(threadId).find(e => Number(e.dataset.notificationMessage) === position!.messageSeq && container?.contains(e));
      if (anchor && container) {
        container.style.scrollBehavior = "auto";
        trace("adjust", { position, top: container.scrollTop });
        container.scrollTop += restoreDelta(anchor.getBoundingClientRect().top, container.getBoundingClientRect().top + container.clientTop, position.offset);
        matched = true;
        matchedAt ??= performance.now();
        if (!releasedRoute) { releasedRoute = true; store.anchorReady?.(); }
      } else if (!requestedAnchor && store.loadAnchor) {
        requestedAnchor = true;
        trace("load-anchor", position.messageSeq);
        store.loadAnchor(position.messageSeq);
      }
    }
    if (container) firstContainerAt ??= performance.now();
    if (matchedAt !== null && performance.now() - matchedAt >= 6000 || !matched && firstContainerAt !== null && performance.now() - firstContainerAt >= 8000 || performance.now() - started > 10000) {
      failed = !matched && position?.atBottom !== true;
      finish();
    }
  };
  const observer = new MutationObserver(apply);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  const tick = () => {
    apply();
    if (restoring) frame = requestAnimationFrame(tick);
    else observer.disconnect();
  };
  for (const type of inputEvents) document.addEventListener(type, input, { capture: true, passive: true });
  void store.load().then(value => { if (!disposed && !interacted && !loaded) { position = value; loaded = true; apply(); } }).catch(() => { loaded = true; });
  tick();
  const timer = setInterval(() => capture(), 400);
  return () => {
    trace("dispose");
    capture(true);
    disposed = true;
    observer.disconnect();
    resize?.disconnect();
    cancelAnimationFrame(frame);
    clearInterval(timer);
    clearTimeout(saveTimer);
    container?.removeEventListener("scroll", onScroll);
    reveal();
    for (const type of inputEvents) document.removeEventListener(type, input, true);
  };
}

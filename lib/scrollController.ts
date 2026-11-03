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
export function rememberScroll(threadId: string, store: { load: () => Promise<ScrollPosition | null>; save: (position: ScrollPosition) => void; cached?: ScrollPosition | null; loadAnchor?: (seq: number) => void; anchorReady?: () => void }, isActive = () => document.visibilityState === "visible" && document.hasFocus()) {
  const trace = (event: string, data: unknown = null) => {
    if ((window as Window & { __radarScrollDebug?: boolean }).__radarScrollDebug) window.dispatchEvent(new CustomEvent("radar-scroll-trace", { detail: { event, threadId, data, at: performance.now(), hash: location.hash } }));
  };
  trace("begin", store.cached);
  let disposed = false, restoring = true, loaded = store.cached != null, interacted = false, failed = false;
  let position = store.cached ?? null;
  let container: HTMLElement | null = null;
  let resize: ResizeObserver | null = null;
  let previousBehavior = "";
  let frame = 0, started = performance.now(), requestedAnchor = false, firstContainerAt: number | null = null, matched = false, releasedRoute = false;
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
        previousBehavior = container.style.scrollBehavior;
        container.addEventListener("scroll", onScroll, { passive: true });
        if (typeof ResizeObserver !== "undefined") {
          resize = new ResizeObserver(() => apply());
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
    const rect = container.getBoundingClientRect();
    const next = capturePosition(container.scrollTop, container.clientHeight, container.scrollHeight, rect.top + container.clientTop, messageAnchors(threadId).filter(e => {
      if (!container!.contains(e)) return false;
      const row = e.closest<HTMLElement>("[data-timeline-row-id]") ?? e;
      const bounds = row.getBoundingClientRect();
      return bounds.bottom > rect.top && bounds.top < rect.bottom;
    }).map(e => ({ seq: Number(e.dataset.notificationMessage), top: e.getBoundingClientRect().top, bottom: e.getBoundingClientRect().bottom })));
    if (!next || JSON.stringify(next) === lastSaved) return;
    lastSaved = JSON.stringify(next);
    trace("capture", next);
    store.save(next);
  };
  const finish = () => { trace("finish", { position, matched, failed, interacted }); restoring = false; reveal(); };
  const input = (event: Event) => {
    if (event instanceof KeyboardEvent && !["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " ", "Tab"].includes(event.key)) return;
    trace("input", event.type);
    interacted = true;
    failed = false;
    finish();
  };
  const onScroll = () => {
    capture();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(capture, 120);
  };
  const apply = () => {
    if (disposed || !restoring) return;
    bind();
    if (loaded && (!position || position.atBottom)) { finish(); return; }
    if (position && !position.atBottom) {
      const anchor = messageAnchors(threadId).find(e => Number(e.dataset.notificationMessage) === position!.messageSeq && container?.contains(e));
      if (anchor && container) {
        container.style.scrollBehavior = "auto";
        trace("adjust", { position, top: container.scrollTop });
        container.scrollTop += restoreDelta(anchor.getBoundingClientRect().top, container.getBoundingClientRect().top + container.clientTop, position.offset);
        matched = true;
        if (!releasedRoute) { releasedRoute = true; store.anchorReady?.(); }
      } else if (!requestedAnchor && store.loadAnchor) {
        requestedAnchor = true;
        store.loadAnchor(position.messageSeq);
      }
    }
    if (container) firstContainerAt ??= performance.now();
    if (firstContainerAt !== null && performance.now() - firstContainerAt >= (matched ? 6000 : 8000) || performance.now() - started > 10000) {
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
  for (const type of ["wheel", "touchstart", "pointerdown", "keydown"]) document.addEventListener(type, input, { capture: true, passive: true });
  void store.load().then(value => { if (!disposed && !interacted && !loaded) { position = value; loaded = true; apply(); } }).catch(() => { loaded = true; });
  tick();
  const timer = setInterval(() => capture(), 400);
  return () => {
    trace("dispose");
    disposed = true;
    observer.disconnect();
    resize?.disconnect();
    cancelAnimationFrame(frame);
    clearInterval(timer);
    clearTimeout(saveTimer);
    container?.removeEventListener("scroll", onScroll);
    reveal();
    for (const type of ["wheel", "touchstart", "pointerdown", "keydown"]) document.removeEventListener(type, input, true);
  };
}

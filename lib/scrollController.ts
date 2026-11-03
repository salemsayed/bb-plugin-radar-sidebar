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
export function rememberScroll(threadId: string, store: { load: () => Promise<ScrollPosition | null>; save: (position: ScrollPosition) => void; cached?: ScrollPosition | null; loadAnchor?: (seq: number) => void }, isActive = () => document.visibilityState === "visible" && document.hasFocus()) {
  let disposed = false, restoring = true, loaded = false, interacted = false, failed = false;
  let position = store.cached ?? null;
  let container: HTMLElement | null = null;
  let previousVisibility = "", previousBehavior = "";
  let frame = 0, started = performance.now(), stableSince = started, lastShape = "", requestedAnchor = false, anchorSince: number | null = null;
  let lastSaved = "", saveTimer: ReturnType<typeof setTimeout> | undefined;
  const reveal = () => {
    if (container) { container.style.visibility = previousVisibility; container.style.scrollBehavior = previousBehavior; }
  };
  const bind = () => {
    const found = chatScroller(threadId);
    if (found !== container) {
      reveal();
      container?.removeEventListener("scroll", onScroll);
      container = found;
      if (container) {
        previousVisibility = container.style.visibility;
        previousBehavior = container.style.scrollBehavior;
        container.addEventListener("scroll", onScroll, { passive: true });
      }
    }
  };
  const capture = (force = false) => {
    if (disposed || restoring || failed || !force && !isActive()) return;
    bind();
    if (!container?.isConnected) return;
    const rect = container.getBoundingClientRect();
    const next = capturePosition(container.scrollTop, container.clientHeight, container.scrollHeight, rect.top + container.clientTop, messageAnchors(threadId).filter(e => container!.contains(e)).map(e => ({ seq: Number(e.dataset.notificationMessage), top: e.getBoundingClientRect().top, bottom: e.getBoundingClientRect().bottom })));
    if (!next || JSON.stringify(next) === lastSaved) return;
    lastSaved = JSON.stringify(next);
    store.save(next);
  };
  const finish = () => { restoring = false; reveal(); };
  const input = (event: Event) => {
    if (event instanceof KeyboardEvent && !["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " ", "Tab"].includes(event.key)) return;
    interacted = true;
    failed = false;
    finish();
  };
  const onScroll = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(capture, 120);
  };
  const tick = () => {
    if (disposed) return;
    bind();
    if (restoring && container) {
      if (!loaded || position && !position.atBottom) {
        container.style.visibility = "hidden";
        container.style.scrollBehavior = "auto";
      }
      if (loaded && (!position || position.atBottom)) finish();
      else if (loaded && position && !position.atBottom) {
        const anchor = messageAnchors(threadId).find(e => Number(e.dataset.notificationMessage) === position!.messageSeq && container!.contains(e));
        if (anchor) {
          anchorSince ??= performance.now();
          const delta = restoreDelta(anchor.getBoundingClientRect().top, container.getBoundingClientRect().top + container.clientTop, position.offset);
          const shape = `${container.scrollHeight}:${anchor.getBoundingClientRect().height}`;
          if (Math.abs(delta) > 1 || shape !== lastShape) stableSince = performance.now();
          lastShape = shape;
          container.scrollTop += delta;
          if (performance.now() - anchorSince > 1200 && performance.now() - stableSince > 500) finish();
        } else {
          anchorSince = null;
          if (!requestedAnchor && store.loadAnchor) { requestedAnchor = true; store.loadAnchor(position.messageSeq); }
          else if (!store.loadAnchor) { container.scrollTop = 0; container.dispatchEvent(new Event("scroll")); }
          stableSince = performance.now();
        }
      }
    }
    if (restoring && performance.now() - started > 8000) { failed = true; finish(); }
    if (restoring) frame = requestAnimationFrame(tick);
  };
  for (const type of ["wheel", "touchstart", "pointerdown", "keydown"]) document.addEventListener(type, input, { capture: true, passive: true });
  void store.load().then(value => { if (!disposed && !interacted) position = value; loaded = true; }).catch(() => { loaded = true; });
  tick();
  const timer = setInterval(() => capture(), 400);
  return () => {
    capture(true);
    disposed = true;
    cancelAnimationFrame(frame);
    clearInterval(timer);
    clearTimeout(saveTimer);
    container?.removeEventListener("scroll", onScroll);
    reveal();
    for (const type of ["wheel", "touchstart", "pointerdown", "keydown"]) document.removeEventListener(type, input, true);
  };
}

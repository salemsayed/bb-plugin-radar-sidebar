import { AT_BOTTOM, BOTTOM_GAP, capturePosition, restoreDelta, textHash, type LineAnchor, type ScrollPosition } from "./scrollPosition";
import { emitTrace } from "./scrollTrace";
import { LATE_CUT_MS, LATE_MS, VEIL_BUDGET_MS, VEIL_MAX_MS, VEIL_SAFETY_MS, armVeil, chatScroller, chatShownAt, claimPrime, messageAnchors, untouchedSince, unveilChat, veilChat, veilLifted, veiledSince } from "./primeScrollRoute";

export { chatScroller, messageAnchors };

const FIND_MAX_MS = 60000;
const WAIT_MAX_MS = 5000;
const STEADY_MAX_MS = 400;
const LINE_WAIT_MS = 600;
const REVEAL_MAX_MS = 400;
const SETTLE_QUIET_MS = 1200;
const SETTLE_MAX_MS = 20000;
const PAGE_GRACE_MS = 4000;
const GESTURE_TAIL_MS = 300;
const MOMENTUM_MS = 1500;
const HELD_MAX_MS = 15000;
const FINGER_MS = 500;
const INTENT_MS = 1500;
const CHAIN_MS = 250;
const SEND_MS = 4000;
const PLACED_PX = 1;
const FLASH_MS = 2000;
const scrollKeys = new Set(["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "]);

export type ScrollStore = {
  cached?: ScrollPosition | null;
  load?: () => Promise<ScrollPosition | null>;
  save: (position: ScrollPosition) => void;
  loadAnchor?: (seq: number) => void;
  anchorReady?: () => void;
  cancelAnchor?: () => void;
};

type Phase = "waiting" | "restoring" | "settling" | "live";
type Pin = { element: Element; offset: number };
type Line = { message: HTMLElement | null; element: HTMLElement; offset: number; anchor: LineAnchor };
const MESSAGE = "[data-notification-thread][data-notification-message]";
const ROW = "[data-timeline-row-id]";

function rowsColumn(container: HTMLElement) {
  const list = container.querySelector<HTMLElement>('[data-timeline-row-list="top-level"]');
  if (!list) return null;
  for (let el: HTMLElement | null = list; el && el !== container; el = el.parentElement) {
    if (el.parentElement?.parentElement === container) return el.hasAttribute("data-scroll-footer") ? list : el;
  }
  return list;
}
function hasBox(el: Element) {
  const display = getComputedStyle(el).display;
  return !display.startsWith("inline") && display !== "contents" && el.getBoundingClientRect().height > 0;
}
function blockOf(hit: Element, message: HTMLElement) {
  let el = hit as HTMLElement;
  while (el !== message && el.parentElement && !hasBox(el)) el = el.parentElement;
  return el;
}
function pathOf(element: HTMLElement, message: HTMLElement) {
  const path: number[] = [];
  for (let el = element; el !== message; el = el.parentElement!) {
    if (!el.parentElement || path.length >= 64) return null;
    path.unshift(Array.prototype.indexOf.call(el.parentElement.children, el));
  }
  return path;
}
function lineRoot(message: HTMLElement, line: LineAnchor, container: HTMLElement) {
  return (line.row ? container.querySelector<HTMLElement>(`[data-timeline-row-id="${CSS.escape(line.row)}"]`) : null) ?? (line.row ? message.closest<HTMLElement>(ROW) : message);
}
function byPath(root: HTMLElement, line: LineAnchor) {
  let el: Element | undefined = root;
  for (const index of line.path) {
    el = el.children[index];
    if (!el) return null;
  }
  return textHash(el.textContent ?? "") === line.hash && hasBox(el) ? el as HTMLElement : null;
}
function byText(root: HTMLElement, line: LineAnchor) {
  const rootTop = root.getBoundingClientRect().top;
  let best: HTMLElement | null = null, bestGap = Infinity;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  for (let node = walker.currentNode as HTMLElement | null; node; node = walker.nextNode() as HTMLElement | null) {
    if (textHash(node.textContent ?? "") !== line.hash || !hasBox(node)) continue;
    const gap = line.inner === undefined ? 0 : Math.abs(node.getBoundingClientRect().top - rootTop - line.inner);
    if (gap < bestGap) { best = node; bestGap = gap; }
    if (line.inner === undefined) break;
  }
  return best;
}

export function rememberScroll(threadId: string, store: ScrollStore, isActive = () => document.visibilityState === "visible" && document.hasFocus()) {
  const trace = (event: string, data: unknown = null) => emitTrace(event, threadId, data);
  const startedAt = performance.now();
  let position: ScrollPosition | null = store.cached ?? null;
  let phase: Phase = position && !position.atBottom ? "restoring" : position || !store.load ? "live" : "waiting";
  const primed = claimPrime(threadId);
  const primedBefore = primed?.before ?? false;
  trace("begin", { position, phase, primed: veiledSince(threadId) !== null, primedBefore });
  let disposed = false, frozen = false, keepSaved = false, lateChecked = false;
  let container: HTMLElement | null = null, resize: ResizeObserver | null = null, frame = 0;
  let veiledAt: number | null = veiledSince(threadId), rowsAt: number | null = null, quiet = false;
  let requested = primed?.requested ?? false, stable = 0, heights = 0, placedAt: number | null = null, settledAt = 0, lastFixAt = 0, changedAt = 0, lineReady = false, lineReadyAt: number | null = null, revealed = false;
  let lineCache: { root: HTMLElement; element: HTMLElement } | null = null, asked = false, oldestSeq = Infinity, progressAt = -Infinity;
  let fingerRef: Pin | null = null, fingerMovedAt = -Infinity, fingerMoved = false, dragged = false;
  let fine: Pin | null = null;
  let guardRef: Pin | null = null, intentAt = -Infinity, sentAt = -Infinity, sentSeq = 0;
  let touching = false, pointerDown = false, touchAt = -Infinity, gestureAt = -Infinity, userScrollAt = -Infinity, dragAt = -Infinity, ownTop: number | null = null;
  let pinned = false, lastHeight = 0, lastScrollHeight = 0, lastWidth = 0, lastScrollTop = 0, behavior: string | null = null;
  let muted: HTMLElement | null = primed?.requested ? document.documentElement : null;
  let lastFine: Pin | null = null;
  const widths = new Map<number, { anchor: ScrollPosition; fine: Pin | null; userAt: number }>();
  let lastSaved = "", lastAnchor: ScrollPosition | null = null, saveTimer: ReturnType<typeof setTimeout> | undefined;

  const now = () => performance.now();
  const held = () => (touching || pointerDown) && now() - touchAt < HELD_MAX_MS;
  const gestureActive = () => held() || now() - gestureAt < GESTURE_TAIL_MS || now() - dragAt < GESTURE_TAIL_MS;
  const gestureScroll = () => held() || now() - gestureAt < MOMENTUM_MS;
  const deferredByHost = () => container !== null && Boolean(rowsColumn(container)?.style.transform);
  const gap = () => container ? container.scrollHeight - container.clientHeight - container.scrollTop : 0;
  const atBottomNow = () => container !== null && gap() <= BOTTOM_GAP;
  const measure = () => {
    if (!container) return;
    lastHeight = container.clientHeight;
    lastWidth = container.clientWidth;
    lastScrollHeight = container.scrollHeight;
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
  const follow = (reason: string) => {
    if (!container || held()) return;
    const bottom = container.scrollHeight - container.clientHeight;
    if (bottom - container.scrollTop <= 0.5) return;
    trace("follow", { reason, from: Math.round(container.scrollTop), to: Math.round(bottom) });
    container.scrollTop = bottom;
    ownTop = container.scrollTop;
  };
  const composerEmpty = () => {
    const editor = container?.querySelector("[data-scroll-footer] [contenteditable=true], [data-scroll-footer] textarea");
    return !editor || (editor instanceof HTMLTextAreaElement ? editor.value : editor.textContent ?? "").trim() === "";
  };
  const setPinned = (value: boolean, reason: string) => {
    if (pinned === value) return;
    pinned = value;
    trace("pinned", { value, reason, gap: Math.round(gap()) });
  };
  const hide = () => {
    if (veiledAt !== null) return;
    veiledAt = veilChat(threadId, VEIL_MAX_MS + VEIL_SAFETY_MS);
    if (container && behavior === null) { behavior = container.style.scrollBehavior; container.style.scrollBehavior = "auto"; }
    trace("hide", { rows: rowsAt !== null });
  };
  const show = () => {
    const at = veiledAt;
    veiledAt = null;
    if (unveilChat(threadId) && at !== null) trace("show", { hiddenMs: Math.round(now() - at) });
    if (container && behavior !== null) container.style.scrollBehavior = behavior;
    behavior = null;
  };
  const anchorFor = (seq: number) => messageAnchors(threadId).find(e => Number(e.dataset.notificationMessage) === seq && container!.contains(e)) ?? null;
  const targetFor = (anchor: Element, offset: number) => {
    const delta = restoreDelta(anchor.getBoundingClientRect().top, container!.getBoundingClientRect().top + container!.clientTop, offset);
    return Math.min(Math.max(container!.scrollTop + delta, 0), Math.max(0, container!.scrollHeight - container!.clientHeight));
  };
  const lineAt = (): Line | null => {
    if (!container) return null;
    const bounds = container.getBoundingClientRect();
    const top = bounds.top + container.clientTop;
    for (const [x, y] of [[0.5, 6], [0.3, 6], [0.7, 6], [0.5, 24], [0.3, 24], [0.5, 48], [0.2, 48], [0.5, 96], [0.2, 96]]) {
      const hit = document.elementFromPoint(bounds.left + bounds.width * x, top + y);
      if (!hit || !container.contains(hit) || hit.closest("[data-scroll-footer]")) continue;
      const root = hit.closest<HTMLElement>(ROW);
      const row = root?.getAttribute("data-timeline-row-id");
      if (!root || !row || !container.contains(root)) continue;
      const found = hit.closest<HTMLElement>(MESSAGE);
      const message = found && found.dataset.notificationThread === threadId && Number(found.dataset.notificationMessage) > 0 ? found : null;
      const element = blockOf(hit, root);
      const path = pathOf(element, root);
      if (!path) continue;
      const offset = element.getBoundingClientRect().top - top;
      const inner = element.getBoundingClientRect().top - root.getBoundingClientRect().top;
      return { message, element, offset, anchor: { row, path, offset, hash: textHash(element.textContent ?? ""), inner } };
    }
    return null;
  };
  const searchLine = (anchor: HTMLElement, line: LineAnchor, offset: number) => {
    if (!container) return null;
    const bounds = container.getBoundingClientRect();
    const top = bounds.top + container.clientTop;
    const shift = anchor.getBoundingClientRect().top - top - offset;
    for (let d = 0; d <= 160; d += 8) {
      for (const y of d ? [6 + shift + d, 6 + shift - d] : [6 + shift]) {
        if (y < 0 || y > container.clientHeight) continue;
        const hit = document.elementFromPoint(bounds.left + bounds.width / 2, top + y);
        for (let el = hit as HTMLElement | null; el && el !== container && container.contains(el); el = el.parentElement) {
          if (el.getBoundingClientRect().top > top + y || !hasBox(el)) continue;
          if (textHash(el.textContent ?? "") === line.hash) return el;
          if (el.matches(ROW)) break;
        }
      }
    }
    return null;
  };
  const resolveLine = (message: HTMLElement, line: LineAnchor) => {
    if (!container) return null;
    const root = lineRoot(message, line, container);
    if (!root) return null;
    if (lineCache && lineCache.root === root && lineCache.element.isConnected && root.contains(lineCache.element)) return lineCache.element;
    const element = byPath(root, line) ?? byText(root, line);
    lineCache = element ? { root, element } : null;
    return element;
  };
  const placeFor = (anchor: HTMLElement): { target: number; pin: Pin | null } => {
    const line = position && !position.atBottom && position.line ? position.line : null;
    const element = line && container ? resolveLine(anchor, line) ?? searchLine(anchor, line, position && !position.atBottom ? position.offset : 0) : null;
    if (element && line) return { target: targetFor(element, line.offset), pin: { element, offset: line.offset } };
    return { target: targetFor(anchor, position && !position.atBottom ? position.offset : 0), pin: null };
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
    pinned = atBottomNow() || reason === "bottom" || reason === "loaded" && position?.atBottom === true;
    guardRef = visiblePin();
    trace("live", { reason, keepSaved, pinned });
    if (pinned) follow("live");
  };
  const abandon = (reason: string) => {
    keepSaved = true;
    quiet = true;
    if (requested && phase === "restoring") store.cancelAnchor?.();
    goLive(reason);
  };
  const heightsNow = () => {
    if (!container) return 0;
    const rect = container.getBoundingClientRect();
    let sum = container.scrollHeight;
    for (const row of container.querySelectorAll<HTMLElement>(ROW)) {
      const box = row.getBoundingClientRect();
      if (box.bottom > rect.top && box.top < rect.bottom) sum = Math.imul(sum, 31) + Math.round(box.height) | 0;
    }
    return sum;
  };
  const settle = () => {
    phase = "settling";
    settledAt = lastFixAt = now();
    show();
    const anchor = position && !position.atBottom ? anchorFor(position.messageSeq) : null;
    const placed = anchor ? placeFor(anchor).pin : null;
    const line = placed ? null : lineAt();
    fine = placed ?? (line ? { element: line.element, offset: line.offset } : null);
    if (requested) store.anchorReady?.();
    trace("placed", { position, top: container ? Math.round(container.scrollTop) : null, line: placed ? "saved" : line ? "visible" : null });
    measure();
  };

  const attempt = (frameTick = false) => {
    if (disposed || phase !== "restoring") return;
    if (veiledAt !== null && veilLifted(threadId)) { abandon("veil-lifted"); return; }
    if (!container?.isConnected && !document.querySelector(`[data-notification-thread="${CSS.escape(threadId)}"]`)) { if (now() - startedAt > FIND_MAX_MS) abandon("no-chat"); return; }
    const found = bind();
    if (phase !== "restoring") return;
    if (!found) { if (now() - startedAt > FIND_MAX_MS) abandon("no-chat"); return; }
    if (!position || position.atBottom) { goLive("bottom"); return; }
    if (!lateChecked) { checkLate(found); if (phase !== "restoring") return; }
    if (rowsAt === null) {
      rowsAt = primedBefore ? now() : Math.min(now(), chatShownAt(found, threadId) ?? Infinity);
      if (veiledAt !== null) armVeil(threadId, VEIL_MAX_MS + VEIL_SAFETY_MS - (now() - rowsAt));
      trace("rows", { afterMs: Math.round(rowsAt - startedAt), veiled: veiledAt !== null });
    }
    const oldest = messageAnchors(threadId).reduce((min, e) => found.contains(e) ? Math.min(min, Number(e.dataset.notificationMessage)) : min, Infinity);
    if (oldest < oldestSeq) { if (oldestSeq !== Infinity) progressAt = now(); oldestSeq = oldest; }
    const expired = now() - rowsAt > VEIL_MAX_MS || now() - rowsAt > VEIL_BUDGET_MS && now() - progressAt > PAGE_GRACE_MS;
    if (deferredByHost()) { if (expired) abandon("anchor-timeout"); return; }
    const anchor = anchorFor(position.messageSeq);
    if (!anchor) {
      hide();
      armVeil(threadId, VEIL_MAX_MS + VEIL_SAFETY_MS - (now() - rowsAt));
      if (!asked && store.loadAnchor) { asked = true; requested = true; mute(found); trace("load-anchor", position.messageSeq); store.loadAnchor(position.messageSeq); }
      if (expired) abandon("anchor-timeout");
      return;
    }
    const { target, pin } = placeFor(anchor);
    if (placedAt === null) trace("anchor", { afterMs: Math.round(now() - startedAt), afterRowsMs: Math.round(now() - rowsAt) });
    placedAt ??= now();
    if (pin && !lineReady) { lineReady = true; lineReadyAt = now(); trace("line-ready", { afterMs: Math.round(now() - placedAt) }); }
    if (Math.abs(target - found.scrollTop) > PLACED_PX) {
      trace("adjust", { from: Math.round(found.scrollTop), to: Math.round(target) });
      write(target);
      stable = 0;
      if (expired) settle();
      return;
    }
    if (frameTick) {
      const sum = heightsNow();
      stable = sum === heights ? stable + 1 : 0;
      heights = sum;
    }
    const waitLine = veiledAt !== null && position.line !== undefined && !pin && now() - placedAt < LINE_WAIT_MS;
    const revealing = veiledAt !== null && requested && !revealed && now() - placedAt < REVEAL_MAX_MS;
    if (revealing && found.querySelector(".bb-search-flash")) { revealed = true; trace("revealed", { afterMs: Math.round(now() - placedAt) }); return; }
    const steady = stable >= 2 || now() - (lineReadyAt ?? placedAt) > STEADY_MAX_MS;
    if (expired || veiledAt === null || !waitLine && !revealing && steady) settle();
  };
  const keep = () => {
    if (disposed || phase !== "settling") return;
    if (!container?.isConnected || !position || position.atBottom) { goLive("settled"); return; }
    if (gestureActive() || now() - intentAt < INTENT_MS) { goLive("gesture"); return; }
    const t = now();
    if (t - settledAt > SETTLE_MAX_MS || t - Math.max(lastFixAt, changedAt) > SETTLE_QUIET_MS) { goLive("settled"); return; }
    if (deferredByHost()) return;
    if (fine && !fine.element.isConnected) {
      const anchor = anchorFor(position.messageSeq);
      const again = anchor ? placeFor(anchor).pin : null;
      const line = again ? null : lineAt();
      fine = again ?? (line ? { element: line.element, offset: line.offset } : null);
    }
    const anchor = fine ? fine.element : anchorFor(position.messageSeq);
    if (!anchor) return;
    const target = targetFor(anchor, fine ? fine.offset : position.offset);
    if (Math.abs(target - container.scrollTop) > PLACED_PX) {
      trace("keep", { from: Math.round(container.scrollTop), to: Math.round(target), by: fine ? "line" : "message" });
      write(target);
      lastFixAt = t;
    }
  };
  const hold = (reason: string, anchor: ScrollPosition, pin: Pin | null) => {
    if (anchor.atBottom || !container) return;
    position = anchor;
    phase = "settling";
    settledAt = lastFixAt = now();
    observer.observe(document.documentElement, { childList: true, subtree: true });
    fine = pin?.element.isConnected ? pin : null;
    trace("hold", { reason, position, fine: fine ? Math.round(fine.offset) : null });
    frame = requestAnimationFrame(tick);
    keep();
  };

  const visiblePin = (): Pin | null => {
    const line = lineAt();
    return line ? { element: line.element, offset: line.offset } : null;
  };
  const newestSeq = () => messageAnchors(threadId).reduce((max, e) => Math.max(max, Number(e.dataset.notificationMessage)), 0);
  const fingerScrolling = () => dragged || fingerMoved || now() - fingerMovedAt < FINGER_MS;
  const keepFinger = () => {
    if (!container || !fingerRef || deferredByHost()) return;
    if (!fingerRef.element.isConnected) { fingerRef = visiblePin(); return; }
    const target = targetFor(fingerRef.element, fingerRef.offset);
    if (Math.abs(target - container.scrollTop) <= 0.5) return;
    trace("finger-hold", { from: Math.round(container.scrollTop), to: Math.round(target) });
    write(target);
  };
  const userDriven = () => held() || now() - intentAt < INTENT_MS || now() - userScrollAt < CHAIN_MS || /^#msg=/.test(location.hash);
  const guard = (source: string) => {
    if (phase !== "live" || !container || deferredByHost()) return;
    if (quiet || pinned || userDriven() || !guardRef?.element.isConnected) { guardRef = visiblePin(); return; }
    const target = targetFor(guardRef.element, guardRef.offset);
    if (Math.abs(target - container.scrollTop) <= 2) return;
    trace("guard", { source, from: Math.round(container.scrollTop), to: Math.round(target) });
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
    const measured = pinned ? AT_BOTTOM : capturePosition(found.scrollTop, found.clientHeight, found.scrollHeight, rect.top + found.clientTop, anchors.filter(e => {
      const row = e.closest<HTMLElement>("[data-timeline-row-id]") ?? e;
      const bounds = row.getBoundingClientRect();
      return bounds.bottom > rect.top && bounds.top < rect.bottom;
    }).map(e => ({ seq: Number(e.dataset.notificationMessage), top: e.getBoundingClientRect().top, bottom: e.getBoundingClientRect().bottom })));
    if (!measured) return;
    const line = measured.atBottom ? null : lineAt();
    const next: ScrollPosition = !measured.atBottom && line ? { ...measured, line: line.anchor } : measured;
    lastAnchor = next;
    lastFine = line ? { element: line.element, offset: line.offset } : null;
    widths.set(Math.round(found.clientWidth), { anchor: next, fine: lastFine, userAt: dragAt });
    const serialized = JSON.stringify(next);
    if (serialized === lastSaved) return;
    lastSaved = serialized;
    trace("capture", next);
    store.save(next);
  };

  const onScroll = () => {
    if (!container) return;
    const ours = ownTop !== null && Math.abs(container.scrollTop - ownTop) < 1;
    const gesture = !ours && gestureScroll();
    if (gesture) dragAt = now();
    if (gesture || !ours && (now() - userScrollAt < CHAIN_MS || now() - intentAt < INTENT_MS)) userScrollAt = now();
    if (phase === "restoring") { attempt(); return; }
    if (phase === "settling") { keep(); return; }
    if (Math.abs(container.clientWidth - lastWidth) >= 1) { resized(); return; }
    if (held() && touching) {
      if (ours) return;
      if (fingerScrolling()) { fingerMoved = false; dragged = true; fingerRef = visiblePin(); }
      else { keepFinger(); return; }
    }
    if (!ours) {
      if (gesture || /^#msg=/.test(location.hash)) setPinned(atBottomNow(), gesture ? "gesture" : "link");
      else if (atBottomNow() && (now() - intentAt < INTENT_MS || now() - sentAt < SEND_MS)) setPinned(true, "intent");
      else if (pinned && container.scrollTop < lastScrollTop - container.clientHeight / 2) setPinned(false, "jump");
      else if (pinned && !gestureActive()) follow("scroll");
      guard("scroll");
    }
    lastScrollTop = container.scrollTop;
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
    if (held() && touching && fingerRef) { if (!fingerScrolling()) keepFinger(); else fingerRef = visiblePin(); measure(); return; }
    const width = Math.round(container.clientWidth);
    const widthChanged = Math.abs(container.clientWidth - lastWidth) >= 1;
    const changed = widthChanged || lastHeight !== container.clientHeight || lastScrollHeight !== container.scrollHeight;
    if (!pinned && now() - sentAt < SEND_MS && newestSeq() > sentSeq && composerEmpty()) setPinned(true, "sent");
    if (changed && pinned && !gestureActive()) follow(widthChanged ? "width" : "resize");
    else if (widthChanged && !pinned && !gestureActive() && !keepSaved) {
      const memory = widths.get(width);
      const own = memory && memory.userAt === dragAt && !memory.anchor.atBottom ? memory : null;
      const from = own ? own.anchor : lastAnchor;
      if (from) { hold(own ? "width-return" : "width", from, own ? own.fine : lastFine); return; }
    } else if (!widthChanged) guard("resize");
    lastScrollTop = container.scrollTop;
    measure();
  };
  const bind = () => {
    if (container?.isConnected) return container;
    const found = chatScroller(threadId);
    if (found === container) return container;
    resize?.disconnect();
    container?.removeEventListener("scroll", onScroll);
    container = found;
    if (!container) return null;
    ownTop = null;
    measure();
    lastScrollTop = container.scrollTop;
    container.addEventListener("scroll", onScroll, { passive: true });
    if (typeof ResizeObserver !== "undefined") {
      resize = new ResizeObserver(resized);
      resize.observe(container);
      if (container.firstElementChild) resize.observe(container.firstElementChild);
    }
    return container;
  };
  const checkLate = (found: HTMLElement) => {
    lateChecked = true;
    const shownAt = primedBefore ? null : chatShownAt(found, threadId);
    const late = shownAt === null ? 0 : now() - shownAt;
    if (late <= LATE_MS) return;
    if (veiledAt !== null || late <= LATE_CUT_MS && untouchedSince(found, shownAt!)) {
      trace("late-restore", { shownMs: Math.round(late) });
      hide();
      return;
    }
    trace("late-skip", { shownMs: Math.round(late) });
    keepSaved = true;
    quiet = true;
    goLive("late");
  };

  const interacted = (type: string) => {
    frozen = false;
    keepSaved = false;
    quiet = false;
    if (phase === "live") return;
    trace("input", type);
    if (phase === "restoring" && requested) store.cancelAnchor?.();
    goLive("input");
  };
  const endTouch = (t: number, source: string) => {
    if (!touching) return;
    touchTarget?.removeEventListener("touchend", onTargetEnd);
    touchTarget?.removeEventListener("touchcancel", onTargetEnd);
    touchTarget = null;
    touching = false;
    gestureAt = t;
    trace("touch-end", { source, dragged, pinned });
    if (phase === "live" && !dragged && pinned) requestAnimationFrame(() => { if (!held() && pinned) follow("lift"); });
  };
  let touchTarget: Node | null = null;
  const onTargetEnd = (event: Event) => { if (event.isTrusted && (event as TouchEvent).touches.length === 0 && !(touchTarget as Node | null)?.isConnected) endTouch(now(), `detached-${event.type}`); };
  const sendIntent = (event: Event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest("[data-scroll-footer]")) return false;
    if (event.type === "keydown") {
      const key = event as KeyboardEvent;
      return key.key === "Enter" && !key.shiftKey && !key.altKey && !key.isComposing && Boolean(target.closest("[data-promptbox]"));
    }
    const button = target.closest<HTMLElement>("[data-promptbox-submit-action]");
    return Boolean(button && !/stop/i.test(button.getAttribute("aria-label") ?? ""));
  };
  const onInput = (event: Event) => {
    if (!event.isTrusted) return;
    const t = now();
    if (event.type !== "touchmove") intentAt = t;
    const target = event.target instanceof Node ? event.target : null;
    const inFooter = target instanceof Element && Boolean(target.closest("[data-scroll-footer]"));
    const inside = container !== null && target !== null && container.contains(target) && !inFooter;
    if ((event.type === "keydown" || event.type === "click") && sendIntent(event)) { sentAt = t; sentSeq = newestSeq(); trace("send", { via: event.type }); }
    switch (event.type) {
      case "touchend": case "touchcancel": if ((event as TouchEvent).touches.length === 0) endTouch(t, event.type); return;
      case "pointerup": case "pointercancel":
        if ((event as PointerEvent).pointerType === "touch") { if (event.type === "pointerup") endTouch(t, event.type); }
        else if (pointerDown) { pointerDown = false; gestureAt = t; }
        return;
      case "click": endTouch(t, "click"); return;
      case "touchmove": if (touching) { fingerMovedAt = t; fingerMoved = true; } return;
      case "touchstart":
        if (inside) {
          touching = true; touchAt = t; dragged = false; fingerRef = phase === "live" ? visiblePin() : null;
          if (touchTarget !== target && target) {
            touchTarget?.removeEventListener("touchend", onTargetEnd);
            touchTarget?.removeEventListener("touchcancel", onTargetEnd);
            touchTarget = target;
            target.addEventListener("touchend", onTargetEnd, { passive: true });
            target.addEventListener("touchcancel", onTargetEnd, { passive: true });
          }
        }
        else if ((event as TouchEvent).touches.length <= 1) touching = false;
        break;
      case "pointerdown": if (inside && (event as PointerEvent).pointerType !== "touch") { pointerDown = true; touchAt = t; } break;
      case "wheel": if (inside) gestureAt = t; break;
      case "keydown": if (scrollKeys.has((event as KeyboardEvent).key) && !inFooter) gestureAt = t; break;
    }
    if (inside || event.type === "keydown" || event.type === "beforeinput") interacted(event.type);
  };
  const inputEvents = ["touchstart", "touchmove", "touchend", "touchcancel", "pointerdown", "pointerup", "pointercancel", "click", "wheel", "keydown", "beforeinput"];
  for (const type of inputEvents) document.addEventListener(type, onInput, { capture: true, passive: true });
  const freeze = () => { frozen = true; clearTimeout(saveTimer); };
  const thaw = (event: PageTransitionEvent) => { if (event.persisted) frozen = false; };
  window.addEventListener("pagehide", freeze);
  window.addEventListener("beforeunload", freeze);
  document.addEventListener("freeze", freeze);
  window.addEventListener("pageshow", thaw);

  const observer = new MutationObserver(records => {
    if (phase === "restoring") attempt();
    else if (phase === "settling") {
      if (container && records.some(record => container!.contains(record.target))) changedAt = now();
      keep();
    }
  });
  const tick = () => {
    if (phase === "restoring") attempt(true);
    else if (phase === "settling") keep();
    if (phase === "restoring" || phase === "settling") frame = requestAnimationFrame(tick);
  };
  const startRestore = () => {
    phase = "restoring";
    if (position && !position.atBottom && !chatScroller(threadId)) hide();
    observer.observe(document.documentElement, { childList: true, subtree: true });
    attempt();
    frame = requestAnimationFrame(tick);
  };
  if (phase === "waiting") {
    void store.load!().then(value => {
      if (disposed || phase !== "waiting") return;
      position = value;
      trace("loaded", value);
      if (!value || value.atBottom) { goLive("loaded"); return; }
      startRestore();
    }, () => goLive("load-failed"));
  }
  if (phase === "restoring") startRestore();
  else {
    if (veiledAt !== null) show();
    bind();
    if (phase === "live") { measure(); pinned = atBottomNow() || position?.atBottom === true; guardRef = visiblePin(); trace("live", { reason: "start", pinned }); }
  }
  const timer = setInterval(() => {
    if (phase === "restoring") attempt();
    else if (phase === "settling") keep();
    else if (phase === "waiting" && now() - startedAt > WAIT_MAX_MS) { keepSaved = true; quiet = true; goLive("load-timeout"); }
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

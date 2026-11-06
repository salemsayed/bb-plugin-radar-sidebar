import { AT_BOTTOM, BOTTOM_GAP, capturePosition, restoreDelta, textHash, type LineAnchor, type ScrollPosition } from "./scrollPosition";
import { emitTrace } from "./scrollTrace";
import { onScrollWrite, ownWrite } from "./scrollHook";
import { prerenderRows } from "./rowPrerender";
import { hostScrollOf } from "./hostScroll";
import { LATE_CUT_MS, LATE_MS, VEIL_BUDGET_MS, VEIL_MAX_MS, VEIL_SAFETY_MS, armVeil, chatScroller, chatShownAt, claimPrime, markPendingRestore, messageAnchors, scrollRetired, takePendingRestore, untouchedSince, unveilChat, veilChat, veilLifted, veiledSince } from "./primeScrollRoute";

export { chatScroller, messageAnchors };

const FIND_MAX_MS = 60000;
const WAIT_MAX_MS = 5000;
const STEADY_MAX_MS = 1200;
const LINE_WAIT_MS = 1500;
const REVEAL_MAX_MS = 400;
const REVEAL_CAP_MS = 2000;
const SPOT_WAIT_MS = 8000;
const SPOT_SETTLE_MS = 600;
const SETTLE_QUIET_MS = 1200;
const SETTLE_MAX_MS = 20000;
const PAGE_GRACE_MS = 4000;
const GESTURE_TAIL_MS = 300;
const MOMENTUM_MS = 1500;
const HELD_MAX_MS = 60000;
const FINGER_MS = 500;
const REST_MS = 120;
const INTENT_MS = 1500;
const CHAIN_MS = 250;
const SEND_MS = 4000;
const PLACED_PX = 1;
const FLASH_MS = 2000;
const EXACT_GAP = 4.5;
const GUARD_PX = 1.5;
const PUSH_PX = 3;
const COAST_QUIET_MS = 150;
const SMOOTH_MS = 1200;
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
type Pin = { element: Element; offset: number; row: string | null; path: number[] | null; hash: number | null; inner: number };
type Line = { message: HTMLElement | null; element: HTMLElement; offset: number; anchor: LineAnchor };
type Track = { pin: Pin; base: number; comp: number; width: number; height: number };
const MESSAGE = "[data-notification-thread][data-notification-message]";
const ROW = "[data-timeline-row-id]";
const RAW_CARD = "pre > code.language-ui";

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
function readable(el: Element) {
  return (el.textContent ?? "").trim() !== "" && hasBox(el);
}
function floating(el: Element, container: HTMLElement) {
  for (let node: Element | null = el; node && node !== container; node = node.parentElement) {
    const position = getComputedStyle(node).position;
    if (position === "sticky" || position === "fixed") return true;
  }
  return false;
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
function uniqueByText(root: HTMLElement, hash: number, inner: number) {
  const rootTop = root.getBoundingClientRect().top;
  const found: { node: HTMLElement; gap: number }[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  for (let node = walker.currentNode as HTMLElement | null; node; node = walker.nextNode() as HTMLElement | null) {
    if (textHash(node.textContent ?? "") === hash && hasBox(node)) found.push({ node, gap: Math.abs(node.getBoundingClientRect().top - rootTop - inner) });
  }
  found.sort((a, b) => a.gap - b.gap);
  const best = found[0];
  if (!best) return null;
  const rival = found.find(f => !best.node.contains(f.node) && !f.node.contains(best.node));
  return !rival || rival.gap - best.gap > 40 ? best.node : null;
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

export function rememberScroll(threadId: string, store: ScrollStore, activeCheck?: () => boolean) {
  const trace = (event: string, data: unknown = null) => emitTrace(event, threadId, data);
  const startedAt = performance.now();
  let touchedAt = -Infinity;
  const isActive = activeCheck ?? (() => document.visibilityState === "visible" && (document.hasFocus() || touchedAt > startedAt));
  let position: ScrollPosition | null = store.cached ?? null;
  let phase: Phase = position && !position.atBottom ? "restoring" : position || !store.load ? "live" : "waiting";
  const primed = claimPrime(threadId);
  const primedBefore = primed?.before ?? false;
  trace("begin", { position, phase, primed: veiledSince(threadId) !== null, primedBefore });
  let disposed = false, frozen = false, keepSaved = position !== null && !position.atBottom, lateChecked = false;
  let container: HTMLElement | null = null, resize: ResizeObserver | null = null, frame = 0;
  let veiledAt: number | null = veiledSince(threadId), rowsAt: number | null = null, quiet = false;
  let requested = primed?.requested ?? false, stable = 0, heights = 0, placedAt: number | null = null, settledAt = 0, lastFixAt = 0, changedAt = 0, lineReady = false, lineReadyAt: number | null = null, revealed = false;
  let lineCache: { root: HTMLElement; element: HTMLElement } | null = null, asked = false, oldestSeq = Infinity, progressAt = -Infinity;
  let touchGap = 0, fingerRef: Pin | null = null, fingerMovedAt = -Infinity, fingerMoved = false, dragged = false, panned = false, touchX = 0, touchY = 0;
  let fine: Pin | null = null, stuck = 0;
  let intentAt = -Infinity, sentAt = -Infinity, sentSeq = 0;
  let touching = false, pointerDown = false, touchAt = -Infinity, gestureAt = -Infinity, userScrollAt = -Infinity, dragAt = -Infinity, ownTop: number | null = null;
  let pinned = false, lastHeight = 0, lastScrollHeight = 0, lastWidth = 0, lastScrollTop = 0, behavior: string | null = null;
  let muted: HTMLElement | null = primed?.requested ? document.documentElement : null;
  let lastFine: Pin | null = null, edgeTop: number | null = null, waitedCards = false, widthHold = false, spotWaitAt: number | null = null, freshMount = false;
  let hostDefers = /iP(hone|ad|od)/.test(navigator.userAgent) || navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  const widths = new Map<number, { anchor: ScrollPosition; fine: Pin | null; userAt: number }>();
  let lastSaved = "", lastAnchor: ScrollPosition | null = null, saveTimer: ReturnType<typeof setTimeout> | undefined;
  let track: Track | null = null, comp = 0, actionAt = -Infinity, userMovedAt = -Infinity, dirtyAt = -Infinity, resizedAt = -Infinity, hostTop: number | null = null, hostAt = -Infinity;
  let unhook: (() => void) | null = null, unrender: (() => void) | null = null, watchedColumn: HTMLElement | null = null, checkQueued = false, smoothAt = -Infinity, hostSince = 0;

  const now = () => performance.now();
  const held = () => (touching || pointerDown) && now() - touchAt < HELD_MAX_MS;
  const gestureActive = () => held() || now() - gestureAt < GESTURE_TAIL_MS || now() - dragAt < GESTURE_TAIL_MS;
  const gestureScroll = () => held() || now() - gestureAt < MOMENTUM_MS;
  const viewTop = () => container!.getBoundingClientRect().top + container!.clientTop;
  const deferredByHost = () => container !== null && Boolean(rowsColumn(container)?.style.transform);
  const gap = () => container ? container.scrollHeight - container.clientHeight - container.scrollTop : 0;
  const atBottomNow = () => container !== null && gap() <= BOTTOM_GAP;
  const topNow = () => container?.scrollTop ?? null;
  const movedUp = () => container !== null && edgeTop !== null && edgeTop - container.scrollTop > 2 && gap() > 2;
  const measure = () => {
    if (!container) return;
    lastHeight = container.clientHeight;
    lastWidth = container.clientWidth;
    lastScrollHeight = container.scrollHeight;
  };
  const write = (top: number) => {
    if (!container) return;
    container.dispatchEvent(new WheelEvent("wheel", { deltaY: 0, bubbles: false, cancelable: false }));
    const target = container;
    const behavior = target.style.scrollBehavior;
    target.style.scrollBehavior = "auto";
    ownWrite(() => { target.scrollTop = top; });
    target.style.scrollBehavior = behavior;
    ownTop = target.scrollTop;
  };
  const follow = (reason: string) => {
    if (!container || held()) return;
    const bottom = container.scrollHeight - container.clientHeight;
    if (bottom - container.scrollTop <= 0.5) return;
    trace("follow", { reason, from: Math.round(container.scrollTop), to: Math.round(bottom) });
    const target = container;
    ownWrite(() => { target.scrollTop = bottom; });
    ownTop = edgeTop = target.scrollTop;
  };
  const composerEmpty = () => {
    const editor = container?.querySelector("[data-scroll-footer] [contenteditable=true], [data-scroll-footer] textarea");
    return !editor || (editor instanceof HTMLTextAreaElement ? editor.value : editor.textContent ?? "").trim() === "";
  };
  const setPinned = (value: boolean, reason: string) => {
    if (value && (reason === "intent" || reason === "sent")) keepSaved = false;
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
  const anchorFor = (seq: number) => {
    const found = messageAnchors(threadId).filter(e => Number(e.dataset.notificationMessage) === seq && container!.contains(e));
    return found.find(e => e.matches(ROW)) ?? found[0] ?? null;
  };
  const pinOf = (element: Element, offset: number, line: boolean): Pin => {
    const root = element.closest<HTMLElement>(ROW);
    const inner = root ? element.getBoundingClientRect().top - root.getBoundingClientRect().top : 0;
    return { element, offset, row: root?.getAttribute("data-timeline-row-id") ?? null, path: line && root ? pathOf(element as HTMLElement, root) : null, hash: line ? textHash(element.textContent ?? "") : null, inner };
  };
  const refind = (pin: Pin): Pin | null => {
    if (!container || !pin.row) return null;
    const root = container.querySelector<HTMLElement>(`[data-timeline-row-id="${CSS.escape(pin.row)}"]`);
    if (!root) return null;
    if (pin.hash === null) {
      if (pin.element.matches(ROW)) return { ...pin, element: root };
      const seq = (pin.element as HTMLElement).dataset?.notificationMessage;
      const element = seq ? root.querySelector(`[data-notification-message="${CSS.escape(seq)}"]`) : null;
      return element ? { ...pin, element } : null;
    }
    const exact = pin.path ? byPath(root, { path: pin.path, hash: pin.hash, offset: pin.offset }) : null;
    const element = exact ?? uniqueByText(root, pin.hash, pin.inner);
    return element ? { ...pin, element } : null;
  };
  const targetFor = (anchor: Element, offset: number) => {
    const delta = restoreDelta(anchor.getBoundingClientRect().top, container!.getBoundingClientRect().top + container!.clientTop, offset);
    return Math.min(Math.max(container!.scrollTop + delta, 0), Math.max(0, container!.scrollHeight - container!.clientHeight));
  };
  const lineAt = (deep = false, solid = false): Line | null => {
    if (!container) return null;
    const bounds = container.getBoundingClientRect();
    const top = bounds.top + container.clientTop;
    const points = [[0.5, 6], [0.3, 6], [0.7, 6], [0.5, 24], [0.3, 24], [0.5, 48], [0.2, 48], [0.5, 96], [0.2, 96]];
    if (deep) for (let y = 128; y <= container.clientHeight / 2; y += 32) points.push([0.5, y], [0.2, y]);
    for (const [x, y] of points) {
      const hit = document.elementFromPoint(bounds.left + bounds.width * x, top + y);
      if (!hit || !container.contains(hit) || hit.closest("[data-scroll-footer]")) continue;
      const root = hit.closest<HTMLElement>(ROW);
      const row = root?.getAttribute("data-timeline-row-id");
      if (!root || !row || !container.contains(root)) continue;
      const found = hit.closest<HTMLElement>(MESSAGE);
      const message = found && found.dataset.notificationThread === threadId && Number(found.dataset.notificationMessage) > 0 ? found : null;
      const element = blockOf(hit, root);
      if (!readable(element) || solid && floating(element, container)) continue;
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
    const root = lineRoot(anchor, line, container);
    if (!root) return null;
    const base = 6 + shift + Math.max(0, line.offset);
    for (let d = 0; d <= 160; d += 8) {
      for (const y of d ? [base + d, base - d] : [base]) {
        if (y < 0 || y > container.clientHeight) continue;
        const hit = document.elementFromPoint(bounds.left + bounds.width / 2, top + y);
        for (let el = hit as HTMLElement | null; el && el !== root && root.contains(el); el = el.parentElement) {
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
    if (lineCache && lineCache.root === root && lineCache.element.isConnected && root.contains(lineCache.element) && hasBox(lineCache.element) && textHash(lineCache.element.textContent ?? "") === line.hash) return lineCache.element;
    const element = byPath(root, line) ?? byText(root, line);
    lineCache = element ? { root, element } : null;
    return element;
  };
  const unreachable = (anchor: HTMLElement, pin: Pin | null) => {
    if (!container || !position || position.atBottom) return null;
    const line = position.line;
    if (!pin && line && lineRoot(anchor, line, container)?.querySelector(RAW_CARD)) return "card";
    const top = container.getBoundingClientRect().top + container.clientTop;
    const want = container.scrollTop + (pin ? pin.element.getBoundingClientRect().top - top - pin.offset : restoreDelta(anchor.getBoundingClientRect().top, top, position.offset));
    return want > container.scrollHeight - container.clientHeight + 2 ? "short" : null;
  };
  const placeFor = (anchor: HTMLElement): { target: number; pin: Pin | null } => {
    const line = position && !position.atBottom && position.line ? position.line : null;
    const element = line && container ? resolveLine(anchor, line) ?? searchLine(anchor, line, position && !position.atBottom ? position.offset : 0) : null;
    if (element && line) return { target: targetFor(element, line.offset), pin: pinOf(element, line.offset, true) };
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
    widthHold = false;
    const holdSaved = keepSaved && position !== null && !position.atBottom && reason !== "late" && reason !== "bottom" && reason !== "loaded";
    pinned = !holdSaved && reason !== "anchor-timeout" && (atBottomNow() || reason === "bottom" || reason === "loaded" && position?.atBottom === true);
    trace("live", { reason, keepSaved, pinned });
    if (pinned) { edgeTop = topNow(); follow("live"); }
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
    let sum = 0;
    for (const row of container.querySelectorAll<HTMLElement>(ROW)) {
      const box = row.getBoundingClientRect();
      if (box.bottom > rect.top - container.clientHeight && box.top < rect.bottom) sum = Math.imul(sum, 31) + Math.round(box.height) + Math.round(box.top - rect.top) * 7 | 0;
    }
    return sum;
  };
  const rawCardsNear = () => {
    if (!container) return false;
    const rect = container.getBoundingClientRect();
    for (const code of container.querySelectorAll(RAW_CARD)) {
      const box = code.getBoundingClientRect();
      if (box.bottom > rect.top - container.clientHeight && box.top < rect.bottom) return true;
    }
    return false;
  };
  const settle = () => {
    phase = "settling";
    settledAt = lastFixAt = now();
    show();
    const anchor = position && !position.atBottom ? anchorFor(position.messageSeq) : null;
    const placed = anchor ? placeFor(anchor).pin : null;
    widthHold = false;
    fine = topPin() ?? placed ?? (anchor && position && !position.atBottom ? pinOf(anchor, position.offset, false) : visiblePin());
    if (requested) store.anchorReady?.();
    arm(fine);
    trace("placed", { position, top: container ? Math.round(container.scrollTop) : null, line: placed ? "saved" : anchor ? "message" : fine ? "visible" : null, pin: fine ? { row: fine.row?.slice(-14) ?? null, path: fine.path, inner: Math.round(fine.inner), text: (fine.element.textContent ?? "").slice(0, 24) } : null });
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
      trace("rows", { afterMs: Math.round(rowsAt - startedAt), veiled: veiledAt !== null, budgetMs: Math.round(Math.min(VEIL_MAX_MS, Math.max(VEIL_BUDGET_MS, 2 * (rowsAt - startedAt)))) });
    }
    const oldest = messageAnchors(threadId).reduce((min, e) => found.contains(e) ? Math.min(min, Number(e.dataset.notificationMessage)) : min, Infinity);
    if (oldest < oldestSeq) { if (oldestSeq !== Infinity) progressAt = now(); oldestSeq = oldest; }
    const budget = Math.min(VEIL_MAX_MS, Math.max(VEIL_BUDGET_MS, 2 * (rowsAt - startedAt)));
    const expired = now() - rowsAt > VEIL_MAX_MS || now() - rowsAt > budget && now() - progressAt > PAGE_GRACE_MS;
    if (deferredByHost()) { hostDefers = true; if (expired) abandon("anchor-timeout"); return; }
    const anchor = anchorFor(position.messageSeq);
    if (!anchor) {
      hide();
      armVeil(threadId, VEIL_MAX_MS + VEIL_SAFETY_MS - (now() - rowsAt));
      if (!asked && store.loadAnchor) { asked = true; requested = true; mute(found); trace("load-anchor", position.messageSeq); store.loadAnchor(position.messageSeq); }
      if (expired) abandon("anchor-timeout");
      return;
    }
    const { target, pin } = placeFor(anchor);
    if (freshMount && veiledAt === null && (position.line && !pin || unreachable(anchor, pin))) hide();
    freshMount = false;
    if (placedAt === null) trace("anchor", { afterMs: Math.round(now() - startedAt), afterRowsMs: Math.round(now() - rowsAt) });
    placedAt ??= now();
    if (requested && !revealed && veiledAt !== null) {
      revealed = true;
      trace("release", { afterMs: Math.round(now() - startedAt) });
      store.cancelAnchor?.();
    }
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
    const steady = stable >= 2 || now() - (lineReadyAt ?? placedAt) > STEADY_MAX_MS || now() - placedAt > REVEAL_CAP_MS;
    const cards = veiledAt !== null && now() - placedAt < REVEAL_CAP_MS && rawCardsNear();
    if (cards && !waitedCards) { waitedCards = true; trace("cards-wait", null); }
    const blocked = veiledAt !== null && now() - placedAt < SPOT_WAIT_MS ? unreachable(anchor, pin) : null;
    if (blocked) { if (spotWaitAt === null) trace("spot-wait", { why: blocked }); spotWaitAt = now(); stable = 0; return; }
    const spotSettled = spotWaitAt === null || stable >= 2 || now() - spotWaitAt > SPOT_SETTLE_MS;
    if (expired || veiledAt === null || !waitLine && !revealing && !cards && steady && spotSettled) settle();
  };
  const keep = (scrolled = false) => {
    if (disposed || phase !== "settling") return;
    if (!container?.isConnected || !position || position.atBottom) { goLive("settled"); return; }
    if (gestureActive() || now() - intentAt < INTENT_MS) { goLive("gesture"); return; }
    const t = now();
    if (t - settledAt > SETTLE_MAX_MS || t - Math.max(lastFixAt, changedAt) > SETTLE_QUIET_MS) { goLive("settled"); return; }
    if (deferredByHost()) hostDefers = true;
    if (!widthHold) return;
    if (deferredByHost()) return;
    if (fine && fine.element.isConnected && !hasBox(fine.element)) { trace("pin-hidden", { row: fine.row?.slice(-14) ?? null }); fine = null; }
    if (fine && !fine.element.isConnected) {
      const again = refind(fine);
      trace(again ? "repin" : "pin-lost", { row: fine.row?.slice(-14) ?? null, line: fine.hash !== null });
      fine = again;
    }
    if (!fine) {
      fine = visiblePin();
      if (!fine) { goLive("pin-lost"); return; }
      trace("repin", { to: fine.hash !== null ? "line" : "message", text: (fine.element.textContent ?? "").slice(0, 24) });
    }
    if (hostDefers && !scrolled && !widthHold) return;
    if (fine.hash !== null && textHash(fine.element.textContent ?? "") !== fine.hash) {
      const again = refind(fine);
      if (again && again.element !== fine.element) { trace("repin", { row: fine.row?.slice(-14) ?? null, changed: true }); fine = again; }
    }
    const target = targetFor(fine.element, fine.offset);
    if (Math.abs(target - container.scrollTop) <= PLACED_PX) return;
    if (Math.abs(target - container.scrollTop) > container.clientHeight * 1.5) { trace("keep-skip", { from: Math.round(container.scrollTop), to: Math.round(target) }); goLive("keep-skip"); return; }
    trace("keep", { from: Math.round(container.scrollTop), to: Math.round(target), by: fine.hash !== null ? "line" : "message" });
    const before = fine.element.getBoundingClientRect().top, from = container.scrollTop;
    write(target);
    lastFixAt = t;
    const scrolledBy = container.scrollTop - from, movedBy = before - fine.element.getBoundingClientRect().top;
    if (Math.abs(scrolledBy) >= 2 && Math.abs(movedBy - scrolledBy) > Math.abs(scrolledBy) / 2) {
      trace("pin-stuck", { scrolledBy: Math.round(scrolledBy), movedBy: Math.round(movedBy) });
      fine = null;
      if (++stuck >= 2) goLive("pin-stuck");
    }
  };
  const hold = (reason: string, anchor: ScrollPosition, pin: Pin | null) => {
    if (anchor.atBottom || !container) return;
    position = anchor;
    phase = "settling";
    settledAt = lastFixAt = now();
    observer.observe(document.documentElement, { childList: true, subtree: true });
    const message = pin?.element.isConnected ? null : anchorFor(anchor.messageSeq);
    fine = pin?.element.isConnected ? pin : message ? pinOf(message, anchor.offset, false) : null;
    widthHold = true;
    trace("hold", { reason, position, fine: fine ? Math.round(fine.offset) : null });
    frame = requestAnimationFrame(tick);
    keep();
  };

  const topPin = (): Pin | null => {
    if (!container) return null;
    const bounds = container.getBoundingClientRect();
    const top = bounds.top + container.clientTop;
    let best: { element: HTMLElement; height: number } | null = null;
    for (const [x, y] of [[0.5, 6], [0.3, 6], [0.7, 6], [0.5, 16], [0.3, 16]]) {
      const hit = document.elementFromPoint(bounds.left + bounds.width * x, top + y);
      const root = hit?.closest<HTMLElement>(ROW);
      if (!hit || !root || !container.contains(root) || hit.closest("[data-scroll-footer]")) continue;
      const element = blockOf(hit, root);
      if (!readable(element)) continue;
      const height = element.getBoundingClientRect().height;
      if (!best || height < best.height) best = { element, height };
    }
    return best ? pinOf(best.element, best.element.getBoundingClientRect().top - top, true) : null;
  };
  const visiblePin = (): Pin | null => {
    const line = lineAt();
    return line ? pinOf(line.element, line.offset, true) : null;
  };
  const newestSeq = () => messageAnchors(threadId).reduce((max, e) => Math.max(max, Number(e.dataset.notificationMessage)), 0);
  const fingerScrolling = () => dragged || fingerMoved || now() - fingerMovedAt < FINGER_MS;
  const keepFinger = () => {
    if (!container || !fingerRef || now() - touchAt < REST_MS || touchGap > BOTTOM_GAP) return;
    if (container.scrollTop < 0 || container.scrollTop > container.scrollHeight - container.clientHeight + 0.5) return;
    if (!fingerRef.element.isConnected || !hasBox(fingerRef.element)) { fingerRef = visiblePin(); return; }
    const target = targetFor(fingerRef.element, fingerRef.offset);
    if (Math.abs(target - container.scrollTop) <= 0.5) return;
    trace("finger-hold", { from: Math.round(container.scrollTop), to: Math.round(target) });
    write(target);
  };
  const guardState = (): "off" | "wait" | "on" => {
    if (disposed || !container || phase !== "settling" && phase !== "live" || pinned || widthHold) return "off";
    const t = now();
    if (t - actionAt < INTENT_MS || t - sentAt < SEND_MS || /^#msg=/.test(location.hash)) return "off";
    if (held() || gestureScroll() || t - userMovedAt < COAST_QUIET_MS || t - smoothAt < SMOOTH_MS) return "wait";
    const top = container.scrollTop;
    return top >= 0 && top <= container.scrollHeight - container.clientHeight + 0.5 ? "on" : "wait";
  };
  const settleHost = (why: string) => {
    if (!container || !hostDefers || phase !== "live" && phase !== "settling") return;
    const top = container.scrollTop;
    if (why !== "touch" && (top > 0.5 || top < 0)) return;
    const host = hostScrollOf(container);
    if (!host) return;
    const deferred = host.deferred;
    if (Math.abs(deferred) < 0.5 || why !== "touch" && deferred < 0) return;
    try { host.flushDeferred(); host.reconcile(); } catch { return; }
    trace("flush-host", { why, from: Math.round(top), deferred: Math.round(deferred), to: Math.round(container.scrollTop) });
  };
  const arm = (pin: Pin | null = null) => {
    if (!container) return;
    let chosen = pin;
    if (!chosen || !chosen.element.isConnected || floating(chosen.element, container)) {
      const top = topPin();
      chosen = top && !floating(top.element, container) ? top : visiblePin();
    }
    if (chosen && floating(chosen.element, container)) {
      const line = lineAt(true, true);
      chosen = line ? pinOf(line.element, line.offset, true) : null;
    }
    track = chosen ? { pin: chosen, base: chosen.element.getBoundingClientRect().top - viewTop() + container.scrollTop, comp, width: Math.round(container.clientWidth), height: container.scrollHeight } : null;
  };
  const syncTrack = (why: string, correct: boolean, clean = true) => {
    if (!container) return;
    const pushed = hostSince;
    hostSince = 0;
    const state = guardState();
    if (state === "off") { track = null; return; }
    if (why === "scroll") { if (state === "wait" || clean) arm(); return; }
    if (!track || track.width !== Math.round(container.clientWidth)) { if (clean || state === "wait") arm(); return; }
    let pin = track.pin;
    if (!pin.element.isConnected || !hasBox(pin.element)) {
      const again = refind(pin);
      if (!again || !hasBox(again.element)) { if (clean || state === "wait") arm(); else track = null; return; }
      pin = track.pin = again;
    }
    const visual = pin.element.getBoundingClientRect().top - viewTop();
    const from = container.scrollTop;
    const drift = visual + from - track.base - (comp - track.comp);
    if (state === "wait") {
      const pure = why === "write" && pushed > PUSH_PX && Math.abs(pushed + drift) < 2;
      const fixable = correct || pure || why === "write" && container.scrollHeight === track.height;
      if (fixable && !hostDefers && !deferredByHost() && drift < -PUSH_PX && visual > -container.clientHeight / 2 && visual < container.clientHeight * 1.5) {
        const target = Math.max(from + drift, 0);
        if (from - target >= 1) {
          trace("undo-push", { why, from: Math.round(from), to: Math.round(target), drift: Math.round(drift), sh: container.scrollHeight - track.height, text: (pin.element.textContent ?? "").slice(0, 24) });
          write(target);
        }
      }
      if (correct || Math.abs(container.scrollTop - from) >= 1 || Math.abs(drift) <= GUARD_PX) arm(pin);
      return;
    }
    const away = visual < -container.clientHeight / 2 || visual > container.clientHeight * 1.5;
    const jumped = why === "write" && Math.abs(pushed) > PUSH_PX && Math.abs(pushed + drift) < 2;
    if (!correct && !jumped || Math.abs(drift) <= GUARD_PX) { if (away && clean) arm(); return; }
    const max = Math.max(0, container.scrollHeight - container.clientHeight);
    const target = Math.min(Math.max(from + drift, 0), max);
    if (Math.abs(target - from) < 1) { arm(pin); return; }
    trace("guard", { why, from: Math.round(from), to: Math.round(target), drift: Math.round(drift), text: (pin.element.textContent ?? "").slice(0, 24) });
    write(target);
    lastFixAt = now();
    const scrolled = container.scrollTop - from, moved = visual - (pin.element.getBoundingClientRect().top - viewTop());
    if (Math.abs(scrolled) >= 2 && Math.abs(moved - scrolled) > Math.abs(scrolled) / 2) { trace("guard-stuck", { scrolled: Math.round(scrolled), moved: Math.round(moved) }); track = null; }
    else if (Math.abs(target - (from + drift)) >= 1) arm(pin);
  };
  const queueCheck = (why: string) => {
    if (checkQueued) return;
    checkQueued = true;
    queueMicrotask(() => { checkQueued = false; syncTrack(why, dirtyAt <= resizedAt); });
  };
  const capture = (force = false) => {
    if (disposed || frozen || phase !== "live" || !force && !isActive()) return;
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
    const line = measured.atBottom ? null : lineAt(true);
    const kept = !line && !measured.atBottom && lastAnchor && !lastAnchor.atBottom && lastAnchor.line && lastAnchor.messageSeq === measured.messageSeq && Math.abs(lastAnchor.offset - measured.offset) < 1 ? lastAnchor : null;
    const next: ScrollPosition = kept ?? (!measured.atBottom && line ? { ...measured, line: line.anchor } : measured);
    lastAnchor = next;
    if (!kept) lastFine = line ? pinOf(line.element, line.offset, true) : null;
    widths.set(Math.round(found.clientWidth), { anchor: next, fine: lastFine, userAt: dragAt });
    if (keepSaved) return;
    const serialized = JSON.stringify(next);
    if (serialized === lastSaved) return;
    lastSaved = serialized;
    trace("capture", next);
    store.save(next);
  };

  const onScroll = () => {
    if (!container) return;
    if (scrollRetired()) { stop(); return; }
    const ours = ownTop !== null && Math.abs(container.scrollTop - ownTop) < 1;
    const byHost = !ours && hostTop !== null && Math.abs(container.scrollTop - hostTop) < 1 && now() - hostAt < 100;
    if (!ours && !byHost) userMovedAt = now();
    const gesture = !ours && gestureScroll();
    if (gesture) dragAt = now();
    if (gesture || !ours && (now() - userScrollAt < CHAIN_MS || now() - intentAt < INTENT_MS)) userScrollAt = now();
    if (phase === "restoring") { attempt(); return; }
    if (!touching && container.scrollTop <= 0.5) settleHost("top");
    if (phase === "settling") { keep(!ours); return; }
    if (Math.abs(container.clientWidth - lastWidth) >= 1) { resized(); return; }
    if (held() && touching) {
      if (ours) return;
      if (fingerScrolling()) { fingerMoved = false; dragged = true; fingerRef = visiblePin(); }
      else { keepFinger(); return; }
    }
    const user = !ours && (gesture || now() - userScrollAt < 1);
    if (!ours) {
      if (user || /^#msg=/.test(location.hash)) { keepSaved = false; setPinned(container.scrollTop < lastScrollTop - 0.5 ? gap() <= EXACT_GAP : atBottomNow(), user ? "gesture" : "link"); }
      else if (atBottomNow() && (now() - intentAt < INTENT_MS || now() - sentAt < SEND_MS)) setPinned(true, "intent");
      else if (pinned && movedUp()) setPinned(false, "up");
      else if (!pinned && gap() <= 2) setPinned(true, "scroll");
    }
    if (!ours && !byHost) syncTrack("scroll", false, now() - dirtyAt > 32);
    lastScrollTop = container.scrollTop;
    if (gap() <= 2 || user && atBottomNow()) edgeTop = container.scrollTop;
    else if (pinned) edgeTop = Math.max(edgeTop ?? container.scrollTop, container.scrollTop);
    measure();
    capture();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => capture(), 120);
  };
  const resized = () => {
    if (!container || disposed) return;
    if (phase === "restoring") { attempt(); return; }
    resizedAt = now();
    watchColumn();
    syncTrack("resize", true);
    if (phase === "settling") { keep(); return; }
    if (phase !== "live") { measure(); return; }
    if (held() && touching && fingerRef) { if (!fingerScrolling()) keepFinger(); else fingerRef = visiblePin(); measure(); return; }
    const width = Math.round(container.clientWidth);
    const widthChanged = Math.abs(container.clientWidth - lastWidth) >= 1;
    const changed = widthChanged || lastHeight !== container.clientHeight || lastScrollHeight !== container.scrollHeight;
    if (!pinned && now() - sentAt < SEND_MS && newestSeq() > sentSeq && composerEmpty()) setPinned(true, "sent");
    if (changed && pinned && !widthChanged && movedUp()) setPinned(false, "up");
    else if (changed && pinned && !gestureActive()) follow(widthChanged ? "width" : "resize");
    else if (widthChanged && !pinned && !gestureActive() && !quiet) {
      const memory = widths.get(width);
      const own = memory && memory.userAt === dragAt && !memory.anchor.atBottom ? memory : null;
      const from = own ? own.anchor : lastAnchor;
      if (from) { hold(own ? "width-return" : "width", from, own ? own.fine : lastFine); return; }
    }
    lastScrollTop = container.scrollTop;
    measure();
  };
  const watchColumn = () => {
    const column = container ? rowsColumn(container) : null;
    if (column === watchedColumn) return;
    styleWatch.disconnect();
    watchedColumn = column;
    if (column) styleWatch.observe(column, { attributes: true, attributeFilter: ["style"] });
  };
  const bind = () => {
    if (container?.isConnected) return container;
    const found = chatScroller(threadId);
    if (found === container) return container;
    resize?.disconnect();
    resize = null;
    unhook?.();
    unhook = null;
    unrender?.();
    unrender = null;
    dirtyWatch.disconnect();
    container?.removeEventListener("scroll", onScroll);
    container = found;
    track = null;
    if (!container) return null;
    ownTop = null;
    measure();
    lastScrollTop = container.scrollTop;
    container.addEventListener("scroll", onScroll, { passive: true });
    const bound = container;
    unhook = onScrollWrite(bound, w => {
      if (w.pending) { if (!w.own) smoothAt = now(); return; }
      comp += w.to - w.from;
      if (w.own) return;
      hostSince += w.to - w.from;
      hostTop = w.to;
      hostAt = now();
      queueCheck("write");
    });
    dirtyWatch.observe(bound, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["class", "style", "open", "hidden"] });
    unrender = prerenderRows(bound, count => trace("prerender", { count }));
    watchColumn();
    if (typeof ResizeObserver !== "undefined") queueMicrotask(() => {
      if (disposed || container !== bound || resize) return;
      resize = new ResizeObserver(resized);
      resize.observe(bound);
      if (bound.firstElementChild) resize.observe(bound.firstElementChild);
    });
    return container;
  };
  const checkLate = (found: HTMLElement) => {
    lateChecked = true;
    const resumed = takePendingRestore(threadId);
    const shownAt = primedBefore ? null : chatShownAt(found, threadId);
    const late = shownAt === null ? 0 : now() - shownAt;
    if (late <= LATE_MS) return;
    if (resumed || veiledAt !== null || late <= LATE_CUT_MS && untouchedSince(found, shownAt!)) {
      trace("late-restore", { shownMs: Math.round(late), resumed });
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
    if (!dragged && !panned) actionAt = t;
    trace("touch-end", { source, dragged, panned, pinned });
    if (phase === "live" && !dragged && !panned && pinned) requestAnimationFrame(() => {
      if (held() || !pinned) return;
      if (gap() <= BOTTOM_GAP) follow("lift");
      else setPinned(false, "lift");
    });
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
    if (scrollRetired()) { stop(); return; }
    const t = now();
    touchedAt = t;
    if (event.type !== "touchmove") intentAt = t;
    const target = event.target instanceof Node ? event.target : null;
    const inFooter = target instanceof Element && Boolean(target.closest("[data-scroll-footer]"));
    const inside = container !== null && target !== null && container.contains(target) && !inFooter;
    if ((event.type === "keydown" || event.type === "click") && sendIntent(event)) { sentAt = t; sentSeq = newestSeq(); trace("send", { via: event.type }); }
    switch (event.type) {
      case "touchend": case "touchcancel": if ((event as TouchEvent).touches.length === 0) endTouch(t, event.type); return;
      case "pointerup": case "pointercancel":
        if ((event as PointerEvent).pointerType === "touch") { if (event.type === "pointerup") endTouch(t, event.type); else if (touching) panned = true; }
        else if (pointerDown) { pointerDown = false; gestureAt = t; }
        return;
      case "click": actionAt = t; endTouch(t, "click"); return;
      case "touchmove": {
        const point = (event as TouchEvent).touches[0];
        if (touching) { fingerMovedAt = t; fingerMoved = true; if (point && Math.hypot(point.clientX - touchX, point.clientY - touchY) >= 4) panned = true; }
        return;
      }
      case "touchstart":
        if (inside) {
          if ((event as TouchEvent).touches.length === 1) settleHost("touch");
          const point = (event as TouchEvent).touches[0];
          track = null;
          touching = true; touchAt = t; touchGap = gap(); dragged = false; fingerMoved = false; fingerMovedAt = -Infinity; panned = (event as TouchEvent).touches.length > 1; touchX = point?.clientX ?? 0; touchY = point?.clientY ?? 0; fingerRef = phase === "live" ? visiblePin() : null;
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
      case "keydown": if (scrollKeys.has((event as KeyboardEvent).key) && !inFooter) gestureAt = t; else actionAt = t; break;
      case "beforeinput": actionAt = t; break;
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

  const styleWatch = new MutationObserver(() => {
    if (phase === "live" && held() && touching && fingerRef && !fingerScrolling()) keepFinger();
    else if (!touching && container && container.scrollTop <= 0.5) settleHost("top");
  });
  const dirtyWatch = new MutationObserver(records => { if (records.some(record => record.target !== container)) dirtyAt = now(); });
  const observer = new MutationObserver(records => {
    if (phase === "restoring") attempt();
    else if (phase === "settling") {
      if (container && records.some(record => container!.contains(record.target))) changedAt = now();
      if (!hostDefers) keep();
    }
  });
  const tick = () => {
    if (phase === "restoring") attempt(true);
    else if (phase === "settling") keep();
    if (phase === "restoring" || phase === "settling") frame = requestAnimationFrame(tick);
  };
  const startRestore = () => {
    phase = "restoring";
    if (position && !position.atBottom) {
      const scroller = chatScroller(threadId);
      const shownAt = scroller ? chatShownAt(scroller, threadId) : null;
      if (!scroller) hide();
      else freshMount = shownAt === null || now() - shownAt <= LATE_MS;
    }
    observer.observe(document.documentElement, { childList: true, subtree: true });
    attempt();
    frame = requestAnimationFrame(tick);
  };
  if (phase === "waiting") {
    void store.load!().then(value => {
      if (disposed || phase !== "waiting") return;
      position = value;
      keepSaved = value !== null && !value.atBottom;
      trace("loaded", value);
      if (!value || value.atBottom) { goLive("loaded"); return; }
      startRestore();
    }, () => goLive("load-failed"));
  }
  if (phase === "restoring") startRestore();
  else {
    if (veiledAt !== null) show();
    bind();
    if (phase === "live") { measure(); pinned = atBottomNow() || position?.atBottom === true; if (pinned) edgeTop = topNow(); trace("live", { reason: "start", pinned }); }
  }
  const timer = setInterval(() => {
    if (scrollRetired()) { stop(); return; }
    if (phase === "restoring") attempt();
    else if (phase === "settling") keep();
    else if (phase === "waiting" && now() - startedAt > WAIT_MAX_MS) { keepSaved = true; quiet = true; goLive("load-timeout"); }
    else capture();
  }, 200);

  function stop() {
    if (disposed) return;
    trace("dispose", { phase });
    if (phase === "restoring" && !frozen) markPendingRestore(threadId);
    if (phase === "live" && !frozen) capture(true);
    if (phase === "restoring" && requested) store.cancelAnchor?.();
    disposed = true;
    show();
    unmute(FLASH_MS);
    observer.disconnect();
    styleWatch.disconnect();
    dirtyWatch.disconnect();
    unhook?.();
    unrender?.();
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
  }
  return stop;
}

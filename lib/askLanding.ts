import { askStripTop } from "./askStrip";
const WAIT_MS = 30_000;
const STEP_MS = 150;
const STEADY_MS = 450;
const GAP = 12;
const REPEATS = 3;
const VIEWPORT = "[data-page-scroll-viewport]";
const FOOTER = "[data-scroll-footer]";
const CARD_FOOT = /^(?:Copy as markdown|Source)$/;
const MESSAGE_TOOLS = /^(?:Copy message|Remind me|Reply in side chat|Message actions)$/;

let running: { cancel: () => void } | null = null;

function message(seq: number): HTMLElement | null {
  const wide = innerWidth >= 500;
  return Array.from(document.querySelectorAll<HTMLElement>(`[data-notification-message="${seq}"]`)).find(node => {
    const box = node.getBoundingClientRect();
    return box.height > 0 && (!wide || !node.closest(".radar-list-shell, [data-testid=\"nav-rail-sidebar-body\"]"));
  }) ?? null;
}

function label(button: HTMLElement): string {
  return (button.getAttribute("aria-label") || button.innerText || "").trim();
}

export function askArea(node: HTMLElement): { top: number; bottom: number } {
  const box = node.getBoundingClientRect();
  const buttons = Array.from(node.querySelectorAll<HTMLElement>("button")).filter(button => button.getBoundingClientRect().height > 0);
  const tools = buttons.filter(button => MESSAGE_TOOLS.test(label(button)));
  const textBottom = tools.length ? Math.min(...tools.map(button => button.getBoundingClientRect().top)) - 4 : box.bottom;
  const feet = buttons.filter(button => CARD_FOOT.test(label(button)));
  const lastFoot = feet.length ? feet[feet.length - 1]! : null;
  if (!lastFoot) return { top: box.top, bottom: textBottom };
  const footBottom = lastFoot.getBoundingClientRect().bottom;
  let card: HTMLElement | null = lastFoot;
  while (card && card.parentElement && card.parentElement !== node && card.getBoundingClientRect().height < 60) card = card.parentElement;
  const cardTop = card ? card.getBoundingClientRect().top : box.top;
  const answers = buttons.filter(button => !CARD_FOOT.test(label(button)) && !MESSAGE_TOOLS.test(label(button)) && button.getBoundingClientRect().top >= cardTop - 1);
  const bottom = Math.max(footBottom, ...answers.map(button => button.getBoundingClientRect().bottom));
  return { top: Math.min(cardTop, ...answers.map(button => button.getBoundingClientRect().top)), bottom: Math.max(bottom, textBottom > footBottom + 40 ? textBottom : bottom) };
}

function visibleBand(viewport: HTMLElement): { top: number; bottom: number } {
  const box = viewport.getBoundingClientRect();
  const footer = Array.from(viewport.querySelectorAll<HTMLElement>(FOOTER)).map(node => node.getBoundingClientRect()).find(rect => rect.height > 0 && rect.top < box.bottom);
  const strip = askStripTop();
  const bottom = footer ? Math.min(box.bottom, footer.top) : box.bottom;
  return { top: box.top, bottom: strip !== null && strip > box.top + 120 ? Math.min(bottom, strip) : bottom };
}

export function chatFooter(): DOMRect | null {
  return Array.from(document.querySelectorAll<HTMLElement>(FOOTER)).map(node => node.getBoundingClientRect()).find(rect => rect.height > 0 && rect.width > 200) ?? null;
}

export function askCardAnswers(seq: number): string[] | null {
  const node = message(seq);
  if (!node) return null;
  return Array.from(node.querySelectorAll<HTMLElement>("button")).filter(button => button.getBoundingClientRect().height > 0).map(label).filter(text => text && !CARD_FOOT.test(text) && !MESSAGE_TOOLS.test(text));
}

export function settleAskInView(seq: number): void {
  running?.cancel();
  const started = Date.now();
  let lastTop: number | null = null;
  let steadySince = 0;
  let moves = 0;
  let timer = 0;
  let cancelled = false;
  const stop = () => { cancelled = true; clearTimeout(timer); window.removeEventListener("wheel", stop); window.removeEventListener("touchstart", stop); window.removeEventListener("keydown", stop); if (running?.cancel === stop) running = null; };
  running = { cancel: stop };
  window.addEventListener("wheel", stop, { passive: true, once: true });
  window.addEventListener("touchstart", stop, { passive: true, once: true });
  window.addEventListener("keydown", stop, { once: true });
  const tick = () => {
    if (cancelled) return;
    if (Date.now() - started > WAIT_MS || !new RegExp(`(?:^#|&)msg=${seq}(?:&|$)`).test(location.hash) && moves > 0) { stop(); return; }
    const node = message(seq);
    const viewport = node?.closest<HTMLElement>(VIEWPORT) ?? null;
    if (!node || !viewport) { timer = window.setTimeout(tick, STEP_MS); return; }
    const top = Math.round(node.getBoundingClientRect().top);
    if (top !== lastTop) { lastTop = top; steadySince = Date.now(); timer = window.setTimeout(tick, STEP_MS); return; }
    if (Date.now() - steadySince < STEADY_MS) { timer = window.setTimeout(tick, STEP_MS); return; }
    const band = visibleBand(viewport);
    const area = askArea(node);
    const room = band.bottom - band.top - 2 * GAP;
    const want = area.bottom - area.top <= room ? Math.max(area.bottom - (band.bottom - GAP), 0) : area.top - (band.top + GAP);
    const lift = Math.min(want, Math.max(0, area.top - (band.top + GAP)));
    if (lift > 1 && moves < REPEATS) {
      viewport.scrollTop += lift;
      moves++;
      lastTop = null;
      timer = window.setTimeout(tick, STEP_MS);
      return;
    }
    if (moves >= REPEATS || Date.now() - steadySince > 4000) { stop(); return; }
    timer = window.setTimeout(tick, STEP_MS * 2);
  };
  tick();
}

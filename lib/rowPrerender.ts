const ROWS = '[data-timeline-row-list="top-level"] > [data-timeline-items] > [data-timeline-row-id], [data-timeline-row-list="top-level"] > [data-timeline-row-id]';
const SCREENS = 3;
const IDLE_RECHECK_MS = 120;

export function prerenderRows(container: HTMLElement, onOpen?: (count: number, held: number) => void, busy?: () => boolean) {
  if (typeof IntersectionObserver === "undefined" || typeof MutationObserver === "undefined") return () => {};
  const forced = new Set<HTMLElement>();
  const watched = new WeakSet<Element>();
  const wanted = new Set<HTMLElement>();
  let frame = 0, recheck: ReturnType<typeof setTimeout> | undefined, stopped = false;
  const lazy = (row: HTMLElement) => getComputedStyle(row).contentVisibility === "auto";
  const open = (row: HTMLElement) => {
    if (forced.has(row) || !lazy(row)) return false;
    row.style.setProperty("content-visibility", "visible");
    forced.add(row);
    return true;
  };
  const close = (row: HTMLElement) => {
    if (!forced.delete(row)) return;
    row.style.removeProperty("content-visibility");
  };
  const flush = () => {
    frame = 0;
    if (stopped) return;
    const moving = busy?.() ?? false;
    const top = moving ? container.getBoundingClientRect().top : 0;
    let opened = 0, held = 0;
    for (const row of wanted) {
      if (!row.isConnected) { wanted.delete(row); continue; }
      if (moving && row.getBoundingClientRect().bottom <= top) { held++; continue; }
      wanted.delete(row);
      if (open(row)) opened++;
    }
    if (opened) onOpen?.(opened, held);
    clearTimeout(recheck);
    if (held) recheck = setTimeout(schedule, IDLE_RECHECK_MS);
  };
  const schedule = () => { if (!frame && !stopped) frame = requestAnimationFrame(flush); };
  const io = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const row = entry.target as HTMLElement;
      if (!row.isConnected) { forced.delete(row); wanted.delete(row); continue; }
      if (entry.isIntersecting) wanted.add(row);
      else { wanted.delete(row); close(row); }
    }
    if (wanted.size) schedule();
  }, { root: container, rootMargin: `${SCREENS * 100}% 0px` });
  const watch = (row: Element) => {
    if (watched.has(row)) return;
    watched.add(row);
    io.observe(row);
  };
  const near = (rows: HTMLElement[]) => {
    const bounds = container.getBoundingClientRect();
    const reach = container.clientHeight * SCREENS;
    const moving = busy?.() ?? false;
    let opened = 0;
    for (const row of rows) {
      const box = row.getBoundingClientRect();
      if (box.bottom <= bounds.top - reach || box.top >= bounds.bottom + reach) continue;
      if (moving && box.bottom <= bounds.top) { wanted.add(row); continue; }
      if (open(row)) opened++;
    }
    if (wanted.size) schedule();
    return opened;
  };
  const rowsIn = (node: Node, into: HTMLElement[]) => {
    if (!(node instanceof HTMLElement) || !container.contains(node)) return;
    if (node.matches(ROWS)) { into.push(node); return; }
    if (node.querySelector("[data-timeline-row-id]")) for (const row of node.querySelectorAll<HTMLElement>(ROWS)) into.push(row);
  };
  const added = new MutationObserver(records => {
    const fresh: HTMLElement[] = [];
    for (const record of records) for (const node of record.addedNodes) rowsIn(node, fresh);
    if (!fresh.length) return;
    for (const row of fresh) watch(row);
    const opened = near(fresh);
    if (opened) onOpen?.(opened, 0);
  });
  added.observe(container, { childList: true, subtree: true });
  const initial = Array.from(container.querySelectorAll<HTMLElement>(ROWS));
  for (const row of initial) watch(row);
  return () => {
    stopped = true;
    cancelAnimationFrame(frame);
    clearTimeout(recheck);
    added.disconnect();
    io.disconnect();
    for (const row of forced) row.style.removeProperty("content-visibility");
    forced.clear();
    wanted.clear();
  };
}

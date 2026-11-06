const ROWS = '[data-timeline-row-list="top-level"] > [data-timeline-items] > [data-timeline-row-id], [data-timeline-row-list="top-level"] > [data-timeline-row-id]';
const SCREENS = 3;

export function prerenderRows(container: HTMLElement, onOpen?: (count: number) => void) {
  if (typeof IntersectionObserver === "undefined" || typeof MutationObserver === "undefined") return () => {};
  const forced = new Set<HTMLElement>();
  const watched = new WeakSet<Element>();
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
  const io = new IntersectionObserver(entries => {
    let opened = 0;
    for (const entry of entries) {
      const row = entry.target as HTMLElement;
      if (!row.isConnected) { forced.delete(row); continue; }
      if (entry.isIntersecting) { if (open(row)) opened++; }
      else close(row);
    }
    if (opened) onOpen?.(opened);
  }, { root: container, rootMargin: `${SCREENS * 100}% 0px` });
  const watch = (row: Element) => {
    if (watched.has(row)) return;
    watched.add(row);
    io.observe(row);
  };
  const near = (rows: HTMLElement[]) => {
    const bounds = container.getBoundingClientRect();
    const reach = container.clientHeight * SCREENS;
    let opened = 0;
    for (const row of rows) {
      const box = row.getBoundingClientRect();
      if (box.bottom > bounds.top - reach && box.top < bounds.bottom + reach && open(row)) opened++;
    }
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
    if (opened) onOpen?.(opened);
  });
  added.observe(container, { childList: true, subtree: true });
  const initial = Array.from(container.querySelectorAll<HTMLElement>(ROWS));
  for (const row of initial) watch(row);
  return () => {
    added.disconnect();
    io.disconnect();
    for (const row of forced) row.style.removeProperty("content-visibility");
    forced.clear();
  };
}

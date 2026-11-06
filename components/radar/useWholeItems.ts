import { useLayoutEffect, type RefObject } from "react";

const CAP_SHARE = 0.62;
const CAP_MAX = 560;
const ROOM_MARGIN = 8;

function scrollParent(node: HTMLElement): HTMLElement | null {
  for (let at = node.parentElement; at; at = at.parentElement) {
    const style = getComputedStyle(at);
    if (/(auto|scroll)/.test(style.overflowY) && at.clientHeight > 0) return at;
  }
  return null;
}

function roomInPage(node: HTMLElement): number {
  const scroller = scrollParent(node);
  const slot = node.closest<HTMLElement>(".stage-needs-slot");
  const box = node.closest<HTMLElement>(".stage-needs");
  if (!scroller || !slot || !box) return Infinity;
  const natural = box.offsetHeight;
  const others = scroller.scrollHeight - slot.offsetHeight;
  return scroller.clientHeight - others - (natural - node.offsetHeight) - ROOM_MARGIN;
}

export function useWholeItems(list: RefObject<HTMLElement | null>, open: boolean, count: number) {
  useLayoutEffect(() => {
    const node = list.current;
    if (!node) return;
    if (!open) { node.style.maxHeight = ""; node.style.scrollbarGutter = ""; return; }
    const fit = () => {
      const keep = node.scrollTop;
      node.style.maxHeight = "";
      node.style.scrollbarGutter = "";
      const items = Array.from(node.children) as HTMLElement[];
      const firstBottom = items[0] ? items[0].offsetTop + items[0].offsetHeight - node.offsetTop : 0;
      const cap = Math.max(Math.min(window.innerHeight * CAP_SHARE, CAP_MAX, roomInPage(node)), firstBottom);
      if (node.scrollHeight > cap + 0.5) node.style.scrollbarGutter = "stable";
      const top = node.getBoundingClientRect().top - node.scrollTop;
      let used = 0;
      for (const item of items) {
        const bottom = item.getBoundingClientRect().bottom - top;
        if (bottom > cap + 0.5) break;
        used = bottom;
      }
      const capped = used > 0 && used < node.scrollHeight - 0.5;
      node.style.maxHeight = capped ? `${Math.ceil(used)}px` : "";
      if (!capped) node.style.scrollbarGutter = "";
      node.scrollTop = keep;
    };
    fit();
    let frame = 0;
    const later = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(fit); };
    const observer = new ResizeObserver(later);
    for (const item of Array.from(node.children)) observer.observe(item);
    window.addEventListener("resize", fit);
    return () => { cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener("resize", fit); };
  }, [list, open, count]);
}

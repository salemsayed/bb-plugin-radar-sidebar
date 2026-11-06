import { useLayoutEffect, type RefObject } from "react";

const CAP_SHARE = 0.46;
const CAP_MAX = 420;

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
      const scroller = node.closest<HTMLElement>(".radar-list-body");
      const overflow = () => scroller ? Math.max(0, scroller.scrollHeight - scroller.clientHeight) : 0;
      const squeeze = overflow() > 0 && window.innerWidth >= 500;
      if (squeeze) node.style.scrollbarGutter = "stable";
      const over = overflow();
      const floor = items.length > 1 ? items[1]!.getBoundingClientRect().bottom - node.getBoundingClientRect().top : 0;
      const room = squeeze && over > 0 ? Math.max(floor, node.scrollHeight - over) : Infinity;
      const cap = Math.min(window.innerHeight * CAP_SHARE, CAP_MAX, room);
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

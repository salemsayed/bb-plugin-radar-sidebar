import { useLayoutEffect, type RefObject } from "react";

const CAP_SHARE = 0.62;
const CAP_MAX = 560;

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
      const cap = Math.min(window.innerHeight * CAP_SHARE, CAP_MAX);
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

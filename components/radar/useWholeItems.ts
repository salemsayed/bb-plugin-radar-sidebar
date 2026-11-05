import { useLayoutEffect, type RefObject } from "react";

const CAP_SHARE = 0.46;
const CAP_MAX = 420;

export function useWholeItems(list: RefObject<HTMLElement | null>, open: boolean, count: number) {
  useLayoutEffect(() => {
    const node = list.current;
    if (!node) return;
    if (!open) { node.style.maxHeight = ""; return; }
    const fit = () => {
      const cap = Math.min(window.innerHeight * CAP_SHARE, CAP_MAX);
      const items = Array.from(node.children) as HTMLElement[];
      const top = node.getBoundingClientRect().top - node.scrollTop;
      let used = 0;
      for (const item of items) {
        const bottom = item.getBoundingClientRect().bottom - top;
        if (bottom > cap + 0.5) break;
        used = bottom;
      }
      node.style.maxHeight = used > 0 && used < node.scrollHeight - 0.5 ? `${Math.ceil(used)}px` : "";
    };
    fit();
    window.addEventListener("resize", fit);
    return () => window.removeEventListener("resize", fit);
  }, [list, open, count]);
}

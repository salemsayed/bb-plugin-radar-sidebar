import { useLayoutEffect, type RefObject } from "react";

const CAP_SHARE = 0.46;
const CAP_MAX = 420;

export function useWholeItems(list: RefObject<HTMLElement | null>, open: boolean, count: number) {
  useLayoutEffect(() => {
    const node = list.current;
    if (!node) return;
    if (!open) { node.style.maxHeight = ""; return; }
    const fit = () => {
      node.style.maxHeight = "";
      const items = Array.from(node.children) as HTMLElement[];
      const scroller = node.closest<HTMLElement>(".radar-list-body");
      const over = scroller ? Math.max(0, scroller.scrollHeight - scroller.clientHeight) : 0;
      const floor = items.length > 1 ? items[1]!.getBoundingClientRect().bottom - node.getBoundingClientRect().top : 0;
      const room = over > 0 ? Math.max(floor, node.scrollHeight - over) : Infinity;
      const cap = Math.min(window.innerHeight * CAP_SHARE, CAP_MAX, room);
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

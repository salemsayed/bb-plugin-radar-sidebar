import { useLayoutEffect, useRef, type FocusEvent, type KeyboardEvent, type RefObject } from "react";

export interface RovingOptions {
  item: string;
  row: string;
  side?: string;
  preferred?: string | null;
}

export function useRoving(container: RefObject<HTMLElement | null>, { item, row, side, preferred = null }: RovingOptions) {
  const last = useRef<string | null>(null);
  const items = () => Array.from(container.current?.querySelectorAll<HTMLElement>(item) ?? []);
  const settle = () => {
    const list = items();
    if (!list.length) return;
    const chosen = list.find(el => el.dataset.rove === last.current) ?? list.find(el => el.dataset.rove === preferred) ?? list[0];
    for (const el of list) el.tabIndex = el === chosen ? 0 : -1;
    if (side) for (const el of container.current?.querySelectorAll<HTMLElement>(side) ?? []) el.tabIndex = -1;
  };
  useLayoutEffect(settle);
  const onFocus = (event: FocusEvent<HTMLElement>) => {
    const host = (event.target as HTMLElement).closest<HTMLElement>(row);
    const target = host?.matches(item) ? host : host?.querySelector<HTMLElement>(item);
    if (!target?.dataset.rove) return;
    last.current = target.dataset.rove;
    settle();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    const here = target.closest<HTMLElement>(row);
    const list = items();
    const at = list.findIndex(el => el.closest(row) === here);
    if (at < 0) return;
    const to = (index: number) => { event.preventDefault(); list[(index + list.length) % list.length]?.focus(); };
    if (event.key === "ArrowDown") to(at + 1);
    else if (event.key === "ArrowUp") to(at - 1);
    else if (event.key === "Home") to(0);
    else if (event.key === "End") to(list.length - 1);
    else if (side && event.key === "ArrowRight" && target.matches(item)) {
      const next = here?.querySelector<HTMLElement>(side);
      if (next) { event.preventDefault(); next.focus(); }
    } else if (side && event.key === "ArrowLeft" && target.matches(side)) to(at);
  };
  return { onFocus, onKeyDown };
}

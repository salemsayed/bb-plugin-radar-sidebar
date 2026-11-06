import { useEffect, useLayoutEffect, useState, type RefObject } from "react";

const TOUCH_HOLD_MS = 1500;

export function useGrowSlot(slot: RefObject<HTMLElement | null>, inner: RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const box = slot.current;
    const content = inner.current;
    if (!box || !content) return;
    let shown = -1;
    const apply = () => {
      const next = content.offsetHeight;
      if (Math.abs(next - shown) < 0.5) return;
      shown = next;
      box.style.height = `${next}px`;
    };
    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(content);
    return () => { observer.disconnect(); box.style.height = ""; };
  }, [slot, inner]);
}

export function useTouchHold(root: RefObject<HTMLElement | null>): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    let timer = 0;
    let touching = false;
    const release = () => { clearTimeout(timer); timer = window.setTimeout(() => { if (!touching) setOn(false); }, TOUCH_HOLD_MS); };
    const down = (event: PointerEvent) => {
      if (event.pointerType === "mouse" || !(event.target instanceof Node) || !node.contains(event.target)) return;
      touching = true;
      clearTimeout(timer);
      setOn(true);
    };
    const up = (event: PointerEvent) => { if (event.pointerType === "mouse" || !touching) return; touching = false; release(); };
    const scroll = (event: Event) => {
      if (!(event.target instanceof Node) || !event.target.contains(node)) return;
      setOn(true);
      release();
    };
    document.addEventListener("pointerdown", down, true);
    document.addEventListener("pointerup", up, true);
    document.addEventListener("pointercancel", up, true);
    document.addEventListener("scroll", scroll, true);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("pointerdown", down, true);
      document.removeEventListener("pointerup", up, true);
      document.removeEventListener("pointercancel", up, true);
      document.removeEventListener("scroll", scroll, true);
    };
  }, [root]);
  return on;
}

export function useWatching(visible: boolean): boolean {
  const [focused, setFocused] = useState(() => typeof document !== "undefined" && document.hasFocus() && document.visibilityState === "visible");
  useEffect(() => {
    const check = () => setFocused(document.hasFocus() && document.visibilityState === "visible");
    const away = () => setFocused(false);
    window.addEventListener("focus", check);
    window.addEventListener("blur", away);
    document.addEventListener("visibilitychange", check);
    check();
    return () => {
      window.removeEventListener("focus", check);
      window.removeEventListener("blur", away);
      document.removeEventListener("visibilitychange", check);
    };
  }, []);
  return visible && focused;
}

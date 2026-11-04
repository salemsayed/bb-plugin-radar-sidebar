import { useEffect, useState, type RefObject } from "react";

export function useVisibleSurface(ref: RefObject<HTMLElement | null>): boolean {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let intersects = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const update = () => {
      clearTimeout(timer);
      if (!intersects || document.visibilityState !== "visible" || element.closest("[inert], [hidden], [aria-hidden=true]") || getComputedStyle(element).visibility !== "visible") setVisible(false);
      else timer = setTimeout(() => setVisible(true), 300);
    };
    const observer = new IntersectionObserver(entries => {
      intersects = entries.some(entry => entry.isIntersecting);
      update();
    });
    observer.observe(element);
    const attributes = new MutationObserver(update);
    for (let parent: HTMLElement | null = element; parent; parent = parent.parentElement) {
      attributes.observe(parent, { attributes: true, attributeFilter: ["inert", "hidden", "aria-hidden", "class", "style", "data-state", "data-collapsible"] });
    }
    document.addEventListener("visibilitychange", update);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
      attributes.disconnect();
      document.removeEventListener("visibilitychange", update);
    };
  }, [ref]);
  return visible;
}

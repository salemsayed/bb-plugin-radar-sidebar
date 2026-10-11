import { startTransition, useCallback, useLayoutEffect, useRef, useState, type RefObject } from "react";

type Listener = {
  intersect: (visible: boolean) => void;
  resize: (height: number) => void;
  invalidate: () => void;
};

// One pair of observers per scrolling list, rather than two per thread.
const lists = new WeakMap<Element, {
  listeners: Map<Element, Listener>;
  intersection: IntersectionObserver;
  resize: ResizeObserver;
}>();

function observeRow(element: HTMLElement, listener: Listener) {
  const root = element.closest(".radar-list-body");
  if (!root || typeof IntersectionObserver === "undefined" || typeof ResizeObserver === "undefined") {
    listener.intersect(true);
    return () => {};
  }
  let list = lists.get(root);
  if (!list) {
    const listeners = new Map<Element, Listener>();
    let width: number | undefined;
    const intersection = new IntersectionObserver(entries => {
      startTransition(() => {
        for (const entry of entries) listeners.get(entry.target)?.intersect(entry.isIntersecting);
      });
    }, { root, rootMargin: "400px 0px" });
    const resize = new ResizeObserver(entries => {
      for (const entry of entries) {
        if (entry.target === root) {
          if (width !== undefined && width !== entry.contentRect.width) {
            for (const row of listeners.values()) row.invalidate();
          }
          width = entry.contentRect.width;
        } else {
          listeners.get(entry.target)?.resize(entry.borderBoxSize[0]?.blockSize ?? entry.contentRect.height);
        }
      }
    });
    resize.observe(root);
    list = { listeners, intersection, resize };
    lists.set(root, list);
  }
  list.listeners.set(element, listener);
  list.intersection.observe(element);
  list.resize.observe(element);
  return () => {
    list.listeners.delete(element);
    list.intersection.unobserve(element);
    list.resize.unobserve(element);
    if (list.listeners.size === 0) {
      list.intersection.disconnect();
      list.resize.disconnect();
      lists.delete(root);
    }
  };
}

/** Keep lightweight links in DOM order for BB shortcuts and list navigation.
 * Only nearby rows need their icons, preview and native menu components. */
export function useRowViewport(
  rowRef: RefObject<HTMLDivElement | null>,
  forceContents: boolean,
  layoutKey: string,
  onElement: (element: HTMLDivElement | null) => void,
) {
  const supported = typeof IntersectionObserver !== "undefined" && typeof ResizeObserver !== "undefined";
  const [nearViewport, setNearViewport] = useState(!supported);
  const [focused, setFocused] = useState(false);
  const [measurement, setMeasurement] = useState<{ key: string; height: number } | null>(null);
  const renderContents = !supported || nearViewport || forceContents || focused;
  const current = useRef({ renderContents, layoutKey });
  current.current = { renderContents, layoutKey };
  const detach = useRef<(() => void) | null>(null);
  const ref = useCallback((node: HTMLDivElement | null) => {
    detach.current?.();
    detach.current = null;
    rowRef.current = node;
    onElement(node);
    if (node) detach.current = observeRow(node, {
      intersect: setNearViewport,
      resize: height => {
        if (!current.current.renderContents || height <= 0) return;
        const key = current.current.layoutKey;
        setMeasurement(previous => previous?.key === key && previous.height === height ? previous : { key, height });
      },
      invalidate: () => setMeasurement(null),
    });
  }, [rowRef, onElement]);

  // Materializing a focused placeholder replaces its link. Preserve keyboard
  // focus without scrolling again or dropping focus into the document body.
  useLayoutEffect(() => {
    if (focused && renderContents) {
      const row = rowRef.current;
      if (row && !row.contains(document.activeElement)) {
        row.querySelector<HTMLElement>("[data-sidebar-thread-id]")?.focus({ preventScroll: true });
      }
    }
  }, [focused, renderContents, rowRef]);

  return {
    ref,
    renderContents,
    height: measurement?.key === layoutKey ? measurement.height : undefined,
    onFocusCapture: () => setFocused(true),
    onBlurCapture: () => {
      // Focus can move between the link, inline actions and a rename input.
      queueMicrotask(() => {
        if (!rowRef.current?.contains(document.activeElement)) setFocused(false);
      });
    },
  };
}

import { useRef } from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useRowViewport } from "./useRowViewport";

const noop = () => {};
function intersectionEntry(target: Element, isIntersecting: boolean): IntersectionObserverEntry {
  return { target, isIntersecting, intersectionRatio: isIntersecting ? 1 : 0, time: 0,
    boundingClientRect: target.getBoundingClientRect(), intersectionRect: new DOMRect(), rootBounds: null };
}
function resizeEntry(target: Element, width: number, height: number): ResizeObserverEntry {
  const size = [{ inlineSize: width, blockSize: height }];
  return { target, contentRect: new DOMRect(0, 0, width, height), borderBoxSize: size,
    contentBoxSize: size, devicePixelContentBoxSize: size };
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("remembers variable row heights, invalidates changed layouts and shares observers", () => {
  let intersect: IntersectionObserverCallback;
  let resize: ResizeObserverCallback;
  let observerCount = 0;
  vi.stubGlobal("IntersectionObserver", class {
    constructor(callback: IntersectionObserverCallback) { intersect = callback; observerCount++; }
    observe() {} unobserve() {} disconnect() {}
  });
  vi.stubGlobal("ResizeObserver", class {
    constructor(callback: ResizeObserverCallback) { resize = callback; }
    observe() {} unobserve() {} disconnect() {}
  });
  function Row({ layout }: { layout: string }) {
    const rowRef = useRef<HTMLDivElement>(null);
    const viewport = useRowViewport(rowRef, false, layout, noop);
    return <div ref={viewport.ref} data-full={viewport.renderContents} style={{ height: viewport.height }} />;
  }
  const view = (layout: string) => <div className="radar-list-body"><Row layout={layout} /><Row layout="other" /></div>;
  const slot = render(view("original"));
  const root = slot.container.firstElementChild!;
  const row = root.firstElementChild as HTMLElement;
  expect(observerCount).toBe(1);
  act(() => intersect!([intersectionEntry(row, true)], {} as IntersectionObserver));
  act(() => resize!([
    resizeEntry(root, 320, 600),
    resizeEntry(row, 300, 83),
  ], {} as ResizeObserver));
  act(() => intersect!([intersectionEntry(row, false)], {} as IntersectionObserver));
  expect(row.dataset.full).toBe("false");
  expect(row.style.height).toBe("83px");
  slot.rerender(view("new title or density"));
  expect(row.style.height).toBe("");
  act(() => intersect!([intersectionEntry(row, true)], {} as IntersectionObserver));
  act(() => resize!([resizeEntry(row, 300, 110)], {} as ResizeObserver));
  expect(row.style.height).toBe("110px");
  act(() => resize!([resizeEntry(root, 400, 600)], {} as ResizeObserver));
  expect(row.style.height).toBe("");
});

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { rememberScroll } from "./scrollController";

let box: HTMLDivElement, anchor: HTMLDivElement;
let stop: (() => void) | undefined;
const saved = { atBottom: false as const, messageSeq: 42, offset: -30 };
function fixture(load = async () => saved as typeof saved | null) {
  const save = vi.fn();
  stop = rememberScroll("one", { load, save }, () => true);
  return save;
}
beforeEach(() => {
  vi.useFakeTimers();
  box = document.createElement("div");
  box.style.overflowY = "auto";
  anchor = document.createElement("div");
  anchor.dataset.notificationThread = "one";
  anchor.dataset.notificationMessage = "42";
  box.append(anchor);
  document.body.append(box);
  Object.defineProperties(box, { clientHeight: { value: 400 }, scrollHeight: { value: 2000 } });
  box.scrollTop = 1600;
  vi.spyOn(box, "getBoundingClientRect").mockImplementation(() => ({ top: 50, bottom: 450, left: 0, right: 400, height: 400, width: 400 }) as DOMRect);
  vi.spyOn(anchor, "getBoundingClientRect").mockImplementation(() => ({ top: 550 - box.scrollTop, bottom: 750 - box.scrollTop, height: 200 }) as DOMRect);
});
afterEach(() => { stop?.(); stop = undefined; box.remove(); vi.restoreAllMocks(); vi.useRealTimers(); });
it("conceals native bottom, survives its late initial scroll, then reveals the exact offset", async () => {
  fixture();
  expect(box.style.visibility).toBe("hidden");
  await vi.advanceTimersByTimeAsync(100);
  expect(box.scrollTop).toBe(530);
  box.scrollTop = 1600;
  await vi.advanceTimersByTimeAsync(100);
  expect(box.scrollTop).toBe(530);
  await vi.advanceTimersByTimeAsync(1600);
  expect(box.style.visibility).toBe("");
  expect(anchor.getBoundingClientRect().top - box.getBoundingClientRect().top).toBe(-30);
});
it("stops immediately on user input and records the user's new place", async () => {
  const save = fixture();
  await vi.advanceTimersByTimeAsync(100);
  box.dispatchEvent(new Event("touchstart", { bubbles: true }));
  expect(box.style.visibility).toBe("");
  box.scrollTop = 510;
  await vi.advanceTimersByTimeAsync(1000);
  expect(box.scrollTop).toBe(510);
  expect(save).toHaveBeenCalledWith({ ...saved, offset: -10 });
});
it("a missing older anchor triggers native scroll loading but times out without erasing the saved place", async () => {
  anchor.dataset.notificationMessage = "43";
  const scroll = vi.fn();
  box.addEventListener("scroll", scroll);
  const save = fixture();
  await vi.advanceTimersByTimeAsync(9000);
  expect(scroll).toHaveBeenCalled();
  expect(box.style.visibility).toBe("");
  expect(save).not.toHaveBeenCalled();
});
it("bottom records leave native scrolling alone", async () => {
  const save = vi.fn();
  stop = rememberScroll("one", { load: async () => ({ atBottom: true, messageSeq: null, offset: 0 }), save }, () => true);
  await vi.advanceTimersByTimeAsync(1000);
  expect(box.scrollTop).toBe(1600);
  expect(save).toHaveBeenCalledWith({ atBottom: true, messageSeq: null, offset: 0 });
});
it("a late load after disposal never hides or scrolls the next route", async () => {
  let resolve!: (value: typeof saved) => void;
  fixture(() => new Promise(r => { resolve = r; }));
  stop!(); stop = undefined;
  resolve(saved);
  await vi.advanceTimersByTimeAsync(1600);
  expect(box.style.visibility).toBe("");
  expect(box.scrollTop).toBe(1600);
});

it("asks the native message route once for an older unloaded anchor", async () => {
  anchor.dataset.notificationMessage = "99";
  const loadAnchor = vi.fn();
  stop = rememberScroll("one", { load: async () => saved, save: vi.fn(), loadAnchor }, () => true);
  await vi.advanceTimersByTimeAsync(1000);
  expect(loadAnchor).toHaveBeenCalledExactlyOnceWith(42);
  anchor.dataset.notificationMessage = "42";
  await vi.advanceTimersByTimeAsync(1800);
  expect(box.style.visibility).toBe("");
  expect(box.scrollTop).toBe(530);
});

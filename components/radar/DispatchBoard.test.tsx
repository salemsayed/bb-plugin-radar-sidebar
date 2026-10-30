// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { BotsView, LONG_PRESS_MS } from "./BotsView";
import { botTasksSchema } from "@/lib/botTasks";
import { makeBot, makeOutput, makeTask, BOT_SEEDS } from "./botTasksFixtures";
import { NOW } from "./fixtures";
import { dispatchSection } from "./DispatchBoard";

vi.mock("./useDispatchWorkers", () => ({ useDispatchWorkers: () => ({ byTask: {}, byBot: {}, known: new Set() }) }));
afterEach(() => { cleanup(); vi.useRealTimers(); });
function data() { return botTasksSchema.parse(makeOutput([
  makeBot(BOT_SEEDS[0], [makeTask("erbareeq", "Sales", "working")]),
  makeBot(BOT_SEEDS[1], [makeTask("bricks", "Connect phone?", "needs")]),
  makeBot(BOT_SEEDS[3], [makeTask("home", "Camera", "offline", { line: "Host offline" })]),
  makeBot(BOT_SEEDS[4], []),
])); }
function props(d = data()) { return { state: { data: d, status: "ready" as const, cached: false }, activeThreadId: null, isCompactViewport: true, now: NOW, onOpen: vi.fn(), onShowThreads: vi.fn() }; }
it("groups each bot once and never calls task counts workers", () => {
  render(<BotsView {...props()} />);
  expect(screen.getByRole("region", { name: "Needs attention" })).toBeTruthy();
  expect(document.querySelectorAll(".dispatch-row")).toHaveLength(4);
  expect(document.querySelector(".dispatch-tally")?.textContent).toBe("1 needs you · 1 blocked");
  expect(document.querySelector(".dispatch")?.textContent).not.toContain("workers");
  expect(dispatchSection(data().bots[3], 0)).toBe("On call");
});
it("separates row chat from work, closes on escape and backdrop and restores focus", () => {
  const p = props(); render(<BotsView {...p} />);
  fireEvent.click(screen.getByRole("button", { name: "Open Bricks Bot chat" }));
  expect(p.onOpen).toHaveBeenCalledExactlyOnceWith("thr_coord_bricks");
  const work = screen.getByRole("button", { name: "Show Bricks's work" }); work.focus(); fireEvent.click(work);
  expect(screen.getByRole("dialog").textContent).toContain("Connect phone?");
  expect(p.onOpen).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull(); expect(document.activeElement).toBe(work);
  fireEvent.click(work); fireEvent.click(document.querySelector(".dispatch-overlay")!);
  expect(screen.queryByRole("dialog")).toBeNull();
});
it("freezes section membership through a press and releases after pointerup", async () => {
  const p = props(); const view = render(<BotsView {...p} />);
  fireEvent.pointerDown(screen.getByRole("button", { name: "Open ERBareeq Bot chat" }), { pointerType: "touch" });
  const changed = structuredClone(p.state.data); changed.bots[0].tasks[0].displayState = "needs";
  view.rerender(<BotsView {...props(changed)} />);
  expect(within(screen.getByRole("region", { name: "In motion" })).getByRole("button", { name: "Open ERBareeq Bot chat" })).toBeTruthy();
  fireEvent.pointerUp(window);
  await waitFor(() => expect(screen.queryByRole("region", { name: "In motion" })).toBeNull());
});
it("holds for 650ms, suppresses the release click and supports the menu key", () => {
  vi.useFakeTimers(); const p = props(); render(<BotsView {...p} />);
  const row = screen.getByRole("button", { name: "Open Bricks Bot chat" }).parentElement!;
  const menu = vi.fn(); row.addEventListener("contextmenu", menu);
  fireEvent.pointerDown(row, { pointerType: "touch", clientX: 5, clientY: 5 });
  act(() => vi.advanceTimersByTime(649)); expect(menu).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(1)); expect(LONG_PRESS_MS).toBe(650); expect(menu).toHaveBeenCalledTimes(1);
  fireEvent.pointerUp(row); fireEvent.click(screen.getByRole("button", { name: "Open Bricks Bot chat" })); expect(p.onOpen).not.toHaveBeenCalled();
  fireEvent.keyDown(row, { key: "ContextMenu" }); expect(menu).toHaveBeenCalledTimes(2);
});
it("disables the only state cue under reduced motion", () => {
  const css = readFileSync("styles/dispatch.css", "utf8");
  expect(css).toContain("prefers-reduced-motion: reduce");
  expect(css).toContain("animation: none!important");
  expect(css).not.toContain("infinite");
});
it("shows one cue when a bot changes section", () => {
  vi.useFakeTimers(); const p = props(); const view = render(<BotsView {...p} />);
  expect(document.querySelector(".dispatch-cue")).toBeNull();
  const changed = structuredClone(p.state.data); changed.bots[0].tasks[0].displayState = "needs";
  view.rerender(<BotsView {...props(changed)} />);
  expect(document.querySelectorAll(".dispatch-cue")).toHaveLength(1);
  act(() => vi.advanceTimersByTime(551));
  expect(document.querySelector(".dispatch-cue")).toBeNull();
});

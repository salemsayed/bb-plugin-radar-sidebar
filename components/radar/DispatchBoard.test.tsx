// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { BotsView, LONG_PRESS_MS } from "./BotsView";
import { botTasksSchema } from "@/lib/botTasks";
import { makeBot, makeOutput, makeTask, BOT_SEEDS } from "./botTasksFixtures";
import { NOW } from "./fixtures";
import { dispatchSection, nextStep } from "./DispatchBoard";

const workers = vi.hoisted(() => ({ byBot: {} as Record<string, unknown[]>, byTask: {} as Record<string, unknown[]>, known: new Set<string>() }));
vi.mock("./useDispatchWorkers", () => ({ useDispatchWorkers: () => ({ byTask: { navtask: [{ threadId: "worker", title: "Test worker", model: "Sol", state: "running", startedAt: null }], ...workers.byTask }, byBot: workers.byBot, known: workers.known }) }));
afterEach(() => { cleanup(); vi.useRealTimers(); workers.byBot = {}; workers.byTask = {}; workers.known = new Set(); });
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
it("holds for 700ms, suppresses the release click and supports the menu key", () => {
  vi.useFakeTimers(); const p = props(); render(<BotsView {...p} />);
  const row = screen.getByRole("button", { name: "Open Bricks Bot chat" }).parentElement!;
  const menu = vi.fn(); row.addEventListener("contextmenu", menu);
  fireEvent.pointerDown(row, { pointerType: "touch", clientX: 5, clientY: 5 });
  act(() => vi.advanceTimersByTime(699)); expect(menu).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(1)); expect(LONG_PRESS_MS).toBe(700); expect(menu).toHaveBeenCalledTimes(1);
  fireEvent.pointerUp(row); fireEvent.click(screen.getByRole("button", { name: "Open Bricks Bot chat" })); expect(p.onOpen).not.toHaveBeenCalled();
  fireEvent.keyDown(row, { key: "ContextMenu" }); expect(menu).toHaveBeenCalledTimes(2);
  act(() => vi.advanceTimersByTime(601));
  fireEvent.click(screen.getByRole("button", { name: "Open Bricks Bot chat" }));
  expect(p.onOpen).toHaveBeenCalledOnce();
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
it.each(["Chat", "Task", "Worker", "Question", "Answer", "Answer fallback", "Unlinked", "Recent"])("closes and restores focus before %s navigation", path => {
  const d = data();
  d.bots[1].tasks[0].id = "navtask";
  d.bots[1].tasks[0].conversationThreadId = "task-thread";
  d.bots[1].tasks[0].needs = { threadId: "ask-thread", interactionId: "ask", question: "Allow deploy?", options: ["Yes"] };
  d.bots[1].unlinked = [{ threadId: "unlinked", title: "Unlinked job" }];
  d.bots[1].tasks.push({ ...d.bots[1].tasks[0], id: "history", title: "Completed job", displayState: "done", needs: undefined, conversationThreadId: "history-thread" });
  let work: HTMLElement;
  const check = vi.fn(() => {
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(work);
    expect(document.body.style.overflow).not.toBe("hidden");
  });
  const p = { ...props(d), onOpen: check, onReply: path === "Answer fallback" ? undefined : check };
  render(<BotsView {...p} deskMenu={({ children, onOpenChat }) => <div>{children}<button onClick={onOpenChat}>Menu chat</button></div>} />);
  work = screen.getByRole("button", { name: "Show Bricks's work" }); work.focus(); fireEvent.click(work);
  expect(document.body.style.overflow).toBe("hidden");
  const dialog = screen.getByRole("dialog");
  const names: Record<string, string | RegExp> = { Chat: "Chat", Task: /^Connect phone\?Needs you/, Worker: "Open worker Test worker", Question: "“Allow deploy?”", Answer: "Yes", "Answer fallback": "Yes", Unlinked: /Unlinked job/, Recent: /Completed job/, "Menu chat": "Menu chat" };
  fireEvent.click(within(dialog).getByRole("button", { name: names[path] }));
  expect(check).toHaveBeenCalledOnce();
  const targets: Record<string, string> = { Chat: "thr_coord_bricks", Task: "task-thread", Worker: "worker", Question: "ask-thread", Answer: "ask-thread", "Answer fallback": "ask-thread", Unlinked: "unlinked", Recent: "history-thread", "Menu chat": "thr_coord_bricks" };
  expect(check.mock.calls[0]).toEqual(path === "Answer" ? [targets[path], "Yes"] : [targets[path]]);
});
it("a menu pick lets the next touch tap start fresh before the swallow timeout", () => {
  vi.useFakeTimers(); const p = props();
  render(<BotsView {...p} deskMenu={({ children }) => <div>{children}<button>Rename</button></div>} />);
  const chat = screen.getByRole("button", { name: "Open Bricks Bot chat" });
  fireEvent.pointerDown(chat, { pointerType: "touch" });
  act(() => vi.advanceTimersByTime(700));
  fireEvent.pointerUp(chat); fireEvent.click(chat);
  expect(p.onOpen).not.toHaveBeenCalled();
  fireEvent.click(screen.getAllByRole("button", { name: "Rename" })[1]);
  fireEvent.pointerDown(chat, { pointerType: "touch" }); fireEvent.pointerUp(chat); fireEvent.click(chat);
  expect(p.onOpen).toHaveBeenCalledExactlyOnceWith("thr_coord_bricks");
});
it("takes Android native contextmenu once and swallows its release click", () => {
  vi.useFakeTimers(); const p = props();
  const menu = vi.fn();
  render(<div onContextMenu={menu}><BotsView {...p} /></div>);
  const chat = screen.getByRole("button", { name: "Open Bricks Bot chat" });
  fireEvent.pointerDown(chat, { pointerType: "touch" });
  fireEvent.contextMenu(chat);
  act(() => vi.advanceTimersByTime(700));
  fireEvent.contextMenu(chat);
  expect(menu).toHaveBeenCalledOnce();
  fireEvent.pointerUp(chat); fireEvent.click(chat);
  expect(p.onOpen).not.toHaveBeenCalled();
  fireEvent.pointerDown(chat, { pointerType: "touch" }); fireEvent.pointerUp(chat); fireEvent.click(chat);
  expect(p.onOpen).toHaveBeenCalledOnce();
});
it("says just now for a recent completion and restores scroll lock on unmount", () => {
  const d = data(); d.bots[3].tasks.push({ ...d.bots[0].tasks[0], displayState: "done", completedAt: NOW });
  const view = render(<BotsView {...props(d)} />);
  expect(screen.getByText("Idle · done just now")).toBeTruthy();
  document.body.style.overflow = "auto";
  fireEvent.click(screen.getByRole("button", { name: "Show Personal's work" }));
  expect(screen.getByText("Nothing running · last completed just now")).toBeTruthy();
  expect(document.body.style.overflow).toBe("hidden");
  view.unmount(); expect(document.body.style.overflow).toBe("auto");
  document.body.style.overflow = "";
});
it.each(["More", "right click", "hold", "menu key"])("closes the sheet before opening the persistent row menu via %s", path => {
  vi.useFakeTimers();
  const menu = vi.fn(() => {
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(work);
  });
  const p = props();
  render(<BotsView {...p} deskMenu={({ children }) => <div onContextMenu={menu}>{children}</div>} />);
  const work = screen.getByRole("button", { name: "Show Bricks's work" });
  work.focus(); fireEvent.click(work);
  const more = within(screen.getByRole("dialog")).getByRole("button", { name: "More" });
  if (path === "More") fireEvent.click(more);
  if (path === "right click") fireEvent.contextMenu(more);
  if (path === "menu key") fireEvent.keyDown(more, { key: "ContextMenu" });
  if (path === "hold") {
    fireEvent.pointerDown(more, { pointerType: "touch", clientX: 30, clientY: 30 });
    act(() => vi.advanceTimersByTime(700));
    fireEvent.pointerUp(more); fireEvent.click(more);
  }
  expect(menu).toHaveBeenCalledOnce();
  expect(p.onOpen).not.toHaveBeenCalled();
});
function homeWith(...tasks: ReturnType<typeof makeTask>[]) {
  return botTasksSchema.parse(makeOutput([makeBot(BOT_SEEDS[0], [makeTask("erbareeq", "Sales", "working")]), makeBot(BOT_SEEDS[3], tasks)]));
}
function homeRow() { return document.querySelector<HTMLElement>('.dispatch-row[data-bot="home"]')!; }
function sectionOf(key: string) { return document.querySelector(`.dispatch-row[data-bot="${key}"]`)!.closest("section")!.getAttribute("aria-label"); }
it("puts a bot waiting on a timed check under On call with its next step", () => {
  const wakeAt = NOW + 26 * 3_600_000;
  const d = homeWith(makeTask("home", "Nursery camera", "waiting", { id: "wait", waitFor: "the bot", wakeAt }));
  render(<BotsView {...props(d)} />);
  const when = `${new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(wakeAt)} ${new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(wakeAt)}`;
  expect(sectionOf("home")).toBe("On call");
  expect(homeRow().className).toContain("dispatch-idle");
  expect(homeRow().className).toContain("dispatch-compact");
  expect(homeRow().querySelector(".dispatch-sub")!.textContent).toBe(`Waiting · checks ${when}`);
  expect(homeRow().textContent).not.toContain("Nursery camera");
  expect(homeRow().querySelector(".dispatch-number")!.textContent).toBe("");
  fireEvent.click(screen.getByRole("button", { name: "Show Home's work" }));
  expect(screen.getByRole("dialog").textContent).toContain("Nursery camera");
});
it("drops the weekday for a check later today", () => {
  const today = new Date(NOW); today.setHours(23, 30, 0, 0);
  const d = homeWith(makeTask("home", "Camera", "waiting", { wakeAt: Math.max(today.getTime(), NOW + 60_000) }));
  const line = nextStep(d.bots[1], NOW);
  if (new Date(NOW).getHours() < 23) expect(line).toMatch(/^Waiting · checks \d\d:\d\d$/);
});
it("puts a waiting bot with a running worker under In motion", () => {
  const d = homeWith(makeTask("home", "Nursery camera", "waiting", { id: "wait", wakeAt: NOW + 3_600_000 }));
  const attempt = { threadId: "w1", title: "Worker", model: "codex/gpt-6.1-sol", effort: null, state: "running", startedAt: NOW - 5 * 60_000, endedAt: null, latest: true };
  workers.byBot = { home: [attempt], erbareeq: [] }; workers.byTask = { wait: [attempt] }; workers.known = new Set(["home", "erbareeq"]);
  render(<BotsView {...props(d)} />);
  expect(sectionOf("home")).toBe("In motion");
  expect(homeRow().className).toContain("dispatch-busy");
  expect(homeRow().textContent).toContain("Nursery camera");
  expect(homeRow().textContent).toContain("Sol");
  expect(homeRow().querySelector(".dispatch-number")!.textContent).toBe("1");
  expect(dispatchSection(d.bots[1], 0)).toBe("On call");
  expect(dispatchSection(d.bots[1], 0, 1)).toBe("In motion");
});
it.each([["working", "In motion"], ["queued", "In motion"], ["retrying", "Needs attention"], ["ready", "On call"], ["checking", "On call"]] as const)("a bot whose only task is %s goes to %s", (state, section) => {
  const d = homeWith(makeTask("home", "Camera", state));
  expect(dispatchSection(d.bots[1], 0)).toBe(section);
  render(<BotsView {...props(d)} />);
  expect(sectionOf("home")).toBe(section);
  if (section === "On call") expect(homeRow().querySelector(".dispatch-sub")!.textContent).toBe(state === "ready" ? "Not started" : "To check");
});
it("counts the rest of an on-call bot's open tasks", () => {
  const d = homeWith(makeTask("home", "A", "waiting"), makeTask("home", "B", "ready"), makeTask("home", "C", "checking"), makeTask("home", "D", "done", { completedAt: NOW }));
  render(<BotsView {...props(d)} />);
  expect(sectionOf("home")).toBe("On call");
  expect(homeRow().querySelector(".dispatch-sub")!.textContent).toBe("To check · +2 more");
});

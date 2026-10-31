// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { BotsView, LONG_PRESS_MS } from "./BotsView";
import { botTasksSchema } from "@/lib/botTasks";
import { makeBot, makeOutput, makeTask, BOT_SEEDS } from "./botTasksFixtures";
import { NOW } from "./fixtures";
import { checksLine, dispatchSection, nextStep, panelSummary } from "./DispatchBoard";
import { clearsLine } from "./BotsView";

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
  const work = screen.getByRole("button", { name: "Show Bricks's work, 1 ask" }); work.focus(); fireEvent.click(work);
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
  work = screen.getByRole("button", { name: "Show Bricks's work, 1 ask" }); work.focus(); fireEvent.click(work);
  expect(document.body.style.overflow).toBe("hidden");
  const dialog = screen.getByRole("dialog");
  const names: Record<string, string | RegExp> = { Chat: "Chat", Task: /^Connect phone\?Needs you/, Worker: "Open worker Test worker: Sol worker, running", Question: "“Allow deploy?”", Answer: "Yes", "Answer fallback": "Yes", Unlinked: /Unlinked job/, Recent: /Completed job/, "Menu chat": "Menu chat" };
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
  const work = screen.getByRole("button", { name: "Show Bricks's work, 1 ask" });
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
  expect(sectionOf("home")).toBe("On call");
  expect(homeRow().className).toContain("dispatch-idle");
  expect(homeRow().className).toContain("dispatch-compact");
  expect(homeRow().querySelector(".dispatch-sub")!.textContent).toBe(`Waiting · ${checksLine(wakeAt, NOW)}`);
  expect(homeRow().textContent).not.toContain("Nursery camera");
  expect(homeRow().querySelector(".dispatch-number")).toBeNull(); expect(homeRow().querySelector(".dispatch-chevron")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Show Home's work" }));
  expect(screen.getByRole("dialog").textContent).toContain("Nursery camera");
});
const at = (day: number, hours: number, minutes = 0) => new Date(2026, 9, day, hours, minutes).getTime();
const clock = (ms: number) => new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(ms);
const weekday = (ms: number) => new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(ms);
const step = (wakeAt: number, now: number) => nextStep(homeWith(makeTask("home", "Camera", "waiting", { wakeAt })).bots[1], now);
it("drops the weekday for a check later today", () => {
  expect(step(at(31, 23, 30), at(31, 14))).toBe(`Waiting · checks ${clock(at(31, 23, 30))}`);
});
it("names the weekday across midnight and the date from a week out", () => {
  expect(step(at(32, 0, 10), at(31, 23, 50))).toBe(`Waiting · checks tomorrow ${clock(at(32, 0, 10))}`);
  expect(step(at(33, 0, 10), at(31, 23, 50))).toBe(`Waiting · checks ${weekday(at(33, 0, 10))} ${clock(at(33, 0, 10))}`);
  expect(step(at(37, 19, 13), at(31, 14))).toBe(`Waiting · checks ${weekday(at(37, 19, 13))} ${clock(at(37, 19, 13))}`);
  const week = at(38, 19, 13);
  expect(step(week, at(31, 14))).toBe(`Waiting · checks ${new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(week)} ${clock(week)}`);
  expect(checksLine(week, at(31, 14))).not.toContain(weekday(week));
});
it("says overdue for a check whose time has passed, as the Bots view does", () => {
  expect(step(at(31, 9), at(31, 10))).toBe(`Waiting · overdue since ${clock(at(31, 9))}`);
  expect(step(at(24, 9), at(31, 10))).toBe(`Waiting · ${clearsLine(at(24, 9), at(31, 10))}`);
  expect(step(at(24, 9), at(31, 10))).toMatch(/^Waiting · overdue since /);
});
it("does not cue bots the first worker snapshot moves, but cues a real change beside it", () => {
  vi.useFakeTimers();
  const d = homeWith(makeTask("home", "Camera", "waiting", { id: "wait" }));
  const view = render(<BotsView {...props(d)} />);
  const attempt = { threadId: "w1", title: "Worker", model: "Sol", effort: null, state: "running", startedAt: NOW, endedAt: null, latest: true };
  workers.byBot = { home: [attempt], erbareeq: [] }; workers.byTask = { wait: [attempt] }; workers.known = new Set(["home", "erbareeq"]);
  const changed = structuredClone(d); changed.bots[0].tasks[0].displayState = "needs";
  view.rerender(<BotsView {...props(changed)} />);
  expect(sectionOf("home")).toBe("In motion");
  expect(Array.from(document.querySelectorAll(".dispatch-cue")).map(cue => cue.closest(".dispatch-row")!.getAttribute("data-bot"))).toEqual(["erbareeq"]);
  act(() => vi.advanceTimersByTime(551));
  workers.byBot = { home: [], erbareeq: [] }; workers.byTask = {};
  view.rerender(<BotsView {...props(structuredClone(changed))} />);
  expect(sectionOf("home")).toBe("On call");
  expect(Array.from(document.querySelectorAll(".dispatch-cue")).map(cue => cue.closest(".dispatch-row")!.getAttribute("data-bot"))).toEqual(["home"]);
});
it("never takes a row's title from a task only the coordinator is running", () => {
  const d = homeWith(makeTask("home", "Waiting on the camera", "waiting", { id: "wait" }), makeTask("home", "Fix the lights", "working", { id: "lights" }));
  workers.byTask = { wait: [{ threadId: "thr_coord_home", title: "Home Bot", model: null, effort: null, state: "running", startedAt: NOW, endedAt: null, latest: true }] };
  render(<BotsView {...props(d)} />);
  expect(homeRow().querySelector(".dispatch-line")!.textContent).toBe("Fix the lights");
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
it("gives a quiet row a chevron instead of a bare Work label, still opening work and the menu", () => {
  vi.useFakeTimers();
  const menu = vi.fn();
  render(<div onContextMenu={menu}><BotsView {...props()} /></div>);
  const work = screen.getByRole("button", { name: "Show Personal's work" });
  expect(work.textContent).toBe("");
  expect(work.querySelector(".dispatch-chevron")).toBeTruthy();
  expect(document.querySelector(".dispatch")!.textContent).not.toMatch(/\bWork\b(?!'s)/);
  fireEvent.contextMenu(work); expect(menu).toHaveBeenCalledOnce();
  fireEvent.pointerDown(work, { pointerType: "touch", clientX: 5, clientY: 5 });
  act(() => vi.advanceTimersByTime(700)); expect(menu).toHaveBeenCalledTimes(2);
  fireEvent.pointerUp(work); fireEvent.click(work); expect(screen.queryByRole("dialog")).toBeNull();
  act(() => vi.advanceTimersByTime(601));
  fireEvent.click(work); expect(screen.getByRole("dialog", { name: "Personal Bot: work" })).toBeTruthy();
});
it("names the count a work column shows in its accessible label", () => {
  const d = data(); d.bots[2].tasks[0].retryAt = new Date(2026, 9, 31, 14, 5).getTime(); d.bots[2].tasks[0].displayState = "retrying";
  workers.byBot = { erbareeq: [{ threadId: "w", title: "W", model: "Sol", effort: null, state: "running", startedAt: NOW, endedAt: null, latest: true }] }; workers.known = new Set(["erbareeq"]);
  render(<BotsView {...props(d)} />);
  const bricks = screen.getByRole("button", { name: "Show Bricks's work, 1 ask" });
  expect(bricks.textContent).toBe("1ask");
  expect(screen.getByRole("button", { name: "Show ERBareeq's work, 1 worker" }).textContent).toBe("1worker");
  const time = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(d.bots[2].tasks[0].retryAt!);
  expect(screen.getByRole("button", { name: `Show Home's work, retry ${time}` }).textContent).toBe(`${time}retry`);
});
function panelOf(d: ReturnType<typeof homeWith>, now = NOW) {
  render(<BotsView {...props(d)} now={now} />);
  fireEvent.click(screen.getByRole("button", { name: /^Show Home's work/ }));
  return screen.getByRole("dialog");
}
const statusOf = (dialog: HTMLElement, title: string) => within(dialog).getByText(title).closest("button")!.querySelector("span")!.textContent;
it("says Cancelled or Stopped instead of Done · Cancelled, and dates every Recent row", () => {
  const now = new Date(2026, 9, 31, 15, 0).getTime();
  const d = homeWith(
    makeTask("home", "Launcher", "done", { line: "Cancelled", completedAt: new Date(2026, 9, 31, 11, 13).getTime() }),
    makeTask("home", "Second TV", "done", { line: "Done 30 Oct", completedAt: new Date(2026, 9, 30, 17, 5).getTime() }),
    makeTask("home", "Report", "done", { line: "Done 29 Oct", completedAt: new Date(2026, 9, 27, 9, 0).getTime() }),
    makeTask("home", "Halted", "done", { line: "Stopped by Salem · 2 workers halted", completedAt: new Date(2026, 9, 31, 8, 0).getTime() }),
  );
  const dialog = panelOf(d, now);
  const clock = (h: number, m: number) => new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(2026, 9, 31, h, m));
  expect(statusOf(dialog, "Launcher")).toBe(`Cancelled · today ${clock(11, 13)}`);
  expect(statusOf(dialog, "Second TV")).toBe(`Done · yesterday ${clock(17, 5)}`);
  expect(statusOf(dialog, "Report")).toBe(`Done · ${new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(new Date(2026, 9, 27))}`);
  expect(statusOf(dialog, "Halted")).toBe(`Stopped by Salem · today ${clock(8, 0)} · 2 workers halted`);
  expect(dialog.textContent).not.toContain("Done · Cancelled");
  expect(dialog.querySelectorAll(".dispatch-recent .dispatch-task-group")).toHaveLength(4);
});
it("keeps a task's worker inside the task with what it is doing and for how long", () => {
  const wake = new Date(2026, 9, 32, 19, 30).getTime(), now = new Date(2026, 9, 31, 15, 0).getTime();
  const d = homeWith(makeTask("home", "Kitchen TV colour", "waiting", { id: "wait", waitFor: "the bot", wakeAt: wake }), makeTask("home", "Lights", "working", { id: "lights" }));
  workers.byTask = {
    wait: [{ threadId: "idle-worker", title: "Colour worker", model: "codex/gpt-6.1-sol", effort: null, state: "idle", startedAt: now - 3 * 86_400_000, endedAt: now - 2 * 86_400_000, latest: true }],
    lights: [{ threadId: "busy-worker", title: "Lights worker", model: null, effort: null, state: "running", startedAt: now - 5 * 60_000, endedAt: null, latest: true }],
  };
  workers.byBot = { home: [workers.byTask.lights[0]] }; workers.known = new Set(["home"]);
  const dialog = panelOf(d, now);
  const idle = within(dialog).getByRole("button", { name: "Open worker Colour worker: Sol worker, idle 2 d" });
  expect(idle.textContent).toBe("Sol worker · idle 2 d");
  expect(idle.closest(".dispatch-task-group")!.textContent).toContain("Kitchen TV colour");
  expect(within(dialog).getByRole("button", { name: "Open worker Lights worker: Worker, running 5 min" }).textContent).toBe("Worker · running 5 min");
  expect(statusOf(dialog, "Kitchen TV colour")).toBe(`Waiting · ${checksLine(wake, now)}`);
  expect(dialog.querySelector(".dispatch-panel-head p")!.textContent).toBe("1 worker · 1 working · 1 waiting");
});
it("summarises open tasks by state in the panel header", () => {
  const d = homeWith(makeTask("home", "A", "waiting"), makeTask("home", "B", "waiting"), makeTask("home", "C", "checking"), makeTask("home", "D", "done", { completedAt: NOW }));
  expect(panelOf(d).querySelector(".dispatch-panel-head p")!.textContent).toBe("1 to check · 2 waiting");
});
it("clamps long titles and gives More a visible control shape", () => {
  const css = readFileSync("styles/dispatch.css", "utf8");
  expect(css).toMatch(/\.dispatch-task b \{[^}]*-webkit-line-clamp: 3/);
  expect(css).toMatch(/\.dispatch-recent \.dispatch-task b \{[^}]*-webkit-line-clamp: 2/);
  expect(css).toMatch(/\.dispatch-more \{[^}]*border: 1px solid/);
});
it("says tomorrow for a check due the next day, in the row and the panel alike", () => {
  const now = at(31, 14), wakeAt = at(32, 19, 30);
  expect(checksLine(wakeAt, now)).toBe(`checks tomorrow ${clock(wakeAt)}`);
  expect(checksLine(at(33, 19, 30), now)).toBe(`checks ${weekday(at(33, 19, 30))} ${clock(at(33, 19, 30))}`);
  expect(checksLine(at(31, 19, 30), now)).toBe(`checks ${clock(at(31, 19, 30))}`);
  const d = homeWith(makeTask("home", "Kitchen TV", "waiting", { waitFor: "the bot", wakeAt }));
  render(<BotsView {...props(d)} now={now} />);
  expect(homeRow().querySelector(".dispatch-sub")!.textContent).toBe(`Waiting · checks tomorrow ${clock(wakeAt)}`);
  fireEvent.click(screen.getByRole("button", { name: "Show Home's work" }));
  expect(statusOf(screen.getByRole("dialog"), "Kitchen TV")).toBe(`Waiting · checks tomorrow ${clock(wakeAt)}`);
});
it("orders the header counts by state, not by task order", () => {
  const first = homeWith(makeTask("home", "A", "waiting"), makeTask("home", "B", "working"), makeTask("home", "C", "needs"));
  const second = homeWith(makeTask("home", "C", "needs"), makeTask("home", "B", "working"), makeTask("home", "A", "waiting"));
  expect(panelSummary(first.bots[1].tasks, 2, 0)).toBe("2 workers · 1 needs you · 1 working · 1 waiting");
  expect(panelSummary(second.bots[1].tasks, 2, 0)).toBe(panelSummary(first.bots[1].tasks, 2, 0));
});
it("gives the desktop sheet a Close button that restores focus, and keeps the drag bar on phones", () => {
  const p = { ...props(), isCompactViewport: false };
  const view = render(<BotsView {...p} />);
  const work = screen.getByRole("button", { name: "Show Bricks's work, 1 ask" }); work.focus(); fireEvent.click(work);
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).queryByRole("button", { name: "Close work panel" })).toBeNull();
  fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(work);
  view.rerender(<BotsView {...props()} />);
  fireEvent.click(screen.getByRole("button", { name: "Show Bricks's work, 1 ask" }));
  expect(within(screen.getByRole("dialog")).getByRole("button", { name: "Close work panel" })).toBeTruthy();
  expect(within(screen.getByRole("dialog")).queryByRole("button", { name: "Close" })).toBeNull();
});
it("keeps 44 px tap targets on the worker row, the close button and both header pills", () => {
  const css = readFileSync("styles/dispatch.css", "utf8");
  expect(css).toMatch(/\.dispatch-panel \.dispatch-attempt \{[^}]*min-height: 44px/);
  expect(css).toMatch(/button\.dispatch-close \{[^}]*min-width: 44px; min-height: 44px/);
  expect(css).toMatch(/\.dispatch-panel-head button \{[^}]*min-height: 36px/);
  expect(css).toMatch(/\.dispatch-panel-head button::after \{[^}]*inset: -4px 0/);
  expect(css).toMatch(/button\.dispatch-more::after \{[^}]*inset: -5px -1px/);
});

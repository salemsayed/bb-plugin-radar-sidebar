import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { BotsView } from "./BotsView";
import { botTasksSchema } from "@/lib/botTasks";
import { makeBot, makeOutput, makeTask, BOT_SEEDS } from "./botTasksFixtures";
import { NOW } from "./fixtures";

const workers = vi.hoisted(() => ({ byBot: {} as Record<string, unknown[]>, byTask: {} as Record<string, unknown[]>, known: new Set<string>(), chat: new Set<string>() }));
vi.mock("./useDispatchWorkers", () => ({ useDispatchWorkers: () => ({ byTask: workers.byTask, byBot: workers.byBot, known: workers.known, chat: workers.chat }) }));
afterEach(() => { cleanup(); localStorage.clear(); workers.byBot = {}; workers.byTask = {}; workers.known = new Set(); workers.chat = new Set(); });
function data() { return botTasksSchema.parse(makeOutput([
  makeBot(BOT_SEEDS[0], [makeTask("erbareeq", "Sales", "working")]),
  makeBot(BOT_SEEDS[1], [makeTask("bricks", "Connect phone?", "needs")]),
  makeBot(BOT_SEEDS[3], [makeTask("home", "Camera", "offline", { line: "Host offline" })]),
  makeBot(BOT_SEEDS[4], []),
])); }
function props(d = data()) { return { state: { data: d, status: "ready" as const, cached: false }, activeThreadId: null, isCompactViewport: true, now: NOW, onOpen: vi.fn(), onShowThreads: vi.fn() }; }
it("offers all five boards and remembers the chosen one", () => {
  const view = render(<BotsView {...props()} />);
  expect(screen.getByRole("group", { name: "Bots layout" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Current board" }).getAttribute("aria-pressed")).toBe("true");
  fireEvent.click(screen.getByRole("button", { name: "Two-line rows" }));
  expect(document.querySelector(".dispatch-row")!.className).toContain("dispatch-layout-rows");
  expect(document.querySelector(".dispatch-number")).toBeNull();
  expect(localStorage.getItem("radar-sidebar:bots-layout:v1")).toBe("rows");
  view.unmount();
  render(<BotsView {...props()} />);
  expect(screen.getByRole("button", { name: "Two-line rows" }).getAttribute("aria-pressed")).toBe("true");
});
it("puts a question first", () => {
  render(<BotsView {...props()} />);
  fireEvent.click(screen.getByRole("button", { name: "Needs first" }));
  const lane = screen.getByRole("region", { name: "Needs you" });
  const row = within(lane).getByRole("button", { name: /^Open Bricks Bot chat/ });
  expect(row.querySelector(".dispatch-line")!.textContent).toBe("Connect phone?");
});
it("lists one ledger line per worker and opens that worker", () => {
  const bots = data();
  const id = bots.bots[0].tasks[0].id;
  const first = { threadId: "thr_first", title: "First job", model: "Sol", effort: null, state: "running", startedAt: NOW - 120_000, endedAt: null, latest: true };
  const second = { threadId: "thr_second", title: "Second job", model: "Terra", effort: null, state: "running", startedAt: NOW - 60_000, endedAt: null, latest: true };
  workers.byBot = { erbareeq: [first, second] }; workers.byTask = { [id]: [first, second] }; workers.known = new Set(["erbareeq"]);
  const p = props(bots);
  render(<BotsView {...p} />);
  fireEvent.click(screen.getByRole("button", { name: "Worker ledger" }));
  expect(document.querySelectorAll(".dispatch-ledger-bot")).toHaveLength(2);
  fireEvent.click(within(screen.getByRole("region", { name: "In motion" })).getByRole("button", { name: /^First job/ }));
  expect(p.onOpen).toHaveBeenCalledWith("thr_first");
  expect(screen.getByRole("button", { name: /^Second job/ })).toBeTruthy();
});
it("unfolds a bot's tasks in place and opens all work", () => {
  render(<BotsView {...props()} />);
  fireEvent.click(screen.getByRole("button", { name: "Unfold in place" }));
  const toggle = screen.getByRole("button", { name: "Show ERBareeq's tasks" });
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(toggle);
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(document.querySelector(".dispatch-unfolded")!.textContent).toContain("Sales");
  fireEvent.click(screen.getByRole("button", { name: "All work" }));
  expect(screen.getByRole("dialog")).toBeTruthy();
});
it("opens an unfolded task's own conversation, not the bot chat", () => {
  const bots = data();
  bots.bots[0].tasks[0].conversationThreadId = "thr_task_sales";
  const p = props(bots);
  render(<BotsView {...p} />);
  fireEvent.click(screen.getByRole("button", { name: "Unfold in place" }));
  fireEvent.click(screen.getByRole("button", { name: "Show ERBareeq's tasks" }));
  fireEvent.click(document.querySelector(".dispatch-unfolded-row")!);
  expect(p.onOpen).toHaveBeenCalledWith("thr_task_sales");
});

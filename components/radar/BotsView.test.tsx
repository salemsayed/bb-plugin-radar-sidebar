// @vitest-environment jsdom
import { resetBotsPush } from "@/lib/botsPush";
import { answerOptions, botMood, botTasksSchema, needRows } from "@/lib/botTasks";
import { NEEDS_CHANGED } from "@/lib/needsClient";
import type { BotTasksOutput } from "@/lib/tasks-v2-types";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BotsView, moodFace, rowDetail, waitingLine } from "./BotsView";
import { attemptThreads, makeTask, normalDay, taskDetails, tenDecisions } from "./botTasksFixtures";
import { NOW, makeThread } from "./fixtures";
import { LIST_MODE_KEY } from "./ListModeSwitch";
import { recordedActions, threadActionsFixture } from "./threadActions.fixtures";

const app = await loadPluginApp(() => import("../../app"));
const threadList = app.threadLists[0]!;

const roster = [
  { key: "bricks", name: "Bricks Bot", current: "thr_coord_bricks", projectId: "proj_bricks", projects: [], hostId: "h", providerId: "p", model: "m", rollover: null },
];
const threads: PluginSidebarThread[] = [
  makeThread({ id: "thr_coord_bricks", projectId: "proj_bricks", title: "Bricks Bot" }),
  makeThread({ id: "bricks_worker", projectId: "proj_bricks", parentThreadId: "thr_coord_bricks", title: "Bricks worker" }),
  makeThread({ id: "plain", projectId: "proj_a", title: "Plain thread" }),
];

type Tasks = BotTasksOutput | (() => BotTasksOutput | Promise<BotTasksOutput>) | Error;

function renderList(tasks: Tasks, options: { settings?: Record<string, boolean>; compact?: boolean; activeThreadId?: string | null; onNavigate?: () => void; detail?: "missing" | "error"; composerThread?: string } = {}) {
  const calls: string[] = [];
  const callRpc = vi.fn(async ({ method, input }: { method: string; input?: unknown }) => {
    calls.push(method);
    if (method === "bot_roster") return { bots: roster };
    if (method === "bot_tasks") {
      if (tasks instanceof Error) throw tasks;
      return typeof tasks === "function" ? tasks() : tasks;
    }
    if (method === "task_detail" && options.detail === "error") throw new Error("HTTP 500: task_detail failed");
    if (method === "task_detail" && !options.detail) {
      const found = taskDetails()[(input as { taskId: string }).taskId];
      if (!found) throw new Error("Task not found");
      return found;
    }
    throw new Error(`plugin "orchestrator-mode" has no rpc method "${method}"`);
  });
  const sdk: Record<string, unknown> = {
    threads: {
      // Worker threads behind the attempts list answer by id; nothing else is listed.
      list: async (query?: { threadIds?: readonly string[] }) => query?.threadIds ? attemptThreads().filter(thread => query.threadIds!.includes(thread.id)) : [],
      defaultExecutionOptions: async () => null, context: async () => ({ usage: null }),
      markRead: async () => ({ ok: true }), output: async () => ({ output: null }),
    },
    providers: { models: async () => ({ models: [] }) },
    system: { uiPreferences: { list: async () => ({ preferences: {} }), set: async () => ({ revision: 1, value: [] }) } },
    plugins: { callRpc },
  };
  const actions = threadActionsFixture();
  const slot = actions.capture(renderSlot(threadList, {
    activeThreadId: options.activeThreadId ?? null, activeProjectId: "proj_a", isCompactViewport: options.compact ?? false,
    onNavigate: options.onNavigate ?? (() => {}), searchQuery: "",
  }, {
    sdk, threadActions: actions.threadActions,
    ...(options.composerThread ? { composer: { scope: { kind: "thread", threadId: options.composerThread } } } : {}),
    settings: { botsSwitch: true, hoverCard: false, ...options.settings },
    rpc: { crew_needs_list: () => ({ items: [] }), crew_asks: () => ({ judgements: [] }) },
    sidebarThreads: { status: "ready", threads, projects: [], sections: [], experimental_archived: null },
  }));
  return { slot, callRpc, calls };
}

const rowIds = (container: HTMLElement) => Array.from(container.querySelectorAll("[data-sidebar-thread-id]")).map(node => node.getAttribute("data-sidebar-thread-id"));
const opened = (slot: ReturnType<typeof renderList>["slot"]) => recordedActions(slot).filter(call => call.method === "open").map(call => call.threadId);

beforeEach(() => {
  // Only the clock is fixed, so "Done today" means the fixtures' day; timers and promises stay real.
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  resetBotsPush();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("botsSwitch off (the default)", () => {
  it("renders the list exactly as before: no switch and no bot_tasks read", async () => {
    const { slot, calls } = renderList(normalDay(), { settings: { botsSwitch: false } });
    await waitFor(() => expect(rowIds(slot.container)).toContain("plain"));
    expect(screen.queryByRole("group", { name: "Show bots or threads" })).toBeNull();
    expect(slot.container.querySelector(".radar-list-shell")).toBeNull();
    expect(calls).not.toContain("bot_tasks");
  });

  it("still tucks bot families away when the Bots page owns them", async () => {
    const { slot } = renderList(normalDay(), { settings: { botsSwitch: false, botsPage: true } });
    await waitFor(() => expect(rowIds(slot.container)).toEqual(["plain"]));
  });
});

describe("Bots | Threads switch", () => {
  it("opens on Bots without a duplicate notification count, and remembers Threads per device", async () => {
    const { slot } = renderList(normalDay());
    const bots = await screen.findByRole("button", { name: "Bots" });
    expect(bots.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Threads" }));
    expect(localStorage.getItem(LIST_MODE_KEY)).toBe("threads");
    await waitFor(() => expect(rowIds(slot.container)).toContain("plain"));
    // Switching never navigates: the open thread stays open.
    expect(opened(slot)).toEqual([]);
    cleanup();
    renderList(normalDay());
    expect((await screen.findByRole("button", { name: "Threads" })).getAttribute("aria-pressed")).toBe("true");
  });

  it("leaves bot chats and workers out of Threads while the Bots page owns them (Salem, 2026-10-29: pinned bot chats in Threads)", async () => {
    localStorage.setItem(LIST_MODE_KEY, "threads");
    const { slot } = renderList(normalDay(), { settings: { botsPage: true } });
    await waitFor(() => expect(rowIds(slot.container)).toEqual(["plain"]));
  });

  it("shows every thread in Threads, bot chats and workers included, with botsPage off", async () => {
    localStorage.setItem(LIST_MODE_KEY, "threads");
    const { slot } = renderList(normalDay(), { settings: { botsPage: false } });
    await waitFor(() => expect(rowIds(slot.container).sort()).toEqual(["bricks_worker", "plain", "thr_coord_bricks"]));
  });

  it("keeps the open thread highlighted across the switch", async () => {
    renderList(normalDay(), { activeThreadId: "thr_coord_bricks" });
    const row = await screen.findByRole("button", { name: "Open Bricks Bot chat" });
    expect(row.getAttribute("aria-current")).toBe("page");
    fireEvent.click(screen.getByRole("button", { name: "Threads" }));
    fireEvent.click(screen.getByRole("button", { name: /^Bots/ }));
    expect((await screen.findByRole("button", { name: "Open Bricks Bot chat" })).getAttribute("aria-current")).toBe("page");
  });

  it("works in the phone drawer with 40px+ controls", async () => {
    const { slot } = renderList(normalDay(), { compact: true });
    await screen.findByRole("button", { name: "Bots" });
    expect(slot.container.querySelector(".radar-list-shell.radar-list-compact")).toBeTruthy();
  });
});

describe("Bots view v4, the crew board (Salem, thr_2gjivwx8ea seq 1671: total redesign)", () => {

  it("cleans up a bot's suggested answers the same way on every path", () => {
    expect(answerOptions([" Yes ", "", "Yes", "Not yet", "Later", "Never"])).toEqual(["Yes", "Not yet", "Later"]);
    expect(answerOptions(undefined)).toEqual([]);
    const day = normalDay();
    // A needs task the server listed without an interaction still gets clean answers.
    day.needs = day.needs.filter(item => item.taskId !== "t_brk42");
    day.bots[1]!.tasks.find(task => task.id === "t_brk42")!.needs!.options = ["  Open it ", "Open it", ""];
    expect(needRows(botTasksSchema.parse(day)).find(row => row.taskId === "t_brk42")!.options).toEqual(["Open it"]);
  });

  it("offers a task's answers only on its own pending interaction", () => {
    const day = normalDay();
    expect(needRows(botTasksSchema.parse(day))[0]!.options).toEqual(["Yes", "Not yet"]);
    day.needs[0]!.interactionId = "int_other";
    expect(needRows(botTasksSchema.parse(day))[0]!.options).toEqual([]);
  });
});

describe("Bots view: dates and waits", () => {

  it("shows what a waiting task waits for, not only whom", () => {
    expect(waitingLine({ line: "Waiting for the bot: Kitchen TV standby wakes with Wake on Wi-Fi off · wakes 09:00", waitFor: "the bot" }))
      .toBe("Kitchen TV standby wakes with Wake on Wi-Fi off · wakes 09:00");
    expect(waitingLine({ line: "Waiting for Mohamed Omar: the reconciliation file · no wake set", waitFor: "Mohamed Omar" }))
      .toBe("Mohamed Omar: the reconciliation file · no wake set");
    expect(waitingLine({ line: "", waitFor: "Islam" })).toBe("Waiting for Islam");
    expect(waitingLine({ line: "", waitFor: undefined })).toBe("Waiting");
    expect(waitingLine({ line: "Blocked until the host returns", waitFor: "the bot" })).toBe("Blocked until the host returns");
  });

  it("picks the mood from the most urgent open state, with work without a task counting as working", () => {
    expect(botMood([makeTask("x", "a", "waiting"), makeTask("x", "b", "working"), makeTask("x", "c", "offline")])).toBe("offline");
    expect(botMood([makeTask("x", "a", "waiting"), makeTask("x", "b", "retrying")])).toBe("working");
    expect(botMood([makeTask("x", "a", "done", { completedAt: NOW })], 1)).toBe("working");
    expect(botMood([makeTask("x", "a", "done", { completedAt: NOW })])).toBe("quiet");
    expect(botMood([makeTask("x", "a", "checking"), makeTask("x", "b", "queued")])).toBe("checking");
    expect(moodFace("needs")).toBe("needs-you");
    expect(moodFace("overdue")).toBe("failed");
    expect(moodFace("offline")).toBe("unavailable");
    expect(moodFace("waiting")).toBeUndefined();
  });

  it("writes a row's detail without repeating its state", () => {
    expect(rowDetail(makeTask("x", "a", "queued", { line: "Queued: no capacity" }), NOW)).toBe("no capacity");
    expect(rowDetail(makeTask("x", "a", "working", { line: "" }), NOW)).toBe("");
    expect(rowDetail(makeTask("x", "a", "waiting", { waitFor: "Islam" }), NOW)).toBe("Islam");
    expect(rowDetail(makeTask("x", "a", "waiting", {}), NOW)).toBe("");
    expect(rowDetail(makeTask("x", "a", "done", { line: "Done 2026-10-28", completedAt: NOW }), NOW)).toBe("");
    expect(rowDetail(makeTask("x", "a", "done", { line: "Done 2026-10-28 · 62 lines matched", completedAt: NOW }), NOW)).toBe("62 lines matched");
    expect(rowDetail(makeTask("x", "a", "done", { line: "62 lines matched", completedAt: NOW }), NOW)).toBe("62 lines matched");
    expect(rowDetail(makeTask("x", "a", "done", { line: "Done 29 Oct · 62 lines matched", completedAt: NOW }), NOW)).toBe("62 lines matched");
  });
});

it("Dispatch preserves bb's real coordinator menu and answer routing", async () => {
  const { slot } = renderList(normalDay());
  const chat = await screen.findByRole("button", { name: "Open Bricks Bot chat" });
  fireEvent.contextMenu(chat);
  const menu = slot.container.querySelector('[data-thread-id="thr_coord_bricks"] [role="menu"]')!;
  expect(menu.textContent).toContain("Open chat");
  expect(menu.textContent).toContain("Rename");
  fireEvent.click(within(menu as HTMLElement).getByRole("menuitem", { name: "Open chat" }));
  expect(opened(slot)).toContain("thr_coord_bricks");
  fireEvent.click(screen.getByRole("button", { name: /^Show Bricks's work/ }));
  expect(screen.getByRole("dialog").textContent).toContain("Is the iPhone connected to the Mac?");
  expect(screen.getByRole("dialog").textContent).toContain("Warranty QR relabel");
});
it("Dispatch leaves questions and their count to the notification center", async () => {
  renderList(tenDecisions());
  await screen.findByRole("button", { name: "Bots" });
  expect(screen.queryByRole("region", { name: "Needs attention" })).toBeNull();
  for (const work of screen.getAllByRole("button", { name: /^Show .+'s work/ })) {
    fireEvent.click(work);
    expect(screen.getByRole("dialog").querySelector(".dispatch-ask-card")).toBeNull();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
  }
});
it("Dispatch loads genuine attempt models and refreshes on push", async () => {
  const { calls } = renderList(normalDay());
  fireEvent.click(await screen.findByRole("button", { name: /^Show ERBareeq's work/ }));
  await waitFor(() => expect(calls).toContain("task_detail"));
  await waitFor(() => expect(Array.from(document.querySelectorAll(".dispatch-panel .dispatch-worker-model")).some(node => /^(Sol|Terra|Astra|Opus|Fable)\b/.test(node.textContent ?? ""))).toBe(true));
  const before = calls.filter(x => x === "bot_tasks").length;
  act(() => window.dispatchEvent(new Event(NEEDS_CHANGED)));
  await waitFor(() => expect(calls.filter(x => x === "bot_tasks").length).toBeGreaterThan(before));
});
it("retains loading, missing and error fallbacks", async () => {
  const base = { activeThreadId: null, isCompactViewport: true, now: NOW, onOpen: vi.fn(), onShowThreads: vi.fn() };
  const view = render(<BotsView {...base} state={{ data: null, status: "loading", cached: false }} />);
  expect(screen.getByRole("status").textContent).toContain("Loading");
  view.rerender(<BotsView {...base} state={{ data: null, status: "missing", cached: false }} />);
  expect(screen.getByRole("status").textContent).toContain("no task list");
  view.rerender(<BotsView {...base} state={{ data: null, status: "error", cached: false }} />);
  expect(screen.getByRole("status").textContent).toContain("Retrying");
  fireEvent.click(screen.getByRole("button", { name: "Show threads" }));
  expect(base.onShowThreads).toHaveBeenCalledOnce();
});
it("starts a fresh tap after picking an action from bb's held-touch menu", async () => {
  const { slot } = renderList(normalDay());
  const chat = await screen.findByRole("button", { name: "Open Bricks Bot chat" });
  fireEvent.pointerDown(chat, { pointerType: "touch", clientX: 30, clientY: 30 });
  await act(() => new Promise(resolve => setTimeout(resolve, 720)));
  fireEvent.pointerUp(chat); fireEvent.click(chat);
  expect(opened(slot)).toEqual([]);
  const menu = slot.container.querySelector<HTMLElement>('[data-thread-id="thr_coord_bricks"] [role="menu"]')!;
  fireEvent.click(within(menu).getByRole("menuitem", { name: "Pin" }));
  expect(recordedActions(slot).some(action => action.method === "setPinned" && action.threadId === "thr_coord_bricks")).toBe(true);
  fireEvent.pointerDown(chat, { pointerType: "touch", clientX: 30, clientY: 30 });
  fireEvent.pointerUp(chat); fireEvent.click(chat);
  expect(opened(slot)).toEqual(["thr_coord_bricks"]);
});

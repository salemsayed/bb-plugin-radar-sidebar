// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NOW, makeThread } from "./fixtures";
import { recordedActions, threadActionsFixture } from "./threadActions.fixtures";
import { attemptThreads, normalDay, peakDay, rtlAndEmpty, taskDetails, tenDecisions } from "./botTasksFixtures";
import { BotsView, attemptWhen, closedAge, moodFace, rowDetail, rowStateWord, waitingLine } from "./BotsView";
import { resetTaskAttempts } from "./useTaskAttempts";
import { LIST_MODE_KEY } from "./ListModeSwitch";
import { botMood, botTasksSchema } from "@/lib/botTasks";
import { makeTask } from "./botTasksFixtures";
import { DAY, HOUR } from "./fixtures";
import type { BotTasksOutput } from "@/lib/tasks-v2-types";
import { NEEDS_CHANGED } from "@/lib/needsClient";
import { resetBotsPush } from "@/lib/botsPush";

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

function renderList(tasks: Tasks, options: { settings?: Record<string, boolean>; compact?: boolean; activeThreadId?: string | null; onNavigate?: () => void; detail?: "missing" | "error" } = {}) {
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
    settings: { botsSwitch: true, hoverCard: false, ...options.settings },
    rpc: { crew_needs_list: () => ({ items: [] }), crew_asks: () => ({ judgements: [] }) },
    sidebarThreads: { status: "ready", threads, projects: [], sections: [], experimental_archived: null },
  }));
  return { slot, callRpc, calls };
}

const rowIds = (container: HTMLElement) => Array.from(container.querySelectorAll("[data-sidebar-thread-id]")).map(node => node.getAttribute("data-sidebar-thread-id"));
const opened = (slot: ReturnType<typeof renderList>["slot"]) => recordedActions(slot).filter(call => call.method === "open").map(call => call.threadId);
const taskTitles = (scope: HTMLElement) => Array.from(scope.querySelectorAll(".radar-task-row .radar-task-title")).map(node => node.textContent);

beforeEach(() => {
  // Only the clock is fixed, so "Done today" means the fixtures' day; timers and promises stay real.
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  resetBotsPush();
  resetTaskAttempts();
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
  it("opens on Bots with the Needs-you count, and remembers Threads per device", async () => {
    const { slot } = renderList(normalDay());
    const bots = await screen.findByRole("button", { name: "Bots, 4 need you" });
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
    renderList(normalDay(), { activeThreadId: "thr_task_t_replit" });
    const row = await screen.findByRole("button", { name: /^Move the backend off Replit, Working/ });
    expect(row.getAttribute("aria-current")).toBe("page");
    fireEvent.click(screen.getByRole("button", { name: "Threads" }));
    fireEvent.click(screen.getByRole("button", { name: /^Bots/ }));
    expect((await screen.findByRole("button", { name: /^Move the backend off Replit, Working/ })).getAttribute("aria-current")).toBe("page");
  });

  it("works in the phone drawer with 40px+ controls", async () => {
    const { slot } = renderList(normalDay(), { compact: true });
    await screen.findByRole("button", { name: "Bots, 4 need you" });
    expect(slot.container.querySelector(".radar-list-shell.radar-list-compact")).toBeTruthy();
  });
});

describe("Bots view: a normal day", () => {
  it("lists Needs you first, then each bot in roster order with its summary", async () => {
    const navigate = vi.fn();
    const { slot } = renderList(normalDay(), { onNavigate: navigate });
    const needs = await screen.findByRole("region", { name: "Needs you" });
    // Desktop shows three, and the count opens every decision in one tap.
    expect(within(needs).getAllByRole("listitem")).toHaveLength(4);
    fireEvent.click(within(needs).getByRole("button", { name: "Needs you: open all 4" }));
    const questions = Array.from(needs.querySelectorAll(".radar-need-row .radar-task-title")).map(node => node.textContent);
    expect(questions).toEqual(["Merge and deploy dark, flag off?", "Send one voice note in each app so I can confirm?", "Is the iPhone connected to the Mac?", "Open the MR for Yasser?"]);
    const sections = Array.from(slot.container.querySelectorAll(".radar-tasks-bot")).map(node => node.getAttribute("aria-label"));
    expect(sections).toEqual(["ERBareeq Bot", "Bricks Bot", "Lab Bot", "Home Bot", "Personal Bot", "Work Bot"]);
    expect(screen.getByRole("button", { name: /^Open ERBareeq Bot: 2 for you · 2 working · 1 queued · 4 waiting$/ })).toBeTruthy();
    // A decision opens the exact thread holding the interaction (a worker here), and closes the phone drawer.
    fireEvent.click(within(needs).getByText("Merge and deploy dark, flag off?"));
    expect(opened(slot)).toEqual(["thr_worker_surveys"]);
    expect(navigate).toHaveBeenCalledOnce();
  });

  it("opens a task's conversation and a bot's coordinator in bb's thread route", async () => {
    const { slot } = renderList(normalDay());
    fireEvent.click(await screen.findByRole("button", { name: /^Move the backend off Replit/ }));
    fireEvent.click(screen.getByRole("button", { name: /^Open Bricks Bot:/ }));
    expect(opened(slot)).toEqual(["thr_task_t_replit", "thr_coord_bricks"]);
  });

  it("folds waiting beyond three, and Done today holds only today's real completions", async () => {
    const { slot } = renderList(normalDay());
    const erbareeq = await screen.findByRole("region", { name: "ERBareeq Bot" });
    expect(taskTitles(erbareeq)).toEqual([
      "Merchant feedback surveys, part 1", "Voice notes on local models", "Move the backend off Replit", "Survey stress test and video", "Fable review: deploy window",
      "مراجعة تسويات مرتجعات بريكس", "Chat · Islam · login code", "Social posts in our style, all pages",
    ]);
    fireEvent.click(within(erbareeq).getByRole("button", { name: /1 more waiting/ }));
    expect(taskTitles(erbareeq)).toContain("Google Maps key: new server IP");
    // Yesterday's MSSQL finish is not "today".
    fireEvent.click(within(erbareeq).getByRole("button", { name: /Done today · 1/ }));
    expect(taskTitles(erbareeq)).toContain("Unused company lines (Orange)");
    expect(taskTitles(erbareeq)).not.toContain("MSSQL database on our host");
    // A stopped task is never counted as done.
    const bricks = screen.getByRole("region", { name: "Bricks Bot" });
    expect(within(bricks).getByRole("button", { name: "Done today · 1 · 1 stopped today" })).toBeTruthy();
    expect(slot.container.querySelector(".radar-task-age")).toBeTruthy();
  });

  it("always shows needs, working, queued, offline, retrying and overdue rows", async () => {
    renderList(normalDay());
    const home = await screen.findByRole("region", { name: "Home Bot" });
    expect(within(home).getByRole("button", { name: /^Multi-WAN bonding \(EdgeRouter\), Offline/ })).toBeTruthy();
    expect(within(home).getByRole("button", { name: /^Kitchen TV colour fault: root cause, Overdue/ })).toBeTruthy();
    const lab = screen.getByRole("region", { name: "Lab Bot" });
    expect(within(lab).getByRole("button", { name: /, Retrying, / })).toBeTruthy();
  });

  it("collapses quiet bots; unfolding an empty bot says so", async () => {
    renderList(normalDay());
    const personal = await screen.findByRole("region", { name: "Personal Bot" });
    expect(within(personal).queryByRole("list")).toBeNull();
    expect(within(personal).getByRole("button", { name: "Open Personal Bot: quiet" })).toBeTruthy();
    fireEvent.click(within(personal).getByRole("button", { name: "Unfold Personal Bot" }));
    expect(within(personal).getByText("Nothing open")).toBeTruthy();
    // Yesterday's completion keeps Work quiet without a Done today.
    expect(screen.getByRole("button", { name: "Open Work Bot: quiet" })).toBeTruthy();
  });

  it("shows the dev chip, a bot's work without a task in its own group, and Not filed", async () => {
    const { slot } = renderList(normalDay());
    const row = await screen.findByRole("button", { name: /^Move the backend off Replit/ });
    expect(within(row).getByText("dev")).toBeTruthy();
    fireEvent.click(within(screen.getByRole("region", { name: "ERBareeq Bot" })).getByRole("button", { name: "Fable review: deploy window, running, no task" }));
    const notFiled = screen.getByRole("region", { name: "Not filed" });
    fireEvent.click(within(notFiled).getByRole("button", { name: /Not filed/ }));
    expect(within(notFiled).getByText("Likely Lab")).toBeTruthy();
    fireEvent.click(within(notFiled).getByText("Untitled plain thread"));
    expect(opened(slot)).toEqual(["thr_unlinked_1", "thr_plain_1"]);
  });

  it("refreshes on the bots push signal", async () => {
    let version = 0;
    const { callRpc } = renderList(() => { version += 1; const day = normalDay(); day.bots[2]!.tasks[0]!.title = `Lab v${version}`; return day; });
    await screen.findByText("Lab v1");
    act(() => { window.dispatchEvent(new Event(NEEDS_CHANGED)); });
    await screen.findByText("Lab v2");
    expect(callRpc.mock.calls.filter(([call]) => call.method === "bot_tasks").length).toBeGreaterThanOrEqual(2);
  });
});

describe("Bots view under load", () => {
  it("handles the 44-task peak: every open task is shown or counted in a fold", async () => {
    const peak = peakDay();
    expect(peak.bots.reduce((sum, bot) => sum + bot.tasks.length, 0)).toBe(44);
    const started = performance.now();
    const { slot } = renderList(peak);
    await screen.findByRole("region", { name: "ERBareeq Bot" });
    const shown = slot.container.querySelectorAll(".radar-tasks-bot .radar-task-row").length;
    const folded = Array.from(slot.container.querySelectorAll(".radar-tasks-bot .radar-task-fold"))
      .map(node => Number(/(\d+) more waiting/.exec(node.textContent ?? "")?.[1] ?? 0)).reduce((a, b) => a + b, 0);
    expect(shown + folded).toBe(44);
    expect(performance.now() - started).toBeLessThan(2_000);
    // Every needs, working and queued row is on screen without unfolding anything.
    const openRows = peak.bots.flatMap(bot => bot.tasks).filter(task => task.displayState !== "waiting").length;
    expect(slot.container.querySelectorAll(".radar-tasks-bot .radar-task-row:not(.radar-task-waiting)").length).toBe(openRows);
  });

  it("puts all ten decisions one tap from the phone drawer", async () => {
    const navigate = vi.fn();
    const { slot } = renderList(tenDecisions(), { compact: true, onNavigate: navigate });
    const needs = await screen.findByRole("region", { name: "Needs you" });
    const rows = within(needs).getAllByRole("button").filter(button => button.classList.contains("radar-need-row"));
    expect(rows).toHaveLength(10);
    expect(within(needs).queryByText(/See all/)).toBeNull();
    for (const row of rows) fireEvent.click(row);
    // Opening the drawer is tap one; each decision is tap two, landing on its own thread.
    expect(opened(slot)).toEqual(["thr_dec_3", "thr_dec_4", "thr_dec_5", "thr_dec_0", "thr_dec_1", "thr_dec_2", "thr_dec_8", "thr_dec_9", "thr_dec_6", "thr_dec_7"]);
    expect(navigate).toHaveBeenCalledTimes(10);
    expect(screen.getByRole("button", { name: "Bots, 10 need you" })).toBeTruthy();
  });

  it("reaches all ten on a desktop through the count in one click", async () => {
    renderList(tenDecisions());
    const needs = await screen.findByRole("region", { name: "Needs you" });
    expect(needs.querySelectorAll(".radar-need-row")).toHaveLength(3);
    fireEvent.click(within(needs).getByRole("button", { name: "Needs you: open all 10" }));
    expect(needs.querySelectorAll(".radar-need-row")).toHaveLength(10);
  });
});

describe("Bots view: RTL and long titles", () => {
  it("isolates every title and line with dir=auto, on one line", async () => {
    const { slot } = renderList(rtlAndEmpty());
    await screen.findByRole("region", { name: "ERBareeq Bot" });
    // Titles, the detail after a row's state word, and the needs lane's second line all carry text Salem wrote.
    const titles = Array.from(slot.container.querySelectorAll(".radar-task-title, .radar-task-detail, .radar-need-row .radar-task-line"));
    expect(titles.length).toBeGreaterThan(6);
    for (const node of titles) {
      expect(node.tagName === "BDI" || node.getAttribute("dir") === "auto" || node.closest(".radar-tasks-extra")).toBeTruthy();
    }
    const rtl = slot.container.querySelector('[data-task-id="t_rtl"] .radar-task-title')!;
    expect(rtl.tagName).toBe("BDI");
    expect(rtl.getAttribute("dir")).toBe("auto");
    expect(rtl.textContent!.length).toBeGreaterThan(150);
    const css = readFileSync(resolve(import.meta.dirname ?? ".", "../../styles/bots-view.css"), "utf8");
    expect(css).toMatch(/\.radar-task-title, \.radar-task-line \{[^}]*white-space: nowrap;[^}]*text-overflow: ellipsis;[^}]*unicode-bidi: isolate;/);
  });
});

describe("Bots view without bot_tasks", () => {
  it("says so in one line with a way to Threads when the core is older", async () => {
    const { slot } = renderList(new Error('HTTP 404: plugin "orchestrator-mode" has no rpc method "bot_tasks"'));
    const status = await screen.findByText(/This bots core has no task list yet/);
    expect(status.closest('[role="status"]')).toBeTruthy();
    expect(screen.getByRole("button", { name: "Bots" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show threads" }));
    await waitFor(() => expect(rowIds(slot.container)).toContain("plain"));
  });

  it("never shows a blank list while loading or after a transient failure", async () => {
    renderList(new Error("fetch failed"));
    expect(await screen.findByText("Bot tasks didn't load. Retrying automatically.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show threads" })).toBeTruthy();
  });

  it("keeps the last tasks on a transient failure and says how old they are", async () => {
    let fail = false;
    renderList(() => { if (fail) throw new Error("fetch failed"); return normalDay(); });
    await screen.findByRole("region", { name: "ERBareeq Bot" });
    fail = true;
    act(() => { window.dispatchEvent(new Event(NEEDS_CHANGED)); });
    expect(await screen.findByText(/^As of .*Retrying\.$/)).toBeTruthy();
    expect(screen.getByRole("region", { name: "ERBareeq Bot" })).toBeTruthy();
  });
});

describe("review fixes (Fable, thr_tgexkf5gv4)", () => {
  it("renders the bot summary as whole parts and keeps the full line for screen readers", async () => {
    renderList(normalDay());
    const header = await screen.findByRole("button", { name: /^Open ERBareeq Bot: 2 for you · 2 working · 1 queued · 4 waiting$/ });
    const parts = Array.from(header.querySelectorAll(".radar-tasks-bot-summary-part")).map(node => node.textContent);
    expect(parts).toEqual(["2 for you", "2 working", "1 queued", "4 waiting"]);
    const css = readFileSync(resolve(import.meta.dirname ?? ".", "../../styles/bots-view.css"), "utf8");
    expect(css).toMatch(/\.radar-tasks-bot-summary \{[^}]*flex-wrap: wrap;[^}]*overflow: hidden;/);
    expect(css).toMatch(/\.radar-tasks-bot-summary-part \{ white-space: nowrap; \}/);
  });

  it("dates a stale copy from an earlier day", () => {
    const data = botTasksSchema.parse({ ...normalDay(), observedAt: NOW - 26 * 3_600_000 });
    render(<BotsView state={{ data, status: "error", cached: false }} activeThreadId={null} isCompactViewport={false} now={NOW} onOpen={() => {}} onShowThreads={() => {}} />);
    const line = screen.getByText(/^As of /).textContent!;
    expect(line).toMatch(/20 Sept|Sep 20|20 Sep/);
    expect(line).toMatch(/Retrying\.$/);
    cleanup();
    const today = botTasksSchema.parse({ ...normalDay(), observedAt: NOW - 3_600_000 });
    render(<BotsView state={{ data: today, status: "ready", cached: true }} activeThreadId={null} isCompactViewport={false} now={NOW} onOpen={() => {}} onShowThreads={() => {}} />);
    expect(screen.getByText(/^As of /).textContent).not.toMatch(/Sep/);
  });

  it("reads a task row's line to screen readers", async () => {
    renderList(normalDay());
    expect(await screen.findByRole("button", { name: "Move the backend off Replit, Working, 1h. Phase 3: Express paths out, installer syncs moved in." })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Chat · Islam · login code, Waiting for Islam, 1h" })).toBeTruthy();
  });

  it("keeps focus when Show threads or See all unmounts the pressed button", async () => {
    renderList(new Error('plugin "orchestrator-mode" has no rpc method "bot_tasks"'));
    fireEvent.click(await screen.findByRole("button", { name: "Show threads" }));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Threads" }));
    cleanup();
    localStorage.clear();
    renderList(tenDecisions());
    const needs = await screen.findByRole("region", { name: "Needs you" });
    fireEvent.click(within(needs).getByRole("button", { name: "See all 10" }));
    expect((document.activeElement as HTMLElement).textContent).toContain("Is the iPhone connected to the Mac?");
  });

  it("keeps a typed filter across Bots and back", async () => {
    localStorage.setItem(LIST_MODE_KEY, "threads");
    const { slot } = renderList(normalDay());
    fireEvent.change(await screen.findByPlaceholderText("Filter threads…"), { target: { value: "Plain" } });
    await waitFor(() => expect(rowIds(slot.container)).toEqual(["plain"]));
    fireEvent.click(screen.getByRole("button", { name: /^Bots/ }));
    fireEvent.click(screen.getByRole("button", { name: "Threads" }));
    expect((await screen.findByPlaceholderText("Filter threads…") as HTMLInputElement).value).toBe("Plain");
    await waitFor(() => expect(rowIds(slot.container)).toEqual(["plain"]));
  });
});

describe("live qualification on Lab (2026-10-29)", () => {
  it("shows a night completion under Done today with the local day, not the server's UTC date", async () => {
    const local = new Date(NOW); local.setHours(0, 30, 0, 0);
    const day = normalDay();
    day.bots[2]!.tasks.push({ ...day.bots[2]!.tasks[0]!, id: "t_night", title: "Night job", displayState: "done", line: `Done ${local.toISOString().slice(0, 10)}`, completedAt: local.getTime() });
    renderList(day);
    const lab = await screen.findByRole("region", { name: "Lab Bot" });
    fireEvent.click(within(lab).getByRole("button", { name: /^Done today · 1/ }));
    const row = within(lab).getByRole("button", { name: /^Night job, Done/ });
    expect(row.textContent).toContain("Done today");
    expect(row.textContent).not.toContain(local.toISOString().slice(0, 10));
  });
});

describe("BotsView component", () => {
  it("shows a peek on desktop hover and none on a phone", async () => {
    vi.useFakeTimers({ now: NOW });
    const data = botTasksSchema.parse(normalDay());
    const props = { state: { data, status: "ready" as const, cached: false }, activeThreadId: null, now: NOW, onOpen: () => {}, onShowThreads: () => {} };
    const { unmount } = render(<BotsView {...props} isCompactViewport={false} />);
    fireEvent.mouseEnter(screen.getByRole("button", { name: /^Move the backend off Replit/ }));
    act(() => { vi.advanceTimersByTime(400); });
    const peek = screen.getByRole("tooltip");
    expect(peek.textContent).toContain("ERBareeq · Working");
    expect(peek.textContent).toContain("Phase 3: Express paths out");
    unmount();
    render(<BotsView {...props} isCompactViewport />);
    fireEvent.mouseEnter(screen.getByRole("button", { name: /^Move the backend off Replit/ }));
    act(() => { vi.advanceTimersByTime(400); });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("lists a needs-state task the server gave no interaction for", () => {
    const day = normalDay();
    day.needs = day.needs.filter(item => item.taskId !== "t_brk42");
    const data = botTasksSchema.parse(day);
    const onOpen = vi.fn();
    render(<BotsView state={{ data, status: "ready", cached: false }} activeThreadId={null} isCompactViewport now={NOW} onOpen={onOpen} onShowThreads={() => {}} />);
    fireEvent.click(within(screen.getByRole("region", { name: "Needs you" })).getByText("Open the MR for Yasser?"));
    expect(onOpen).toHaveBeenCalledWith("thr_ask_brk42");
  });
});

describe("Bots view: the row's second line and the quiet zero", () => {
  it("shows what a waiting task waits for, not only whom", () => {
    // The core's line: "Waiting for <owner>: <reason> · wakes …". The ring already says waiting.
    expect(waitingLine({ line: "Waiting for the bot: Kitchen TV standby wakes with Wake on Wi-Fi off · wakes 09:00", waitFor: "the bot" }))
      .toBe("Kitchen TV standby wakes with Wake on Wi-Fi off · wakes 09:00");
    expect(waitingLine({ line: "Waiting for Mohamed Omar: the reconciliation file · no wake set", waitFor: "Mohamed Omar" }))
      .toBe("Mohamed Omar: the reconciliation file · no wake set");
    // No reason known: the owner alone, as before.
    expect(waitingLine({ line: "", waitFor: "Islam" })).toBe("Waiting for Islam");
    expect(waitingLine({ line: "", waitFor: undefined })).toBe("Waiting");
    // A line the core wrote in another shape passes through untouched.
    expect(waitingLine({ line: "Blocked until the host returns", waitFor: "the bot" })).toBe("Blocked until the host returns");
  });

  it("renders the reason in the row and reads it to screen readers", async () => {
    renderList(normalDay());
    const row = await screen.findByRole("button", { name: "Kitchen TV standby, Waiting for the bot, 2h. natural standby wakes with Wake on Wi-Fi off · wakes 09:00" });
    expect(within(row).getByText("natural standby wakes with Wake on Wi-Fi off · wakes 09:00")).toBeTruthy();
    expect(within(row).queryByText("Waiting for the bot")).toBeNull();
  });

  it("mutes the Needs you count at zero and warns above it", async () => {
    const quiet = normalDay();
    for (const bot of quiet.bots) bot.tasks = bot.tasks.filter(task => task.displayState !== "needs");
    quiet.needs = [];
    const { slot } = renderList(quiet);
    await screen.findByRole("region", { name: "Needs you" });
    expect(slot.container.querySelector(".radar-tasks-count-static")?.className).toContain("radar-tasks-count-zero");
    cleanup();
    localStorage.clear();
    const { slot: busy } = renderList(tenDecisions(), { compact: true });
    await screen.findByRole("region", { name: "Needs you" });
    expect(busy.container.querySelector(".radar-tasks-count-static")?.className).not.toContain("radar-tasks-count-zero");
  });

  it("gives Lab a mascot like the rest of the crew, and folds with one icon chevron", async () => {
    const { slot } = renderList(normalDay());
    const lab = await screen.findByRole("region", { name: "Lab Bot" });
    expect(lab.querySelector('.bot-mascot[data-mascot="lab"]')).toBeTruthy();
    expect(lab.querySelector(".radar-tasks-face-letter")).toBeNull();
    expect(slot.container.textContent).not.toMatch(/[▾▸]/);
    expect(slot.container.querySelectorAll(".radar-tasks-chevron .radar-tasks-chevron-icon").length).toBe(6);
  });
});

describe("Bots view redesign (Salem, thr_2gjivwx8ea, 2026-10-29: bold redesign, status at a glance)", () => {
  it("wears each bot's mood on its card: tone, face, badge and a solid first chip", async () => {
    const { slot } = renderList(normalDay());
    await screen.findByRole("region", { name: "ERBareeq Bot" });
    const moods = Array.from(slot.container.querySelectorAll(".radar-tasks-bot")).map(node => [node.getAttribute("aria-label"), node.getAttribute("data-mood")]);
    expect(moods).toEqual([["ERBareeq Bot", "needs"], ["Bricks Bot", "needs"], ["Lab Bot", "working"], ["Home Bot", "overdue"], ["Personal Bot", "quiet"], ["Work Bot", "quiet"]]);
    const erbareeq = screen.getByRole("region", { name: "ERBareeq Bot" });
    expect(erbareeq.className).toContain("radar-tasks-bot-ask");
    expect(erbareeq.querySelector(".radar-tasks-hero-badge")?.textContent).toBe("?");
    expect(erbareeq.querySelector(".radar-tasks-bot-mood")?.textContent).toBe("2 for you");
    const home = screen.getByRole("region", { name: "Home Bot" });
    expect(home.className).toContain("radar-tasks-bot-trouble");
    expect(home.querySelector(".radar-tasks-hero-badge")?.textContent).toBe("!");
    const lab = screen.getByRole("region", { name: "Lab Bot" });
    expect(lab.querySelector(".radar-tasks-hero-badge")).toBeNull();
    expect(lab.querySelector(".radar-tasks-hero")?.className).toContain("radar-tasks-hero-busy");
    // The hero is decorative; the header's label still says it all.
    expect(lab.querySelector(".radar-tasks-hero")?.getAttribute("aria-hidden")).toBe("true");
    expect(within(lab).getByRole("button", { name: "Open Lab Bot: 2 working" })).toBeTruthy();
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

  it("opens every row's second line with its state word, then the detail without a repeated preamble", async () => {
    renderList(normalDay());
    const queued = await screen.findByRole("button", { name: /^Survey stress test and video, Queued/ });
    expect(within(queued).getByText("Queued").className).toContain("radar-task-state-queued");
    expect(within(queued).getByText("no Opus capacity · retry 14:20")).toBeTruthy();
    const waiting = screen.getByRole("button", { name: "Chat · Islam · login code, Waiting for Islam, 1h" });
    expect(within(waiting).getByText("Waiting")).toBeTruthy();
    expect(within(waiting).getByText("Islam")).toBeTruthy();
    const home = screen.getByRole("region", { name: "Home Bot" });
    expect(within(home).getByText("Overdue").className).toContain("radar-task-state-overdue");
    expect(within(home).getByText("Offline").className).toContain("radar-task-state-offline");
    expect(rowDetail(makeTask("x", "a", "queued", { line: "Queued: no capacity" }), NOW)).toBe("no capacity");
    expect(rowDetail(makeTask("x", "a", "working", { line: "" }), NOW)).toBe("");
    expect(rowDetail(makeTask("x", "a", "waiting", { waitFor: "Islam" }), NOW)).toBe("Islam");
    expect(rowDetail(makeTask("x", "a", "waiting", {}), NOW)).toBe("");
    expect(rowDetail(makeTask("x", "a", "done", { line: "Done 2026-10-28", completedAt: NOW }), NOW)).toBe("");
    expect(rowDetail(makeTask("x", "a", "done", { line: "Done 2026-10-28 · 62 lines matched", completedAt: NOW }), NOW)).toBe("62 lines matched");
    expect(rowDetail(makeTask("x", "a", "done", { line: "62 lines matched", completedAt: NOW }), NOW)).toBe("62 lines matched");
    // A finished row's word carries its local day, so "Done today · 62 lines matched" reads as one line.
    expect(rowStateWord(makeTask("x", "a", "done", { line: "Done 2026-10-28 · 62 lines matched", completedAt: NOW }), NOW)).toBe("Done today");
    expect(rowStateWord(makeTask("x", "a", "done", { line: "62 lines matched", completedAt: NOW }), NOW)).toBe("Done");
    expect(rowStateWord(makeTask("x", "a", "stopped", { line: "Stopped by Salem", completedAt: NOW }), NOW)).toBe("Stopped");
  });

  it("keeps the fold and open targets phone-sized and the chevron at the card's end", async () => {
    const { slot } = renderList(normalDay(), { compact: true });
    await screen.findByRole("region", { name: "ERBareeq Bot" });
    const head = slot.container.querySelector(".radar-tasks-bot-head")!;
    expect(Array.from(head.children).map(node => node.className)).toEqual(["radar-tasks-bot-open", "radar-tasks-chevron"]);
    const css = readFileSync(resolve(import.meta.dirname ?? ".", "../../styles/bots-view.css"), "utf8");
    expect(css).toMatch(/\.radar-list-compact \.radar-tasks-chevron \{ width: 44px; height: 4[48]px; \}/);
    expect(css).toMatch(/\.radar-list-compact \.radar-tasks-bot-open \{ min-height: 4[48]px; \}/);
  });
});

describe("Bots view: one row per thing asked for, workers as its attempts, nothing vanishes (Salem, thr_g9gsfjxfyx)", () => {
  const attemptLabels = (scope: HTMLElement) => Array.from(scope.querySelectorAll(".radar-task-attempt")).map(node => node.getAttribute("aria-label"));

  it("keeps closed work from earlier this week under its bot, folded with its count, with the day in the age column", async () => {
    renderList(normalDay());
    const erbareeq = await screen.findByRole("region", { name: "ERBareeq Bot" });
    const fold = within(erbareeq).getByRole("button", { name: "Earlier this week · 3" });
    expect(fold.getAttribute("aria-expanded")).toBe("false");
    expect(taskTitles(erbareeq)).not.toContain("MSSQL database on our host");
    fireEvent.click(fold);
    expect(taskTitles(erbareeq).slice(-3)).toEqual(["MSSQL database on our host", "Orange lines: September invoice check", "Instagram views report"]);
    // With both folds open every closed row the core sent is on screen.
    fireEvent.click(within(erbareeq).getByRole("button", { name: /^Done today · 1/ }));
    const closed = normalDay().bots[0]!.tasks.filter(task => ["done", "stopped", "cancelled"].includes(task.displayState));
    expect(closed).toHaveLength(4);
    for (const task of closed) expect(taskTitles(erbareeq)).toContain(task.title);
    // The age column names the weekday (NOW is a Monday; the report stopped on Thursday) and the row still opens.
    expect(within(erbareeq).getByRole("button", { name: /^Instagram views report, Stopped, Thu\b/ })).toBeTruthy();
    expect(within(erbareeq).getByRole("button", { name: /^Orange lines: September invoice check, Done, Sat\b/ })).toBeTruthy();
    // A quiet bot keeps its week too, behind its own fold.
    const work = screen.getByRole("region", { name: "Work Bot" });
    fireEvent.click(within(work).getByRole("button", { name: "Unfold Work Bot" }));
    expect(within(work).getByRole("button", { name: "Earlier this week · 1" })).toBeTruthy();
    expect(within(work).queryByText("Nothing open")).toBeNull();
  });

  it("lists a task's attempts newest first with model, effort and times, each opening its thread; the row still opens the latest", async () => {
    const { slot, callRpc } = renderList(normalDay());
    await screen.findByRole("region", { name: "ERBareeq Bot" });
    fireEvent.click(screen.getByRole("button", { name: "Show details: Move the backend off Replit" }));
    const details = await screen.findByRole("region", { name: "Move the backend off Replit: details" });
    await waitFor(() => expect(attemptLabels(details)).toHaveLength(3));
    expect(callRpc).toHaveBeenCalledWith(expect.objectContaining({ method: "task_detail", input: { taskId: "t_replit" } }));
    expect(attemptLabels(details)).toEqual([
      expect.stringMatching(/^Replit move: phase 3, installer syncs, Running, gpt-6\.1-sol · xhigh, Started \S+( [AP]M)?, latest attempt$/),
      expect.stringMatching(/^Replit move: phase 2 \(retry after outage\), Ended, claude-opus-5-5 · medium, \S+( [AP]M)? · ended \S+( [AP]M)?$/),
      expect.stringMatching(/^Replit move: phase 1, Express paths, Ended, gpt-6\.1-sol · high, \S+( [AP]M)? · ended \S+( [AP]M)?$/),
    ]);
    expect(within(details).getByText("Phase 3: Express paths out, installer syncs moved in.")).toBeTruthy();
    fireEvent.click(within(details).getAllByRole("button")[2]!);
    expect(opened(slot)).toEqual(["thr_replit_a1"]);
    fireEvent.click(screen.getByRole("button", { name: /^Move the backend off Replit, Working/ }));
    expect(opened(slot)).toEqual(["thr_replit_a1", "thr_task_t_replit"]);
    // Only one task's details are open at a time; the toggle closes its own.
    fireEvent.click(screen.getByRole("button", { name: "Show details: Voice notes on local models" }));
    expect(screen.queryByRole("region", { name: "Move the backend off Replit: details" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Hide details: Voice notes on local models" }));
    expect(screen.queryByRole("region", { name: /: details$/ })).toBeNull();
  });

  it("shows a task the bot did itself as one attempt from its conversation, and a Needs-you task's question", async () => {
    renderList(normalDay());
    const erbareeq = await screen.findByRole("region", { name: "ERBareeq Bot" });
    fireEvent.click(within(erbareeq).getByRole("button", { name: /^Done today · 1/ }));
    fireEvent.click(within(erbareeq).getByRole("button", { name: "Show details: Unused company lines (Orange)" }));
    const details = await screen.findByRole("region", { name: "Unused company lines (Orange): details" });
    await waitFor(() => expect(attemptLabels(details)).toHaveLength(1));
    expect(attemptLabels(details)[0]).toMatch(/^Unused company lines \(Orange\), Ended, \S+( [AP]M)? · ended \S+( [AP]M)?, latest attempt$/);
    expect(within(details).getByText(/finished/)).toBeTruthy();
    fireEvent.click(within(erbareeq).getByRole("button", { name: "Show details: Merchant feedback surveys, part 1" }));
    const surveys = await screen.findByRole("region", { name: "Merchant feedback surveys, part 1: details" });
    expect(within(surveys).getByText("Asks: Merge and deploy dark, flag off?")).toBeTruthy();
    await waitFor(() => expect(attemptLabels(surveys)).toHaveLength(2));
    expect(attemptLabels(surveys)[0]).toMatch(/^Fable review: surveys part 1, Ended, claude-fable-5-1 · high, .*, latest attempt$/);
  });

  it("says so when the core has no task_detail, or the read fails, and still offers the latest attempt", async () => {
    const { slot } = renderList(normalDay(), { detail: "missing" });
    await screen.findByRole("region", { name: "ERBareeq Bot" });
    fireEvent.click(screen.getByRole("button", { name: "Show details: Move the backend off Replit" }));
    const details = await screen.findByRole("region", { name: "Move the backend off Replit: details" });
    await within(details).findByText("This core doesn't list attempts yet; only the latest is known.");
    expect(attemptLabels(details)).toEqual([expect.stringMatching(/^Replit move: phase 3, installer syncs, Running, Started .*, latest attempt$/)]);
    fireEvent.click(within(details).getByRole("button"));
    expect(opened(slot)).toEqual(["thr_task_t_replit"]);
    cleanup();
    resetTaskAttempts();
    renderList(normalDay(), { detail: "error" });
    await screen.findByRole("region", { name: "ERBareeq Bot" });
    fireEvent.click(screen.getByRole("button", { name: "Show details: Move the backend off Replit" }));
    await screen.findByText("Attempts didn't load; only the latest is known.");
  });

  it("works on a phone: the details toggle is its own 44px target beside each row", async () => {
    const { slot } = renderList(normalDay(), { compact: true });
    await screen.findByRole("region", { name: "ERBareeq Bot" });
    const toggle = screen.getByRole("button", { name: "Show details: Move the backend off Replit" });
    expect(toggle.closest(".radar-task-rowline")).toBeTruthy();
    expect(toggle.classList.contains("radar-task-info-toggle")).toBe(true);
    expect(toggle.closest(".radar-list-compact")).toBeTruthy();
    fireEvent.click(toggle);
    expect(await screen.findByRole("region", { name: "Move the backend off Replit: details" })).toBeTruthy();
  });

  it("names a finished row's day: time today, weekday this week, date beyond; an attempt's times read as a span", () => {
    expect(closedAge(NOW - HOUR, NOW)).toMatch(/\d/);
    expect(closedAge(NOW - 4 * DAY, NOW)).toBe("Thu");
    expect(closedAge(NOW - 9 * DAY, NOW)).toMatch(/Sep/);
    expect(attemptWhen({ startedAt: null, endedAt: null, state: "idle" }, NOW)).toBe("");
    expect(attemptWhen({ startedAt: NOW - HOUR, endedAt: null, state: "running" }, NOW)).toMatch(/^Started \S+/);
    expect(attemptWhen({ startedAt: NOW - 2 * HOUR, endedAt: NOW - HOUR, state: "idle" }, NOW)).toMatch(/ · ended /);
    expect(attemptWhen({ startedAt: NOW - DAY - HOUR, endedAt: NOW - HOUR, state: "idle" }, NOW)).toMatch(/Sep/);
  });
});

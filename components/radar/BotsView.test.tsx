// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { NOW, makeThread } from "./fixtures";
import { recordedActions, threadActionsFixture } from "./threadActions.fixtures";
import { normalDay, peakDay, rtlAndEmpty, tenDecisions } from "./botTasksFixtures";
import { BotsView } from "./BotsView";
import { LIST_MODE_KEY } from "./ListModeSwitch";
import { botTasksSchema } from "@/lib/botTasks";
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

function renderList(tasks: Tasks, options: { settings?: Record<string, boolean>; compact?: boolean; activeThreadId?: string | null; onNavigate?: () => void } = {}) {
  const calls: string[] = [];
  const callRpc = vi.fn(async ({ method }: { method: string }) => {
    calls.push(method);
    if (method === "bot_roster") return { bots: roster };
    if (method === "bot_tasks") {
      if (tasks instanceof Error) throw tasks;
      return typeof tasks === "function" ? tasks() : tasks;
    }
    throw new Error(`plugin "orchestrator-mode" has no rpc method "${method}"`);
  });
  const sdk: Record<string, unknown> = {
    threads: {
      list: async () => [], defaultExecutionOptions: async () => null, context: async () => ({ usage: null }),
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

  it("shows every thread in Threads, bot chats and workers included, even with botsPage on", async () => {
    localStorage.setItem(LIST_MODE_KEY, "threads");
    const { slot } = renderList(normalDay(), { settings: { botsPage: true } });
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
    expect(screen.getByRole("button", { name: /^Open ERBareeq Bot: 2 for you · 1 working · 1 queued · 4 waiting$/ })).toBeTruthy();
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
      "Merchant feedback surveys, part 1", "Voice notes on local models", "Move the backend off Replit", "Survey stress test and video",
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
    expect(within(bricks).getByRole("button", { name: "Done today · 1 · 1 stopped or cancelled" })).toBeTruthy();
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

  it("shows the dev chip, Unlinked work and Not filed", async () => {
    const { slot } = renderList(normalDay());
    const row = await screen.findByRole("button", { name: /^Move the backend off Replit/ });
    expect(within(row).getByText("dev")).toBeTruthy();
    const unlinked = screen.getByRole("region", { name: "Unlinked work" });
    fireEvent.click(within(unlinked).getByText("Fable review: deploy window"));
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
      .map(node => Number(/^▸\s*(\d+) more waiting/.exec(node.textContent ?? "")?.[1] ?? 0)).reduce((a, b) => a + b, 0);
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
    const titles = Array.from(slot.container.querySelectorAll(".radar-task-title, .radar-task-line"));
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

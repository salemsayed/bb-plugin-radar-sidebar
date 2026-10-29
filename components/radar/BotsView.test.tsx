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
import { BotsView, LONG_PRESS_MS, attemptWhen, closedAge, moodFace, resetBotSheet, rowDetail, rowStateWord, waitingLine } from "./BotsView";
import { resetTaskAttempts } from "./useTaskAttempts";
import { LIST_MODE_KEY } from "./ListModeSwitch";
import { answerOptions, botMood, botTasksSchema, crewStatus, feedBands, layoutBot, needRows } from "@/lib/botTasks";
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
const feedTitles = (scope: ParentNode) => Array.from(scope.querySelectorAll(".radar-feed-row .radar-feed-title")).map(node => node.textContent);
const band = (key: string) => document.querySelector<HTMLElement>(`[data-band="${key}"]`);
/** A desk's two buttons: its plate (its work sheet) and its character (its chat); and the desk around them. */
const plate = (name: string) => screen.getByRole("button", { name: new RegExp(`^Show ${name}'s work: `) });
const chat = (name: string) => screen.getByRole("button", { name: `Open ${name} Bot chat` });
const desk = (name: string) => plate(name).closest<HTMLElement>(".radar-desk")!;
const css = () => readFileSync(resolve(import.meta.dirname ?? ".", "../../styles/bots-view.css"), "utf8");

beforeEach(() => {
  // Only the clock is fixed, so "Done today" means the fixtures' day; timers and promises stay real.
  vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  resetBotsPush();
  resetTaskAttempts();
  resetBotSheet();
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
    const row = await screen.findByRole("button", { name: /^Move the backend off Replit, ERBareeq, Working/ });
    expect(row.getAttribute("aria-current")).toBe("page");
    fireEvent.click(screen.getByRole("button", { name: "Threads" }));
    fireEvent.click(screen.getByRole("button", { name: /^Bots/ }));
    expect((await screen.findByRole("button", { name: /^Move the backend off Replit, ERBareeq, Working/ })).getAttribute("aria-current")).toBe("page");
  });

  it("works in the phone drawer with 40px+ controls", async () => {
    const { slot } = renderList(normalDay(), { compact: true });
    await screen.findByRole("button", { name: "Bots, 4 need you" });
    expect(slot.container.querySelector(".radar-list-shell.radar-list-compact")).toBeTruthy();
  });
});

describe("Bots view v4, the crew board (Salem, thr_2gjivwx8ea seq 1671: total redesign)", () => {
  it("seats every bot at its own desk in roster order, acting out its state, with its state in words on the plate", async () => {
    const { slot } = renderList(normalDay());
    await screen.findByRole("region", { name: "Bots" });
    const desks = Array.from(slot.container.querySelectorAll<HTMLElement>(".radar-desk"));
    expect(desks.map(node => node.dataset.bot)).toEqual(["erbareeq", "bricks", "lab", "home", "personal", "work"]);
    expect(desks.map(node => node.querySelector(".radar-desk-status")?.textContent)).toEqual(["2 for you", "2 for you", "2 working", "1 overdue", "Quiet", "Quiet"]);
    expect(desks.map(node => node.className.match(/radar-desk-(ask|trouble|busy|idle|quiet)\b/)?.[1])).toEqual(["ask", "ask", "busy", "trouble", "quiet", "quiet"]);
    // The laptop shows what the bot is doing: work scrolling, a "?" for Salem, a red "!", off at rest.
    expect(desks.map(node => node.querySelector(".radar-desk-laptop")?.className.match(/radar-desk-laptop-(\w+)/)?.[1])).toEqual(["ask", "ask", "work", "alert", "off", "off"]);
    expect(desk("Home").querySelector(".radar-desk-siren")).toBeTruthy();
    expect(desk("Lab").querySelector(".radar-desk-siren")).toBeNull();
    expect(desk("ERBareeq").querySelector(".radar-desk-bubble")?.textContent).toBe("2 ?");
    expect(desk("Lab").querySelector(".radar-desk-bubble")).toBeNull();
    expect(plate("ERBareeq").getAttribute("aria-label")).toBe("Show ERBareeq's work: 2 for you · 2 working · 1 queued · 4 waiting");
    expect(chat("ERBareeq").querySelector(".radar-desk-chat-badge")).toBeTruthy();
    // The scene is decoration; the character wears the bot's mood and its own colour tints its mug.
    expect(desk("Lab").querySelector(".radar-desk-char")?.getAttribute("aria-hidden")).toBe("true");
    expect(desk("Lab").querySelector('.bot-mascot[data-mascot="lab"]')).toBeTruthy();
    expect(desk("Lab").style.getPropertyValue("--radar-bot")).toBe("#7b61d9");
    expect(desk("Home").dataset.mood).toBe("overdue");
  });

  it("writes the day's counts on the whiteboard, and says all quiet when there is nothing", async () => {
    renderList(normalDay());
    const board = (await screen.findByRole("region", { name: "Bots" })).querySelector(".radar-room-board")!;
    expect(Array.from(board.children).map(node => node.textContent).filter(Boolean)).toEqual(["4 asks", "1 stuck", "9 live"]);
    cleanup();
    const still = normalDay();
    for (const bot of still.bots) { bot.tasks = bot.tasks.filter(task => ["done", "stopped", "cancelled", "waiting"].includes(task.displayState)); bot.unlinked = []; }
    still.needs = [];
    renderList(still);
    const quiet = (await screen.findByRole("region", { name: "Bots" })).querySelector(".radar-room-board")!;
    expect(quiet.textContent).toBe("All quiet");
  });

  it("opens a bot's sheet in one tap, closes it on a second tap, and never leaves the drawer (Salem: 'click to chat that was useful')", async () => {
    const navigate = vi.fn();
    const { slot } = renderList(normalDay(), { onNavigate: navigate, compact: true });
    await screen.findByRole("region", { name: "Bots" });
    fireEvent.click(plate("Bricks"));
    const sheet = screen.getByRole("region", { name: "Bricks Bot: work" });
    expect(plate("Bricks").getAttribute("aria-expanded")).toBe("true");
    expect(plate("Bricks").getAttribute("aria-controls")).toBe(sheet.id);
    expect(opened(slot)).toEqual([]);
    expect(navigate).not.toHaveBeenCalled();
    // Its asks lead the sheet, every other bot's stay listed under it; its Chat is one tap.
    expect(screen.getByRole("region", { name: "Bricks Bot: needs you" }).querySelectorAll(".radar-ask")).toHaveLength(2);
    expect(screen.getByRole("region", { name: "Other bots need you" }).querySelectorAll(".radar-ask")).toHaveLength(2);
    expect(feedTitles(sheet)).toEqual(["Watch our GitHub PRs too", "PR #11: Yasser's three changes", "Meta ads with the demo offer", "fe!1024 on iPhone and Android"]);
    expect(sheet.dataset.column).toBe("1");
    // Another desk moves the sheet; the same desk again closes it.
    fireEvent.click(plate("Lab"));
    expect(screen.getByRole("region", { name: "Lab Bot: work" }).dataset.column).toBe("2");
    expect(plate("Bricks").getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(plate("Lab"));
    expect(screen.queryByRole("region", { name: "Lab Bot: work" })).toBeNull();
    expect(screen.getByRole("region", { name: "Now" })).toBeTruthy();
    fireEvent.click(plate("Bricks"));
    fireEvent.click(within(screen.getByRole("region", { name: "Bricks Bot: work" })).getByRole("button", { name: "Chat with Bricks" }));
    expect(opened(slot)).toEqual(["thr_coord_bricks"]);
    expect(navigate).toHaveBeenCalledOnce();
    expect(css()).toMatch(/\.radar-desk-front\[aria-expanded="true"\] \{ box-shadow:/);
    // The sheet's Chat is its one solid control.
    expect(css()).toMatch(/\.radar-focus-chat \{[^}]*background: var\(--foreground\);/);
  });

  it("splits each desk into two taps: the character opens the chat, the plate the work sheet, each its own 44px target", async () => {
    const navigate = vi.fn();
    const { slot } = renderList(normalDay(), { compact: true, onNavigate: navigate });
    await screen.findByRole("region", { name: "Bots" });
    fireEvent.click(chat("Lab"));
    expect(opened(slot)).toEqual(["thr_coord_lab"]);
    expect(navigate).toHaveBeenCalledOnce();
    expect(slot.container.querySelector(".radar-sheet")).toBeNull();
    fireEvent.click(plate("Lab"));
    expect(screen.getByRole("region", { name: "Lab Bot: work" })).toBeTruthy();
    expect(navigate).toHaveBeenCalledOnce();
    // Two siblings in the desk, neither inside the other, each with its own name.
    expect(chat("Lab").contains(plate("Lab"))).toBe(false);
    expect(plate("Lab").contains(chat("Lab"))).toBe(false);
    expect(chat("Lab").parentElement).toBe(plate("Lab").parentElement);
    expect(css()).toMatch(/\.radar-desk-chat \{[^}]*min-height: 44px;/);
    expect(css()).toMatch(/\.radar-desk-front \{[^}]*min-height: 44px;/);
    cleanup();
    renderList(normalDay(), { activeThreadId: "thr_coord_lab" });
    await screen.findByRole("region", { name: "Bots" });
    expect(chat("Lab").getAttribute("aria-current")).toBe("page");
  });

  it("keeps every ask and all live work on the page: no bot's question hides behind its desk's bubble", async () => {
    renderList(normalDay(), { compact: true });
    await screen.findByRole("region", { name: "Bots" });
    expect(screen.getByRole("region", { name: "Needs you" }).querySelectorAll(".radar-ask")).toHaveLength(4);
    expect(screen.getAllByRole("button", { name: /^Answer Yes: / })).toHaveLength(4);
    expect(feedTitles(screen.getByRole("region", { name: "Now" }))).toHaveLength(9);
  });

  it("types an answer into the asking thread's composer, end to end, and sends nothing", async () => {
    const { slot } = renderList(normalDay(), { composerThread: "thr_worker_surveys" });
    const needs = await screen.findByRole("region", { name: "Needs you" });
    const first = needs.querySelector<HTMLElement>(".radar-ask")!;
    fireEvent.click(within(first).getByRole("button", { name: "Answer Not yet: opens the chat with it typed in" }));
    expect(opened(slot)).toEqual(["thr_worker_surveys"]);
    await waitFor(() => expect(slot.inspection.composer.text).toBe("Not yet"));
    expect(slot.inspection.composer.submits).toEqual([]);
  });

  it("cleans up a bot's suggested answers the same way on every path", () => {
    expect(answerOptions([" Yes ", "", "Yes", "Not yet", "Later", "Never"])).toEqual(["Yes", "Not yet", "Later"]);
    expect(answerOptions(undefined)).toEqual([]);
    const day = normalDay();
    // A needs task the server listed without an interaction still gets clean answers.
    day.needs = day.needs.filter(item => item.taskId !== "t_brk42");
    day.bots[1]!.tasks.find(task => task.id === "t_brk42")!.needs!.options = ["  Open it ", "Open it", ""];
    expect(needRows(botTasksSchema.parse(day)).find(row => row.taskId === "t_brk42")!.options).toEqual(["Open it"]);
  });

  it("stops every loop and transition when motion is off", () => {
    expect(css()).toMatch(/@media \(prefers-reduced-motion: reduce\) \{ \.radar-studio \*, \.radar-tasks \* \{ animation: none !important; transition: none !important; \} \}/);
    expect(css()).toMatch(/\[data-radar-motion="off"\] \.radar-tasks \* \{ animation: none !important; transition: none !important; \}/);
  });

  it("keeps a busy day readable: ten asks all listed on a phone, each desk counting its own", async () => {
    const { slot } = renderList(tenDecisions(), { compact: true });
    await screen.findByRole("region", { name: "Bots" });
    expect(screen.getByRole("region", { name: "Needs you" }).querySelectorAll(".radar-ask")).toHaveLength(10);
    expect(Array.from(slot.container.querySelectorAll(".radar-desk-bubble")).map(node => node.textContent)).toEqual(["3 ?", "3 ?", "2 ?", "2 ?"]);
  });

  it("puts asks first in full, with the bot's answers; an ask opens its exact thread and an answer opens it with the reply typed in", async () => {
    const navigate = vi.fn();
    const { slot } = renderList(normalDay(), { onNavigate: navigate });
    const needs = await screen.findByRole("region", { name: "Needs you" });
    // Desktop shows three, then one button for the rest.
    expect(needs.querySelectorAll(".radar-ask")).toHaveLength(3);
    fireEvent.click(within(needs).getByRole("button", { name: "1 more ask" }));
    expect(Array.from(needs.querySelectorAll(".radar-ask-question")).map(node => node.textContent))
      .toEqual(["Merge and deploy dark, flag off?", "Send one voice note in each app so I can confirm?", "Is the iPhone connected to the Mac?", "Open the MR for Yasser?"]);
    const first = needs.querySelector<HTMLElement>(".radar-ask")!;
    expect(within(first).getByText("ERBareeq")).toBeTruthy();
    expect(within(first).getByText("Merchant feedback surveys, part 1")).toBeTruthy();
    fireEvent.click(within(first).getByText("Merge and deploy dark, flag off?"));
    expect(opened(slot)).toEqual(["thr_worker_surveys"]);
    expect(navigate).toHaveBeenCalledOnce();
    fireEvent.click(within(first).getByRole("button", { name: "Answer Not yet: opens the chat with it typed in" }));
    expect(opened(slot)).toEqual(["thr_worker_surveys", "thr_worker_surveys"]);
    // The question wraps (up to three lines), it is never one cut line.
    expect(css()).toMatch(/\.radar-ask-question \{[^}]*-webkit-line-clamp: 3;/);
  });

  it("hands an answer to onReply, and opens the thread when there is none", () => {
    const data = botTasksSchema.parse(normalDay());
    const onOpen = vi.fn();
    const onReply = vi.fn();
    const props = { state: { data, status: "ready" as const, cached: false }, activeThreadId: null, isCompactViewport: true, now: NOW, onOpen, onShowThreads: () => {} };
    const { unmount } = render(<BotsView {...props} onReply={onReply} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Answer Yes: opens the chat with it typed in" })[2]!);
    expect(onReply).toHaveBeenCalledWith("thr_ask_iphone", "Yes");
    expect(onOpen).not.toHaveBeenCalled();
    unmount();
    render(<BotsView {...props} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Answer Yes: opens the chat with it typed in" })[0]!);
    expect(onOpen).toHaveBeenCalledWith("thr_worker_surveys");
  });

  it("offers a task's answers only on its own pending interaction", () => {
    const day = normalDay();
    expect(needRows(botTasksSchema.parse(day))[0]!.options).toEqual(["Yes", "Not yet"]);
    day.needs[0]!.interactionId = "int_other";
    expect(needRows(botTasksSchema.parse(day))[0]!.options).toEqual([]);
  });

  it("says plainly when nothing needs Salem", async () => {
    const quiet = normalDay();
    for (const bot of quiet.bots) bot.tasks = bot.tasks.filter(task => task.displayState !== "needs");
    quiet.needs = [];
    renderList(quiet);
    const needs = await screen.findByRole("region", { name: "Needs you" });
    expect(needs.textContent).toBe("Nothing needs you");
    expect(needs.querySelector(".radar-ask")).toBeNull();
  });

  it("groups live work across bots by what is happening, asks not repeated, waits and history folded to a count", async () => {
    renderList(normalDay());
    await screen.findByRole("region", { name: "Now" });
    expect(Array.from(document.querySelectorAll(".radar-band")).map(node => node.getAttribute("data-band"))).toEqual(["stuck", "working", "next", "waiting", "done", "earlier"]);
    expect(feedTitles(band("stuck")!)).toEqual(["Kitchen TV colour fault: root cause", "Multi-WAN bonding (EdgeRouter)"]);
    expect(feedTitles(band("working")!)).toEqual([
      "Move the backend off Replit", "Fable review: deploy window", "Watch our GitHub PRs too",
      "Pool: one stale login can't block Claude workers", "Bots as the only way to run bb", "Kitchen TV: Clean Your TV launcher",
    ]);
    expect(feedTitles(band("next")!)).toEqual(["Survey stress test and video"]);
    // Asks lead the page; they are not rows again.
    expect(feedTitles(document)).not.toContain("Merchant feedback surveys, part 1");
    for (const key of ["waiting", "done", "earlier"]) {
      expect(band(key)!.querySelector("[data-fold]")!.getAttribute("aria-expanded")).toBe("false");
      expect(feedTitles(band(key)!)).toEqual([]);
    }
    expect(band("waiting")!.querySelector(".radar-band-count")!.textContent).toBe("6");
    // A stopped task is never counted as done, and yesterday's finish is not "today".
    expect(band("done")!.querySelector(".radar-band-count")!.textContent).toBe("2 · 1 stopped");
    fireEvent.click(band("done")!.querySelector("[data-fold]")!);
    expect(feedTitles(band("done")!)).toEqual(["Meta ads with the demo offer", "Unused company lines (Orange)", "fe!1024 on iPhone and Android"]);
    expect(feedTitles(band("done")!)).not.toContain("MSSQL database on our host");
  });

  it("names a row's state only when its heading does not already say it", async () => {
    renderList(normalDay());
    const offline = await screen.findByRole("button", { name: /^Multi-WAN bonding \(EdgeRouter\), Home, Offline/ });
    expect(within(offline).getByText("Offline").className).toContain("radar-feed-state-offline");
    const overdue = screen.getByRole("button", { name: /^Kitchen TV colour fault: root cause, Home, Overdue/ });
    expect(overdue.querySelector(".radar-feed-state")).toBeNull();
    expect(within(screen.getByRole("button", { name: /^Pool: one stale login/ })).getByText("Retrying")).toBeTruthy();
    expect(within(screen.getByRole("button", { name: /^Watch our GitHub PRs too/ })).getByText("To check")).toBeTruthy();
    const queued = screen.getByRole("button", { name: /^Survey stress test and video, ERBareeq, Queued/ });
    expect(queued.querySelector(".radar-feed-state")).toBeNull();
    expect(within(queued).getByText("no Opus capacity · retry 14:20")).toBeTruthy();
    // Across bots each row names its bot; the face column keeps one start rail.
    expect(within(queued).getByText("ERBareeq").className).toBe("radar-feed-bot");
    expect(screen.getByRole("button", { name: "Move the backend off Replit, ERBareeq, Working, 1h. Phase 3: Express paths out, installer syncs moved in." })).toBeTruthy();
  });

  it("opens a task's conversation and a worker without a task, and lists Not filed", async () => {
    const { slot } = renderList(normalDay());
    fireEvent.click(await screen.findByRole("button", { name: /^Move the backend off Replit/ }));
    const row = screen.getByRole("button", { name: "Fable review: deploy window, ERBareeq, running, no task" });
    fireEvent.click(row);
    expect(within(screen.getByRole("button", { name: /^Move the backend off Replit/ })).getByText("dev")).toBeTruthy();
    const notFiled = screen.getByRole("region", { name: "Not filed" });
    fireEvent.click(within(notFiled).getByRole("button", { name: /Not filed/ }));
    expect(within(notFiled).getByText("Likely Lab")).toBeTruthy();
    fireEvent.click(within(notFiled).getByText("Untitled plain thread"));
    expect(opened(slot)).toEqual(["thr_task_t_replit", "thr_unlinked_1", "thr_plain_1"]);
  });

  it("refreshes on the bots push signal", async () => {
    let version = 0;
    const { callRpc } = renderList(() => { version += 1; const day = normalDay(); day.bots[2]!.tasks[0]!.title = `Lab v${version}`; return day; });
    await screen.findByText("Lab v1");
    act(() => { window.dispatchEvent(new Event(NEEDS_CHANGED)); });
    await screen.findByText("Lab v2");
    expect(callRpc.mock.calls.filter(([call]) => call.method === "bot_tasks").length).toBeGreaterThanOrEqual(2);
  });

  it("keeps every target phone-sized", () => {
    const sheet = css();
    expect(sheet).toMatch(/\.radar-list-compact \.radar-ask-answer \{ min-height: 44px; \}/);
    expect(sheet).toMatch(/\.radar-list-compact \.radar-band-toggle, \.radar-list-compact \.radar-more \{ min-height: 44px; \}/);
    expect(sheet).toMatch(/\.radar-list-compact \.radar-feed-more \{ width: 44px;/);
    expect(sheet).toMatch(/\.radar-feed-row \{[^}]*min-height: (4[4-9]|5\d)px;/);
  });
});

describe("Bots view: a bot's menu on hold or right-click, its sheet on a tap (Salem, thr_2gjivwx8ea seq 2358)", () => {
  const menuOf = (container: HTMLElement, threadId: string) => container.querySelector<HTMLElement>(`[data-testid="bb-thread-actions-context-menu"][data-thread-id="${threadId}"] [role="menu"]`);
  const hold = (ms: number) => act(() => new Promise(resolve => setTimeout(resolve, ms)));
  const touch = { pointerType: "touch", clientX: 40, clientY: 40 };

  it("opens bb's thread menu for the bot's coordinator on right-click, with Open chat, and no sheet or chat", async () => {
    const navigate = vi.fn();
    const { slot } = renderList(normalDay(), { onNavigate: navigate });
    await screen.findByRole("region", { name: "Bots" });
    fireEvent.contextMenu(desk("Bricks"));
    const menu = menuOf(slot.container, "thr_coord_bricks")!;
    expect(Array.from(menu.querySelectorAll('[role="menuitem"]')).map(node => node.textContent)).toEqual(["Archive", "Delete", "Pin", "Rename", "Open chat"]);
    expect(opened(slot)).toEqual([]);
    expect(slot.container.querySelector(".radar-sheet")).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
    // The coordinator's own actions run on the coordinator, as on its row in Threads.
    fireEvent.click(within(menu).getByRole("menuitem", { name: "Pin" }));
    expect(recordedActions(slot)).toContainEqual({ method: "setPinned", threadId: "thr_coord_bricks", pinned: true });
    fireEvent.contextMenu(desk("Bricks"));
    fireEvent.click(within(menuOf(slot.container, "thr_coord_bricks")!).getByRole("menuitem", { name: "Open chat" }));
    expect(opened(slot)).toEqual(["thr_coord_bricks"]);
    expect(navigate).toHaveBeenCalledOnce();
  });

  it("holds as long as bb's own long-press (700ms in bb 0.48), so a desk answers like a thread row and a slow tap stays a tap", () => {
    expect(LONG_PRESS_MS).toBe(700);
  });

  it("opens the menu on a held touch and swallows the clicks that follow, so the sheet does not toggle under it", async () => {
    const navigate = vi.fn();
    const { slot } = renderList(normalDay(), { compact: true, onNavigate: navigate });
    await screen.findByRole("region", { name: "Bots" });
    // A hold on the character: the lift's clicks reach neither the chat nor the plate.
    fireEvent.pointerDown(chat("Bricks"), touch);
    await hold(LONG_PRESS_MS + 50);
    expect(menuOf(slot.container, "thr_coord_bricks")).toBeTruthy();
    fireEvent.pointerUp(chat("Bricks"), touch);
    fireEvent.click(chat("Bricks"));
    fireEvent.click(plate("Bricks"));
    expect(opened(slot)).toEqual([]);
    expect(navigate).not.toHaveBeenCalled();
    expect(slot.container.querySelector(".radar-sheet")).toBeNull();
    // After a menu pick the next tap starts fresh and opens the sheet (the bug Lab saw live was a 2s "tap").
    fireEvent.click(within(menuOf(slot.container, "thr_coord_bricks")!).getByRole("menuitem", { name: "Rename" }));
    fireEvent.pointerDown(plate("Lab"), touch);
    fireEvent.pointerUp(plate("Lab"), touch);
    fireEvent.click(plate("Lab"));
    expect(screen.getByRole("region", { name: "Lab Bot: work" })).toBeTruthy();
    expect(menuOf(slot.container, "thr_coord_lab")).toBeNull();
    expect(opened(slot)).toEqual([]);
    // And after another pick, a tap on a character opens that chat.
    fireEvent.contextMenu(plate("Home"));
    fireEvent.click(within(menuOf(slot.container, "thr_coord_home")!).getByRole("menuitem", { name: "Pin" }));
    fireEvent.pointerDown(chat("Home"), touch);
    fireEvent.pointerUp(chat("Home"), touch);
    fireEvent.click(chat("Home"));
    expect(opened(slot)).toEqual(["thr_coord_home"]);
    expect(navigate).toHaveBeenCalledOnce();
  });

  it("takes Android's own long-press contextmenu once, and a touch that moves or lifts early stays a scroll or a tap", async () => {
    const { slot } = renderList(normalDay(), { compact: true });
    await screen.findByRole("region", { name: "Bots" });
    const home = plate("Home");
    fireEvent.pointerDown(home, touch);
    fireEvent.contextMenu(home, touch);
    await hold(LONG_PRESS_MS + 50);
    expect(slot.container.querySelectorAll('[data-testid="bb-thread-actions-context-menu"] [role="menu"]')).toHaveLength(1);
    fireEvent.pointerUp(home, touch);
    fireEvent.click(home);
    expect(slot.container.querySelector(".radar-sheet")).toBeNull();
    expect(opened(slot)).toEqual([]);
    cleanup();
    const second = renderList(normalDay(), { compact: true });
    await screen.findByRole("region", { name: "Bots" });
    fireEvent.pointerDown(plate("Work"), touch);
    fireEvent.pointerMove(plate("Work"), { ...touch, clientY: 90 });
    await hold(LONG_PRESS_MS + 50);
    expect(menuOf(second.slot.container, "thr_coord_work")).toBeNull();
    fireEvent.pointerCancel(plate("Work"), touch);
    fireEvent.pointerDown(plate("Work"), touch);
    await hold(LONG_PRESS_MS - 300);
    fireEvent.pointerUp(plate("Work"), touch);
    fireEvent.click(plate("Work"));
    expect(menuOf(second.slot.container, "thr_coord_work")).toBeNull();
    expect(screen.getByRole("region", { name: "Work Bot: work" })).toBeTruthy();
  });

  it("closes a bot's sheet with ×, and opens its chat from the menu", async () => {
    const { slot } = renderList(normalDay(), { compact: true });
    await screen.findByRole("region", { name: "Bots" });
    fireEvent.click(plate("Bricks"));
    fireEvent.click(within(screen.getByRole("region", { name: "Bricks Bot: work" })).getByRole("button", { name: "Close Bricks's work" }));
    expect(screen.queryByRole("region", { name: "Bricks Bot: work" })).toBeNull();
    expect(plate("Bricks").getAttribute("aria-expanded")).toBe("false");
    fireEvent.contextMenu(desk("Home"));
    fireEvent.click(within(menuOf(slot.container, "thr_coord_home")!).getByRole("menuitem", { name: "Open chat" }));
    expect(opened(slot)).toEqual(["thr_coord_home"]);
  });

  it("closes a bot's sheet for good when the bot leaves the roster", async () => {
    let bots = normalDay();
    renderList(() => bots);
    await screen.findByRole("region", { name: "Bots" });
    fireEvent.click(plate("Home"));
    expect(screen.getByRole("region", { name: "Home Bot: work" })).toBeTruthy();
    bots = { ...normalDay(), bots: normalDay().bots.filter(bot => bot.key !== "home") };
    act(() => { window.dispatchEvent(new Event(NEEDS_CHANGED)); });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Open Home Bot chat" })).toBeNull());
    expect(screen.getByRole("region", { name: "Now" })).toBeTruthy();
    bots = normalDay();
    act(() => { window.dispatchEvent(new Event(NEEDS_CHANGED)); });
    await screen.findByRole("button", { name: "Open Home Bot chat" });
    expect(screen.queryByRole("region", { name: "Home Bot: work" })).toBeNull();
  });

  it("says how to reach the menu, blocks text selection and the iOS callout on desks, and offers a keyboard ⋯", async () => {
    const { slot } = renderList(normalDay());
    await screen.findByRole("region", { name: "Bots" });
    expect(screen.getByText("Tap a bot to chat, its name for its work · hold for more")).toBeTruthy();
    expect(screen.getByText("Click a bot to chat, its name for its work · right-click for more")).toBeTruthy();
    expect(css()).toMatch(/\.radar-room \{ -webkit-touch-callout: none; -webkit-user-select: none; user-select: none; \}/);
    expect(css()).toMatch(/\.radar-desk-chat, \.radar-desk-front \{ touch-action: manipulation;/);
    fireEvent.click(screen.getByRole("button", { name: "More for ERBareeq Bot" }));
    expect(menuOf(slot.container, "thr_coord_erbareeq")).toBeTruthy();
    expect(opened(slot)).toEqual([]);
  });
});

describe("Bots view: the crew board's rules", () => {
  it("gives each bot one line from its most urgent open state", () => {
    const data = botTasksSchema.parse(normalDay());
    const status = (key: string) => crewStatus(layoutBot(data.bots.find(bot => bot.key === key)!, NOW));
    expect(status("erbareeq")).toEqual({ tone: "ask", count: 2, label: "2 for you" });
    expect(status("lab")).toEqual({ tone: "busy", count: 2, label: "2 working" });
    expect(status("home")).toEqual({ tone: "trouble", count: 1, label: "1 overdue" });
    expect(status("personal")).toEqual({ tone: "quiet", count: 0, label: "Quiet" });
    const one = botTasksSchema.parse({ ...normalDay(), bots: [{ ...normalDay().bots[1]!, tasks: [makeTask("bricks", "a", "needs")] }] }).bots[0]!;
    expect(crewStatus(layoutBot(one, NOW)).label).toBe("1 for you");
  });

  it("drops empty bands and keeps closed work newest first", () => {
    const data = botTasksSchema.parse(normalDay());
    const personal = layoutBot(data.bots.find(bot => bot.key === "personal")!, NOW);
    expect(feedBands([personal])).toEqual([]);
    const work = layoutBot(data.bots.find(bot => bot.key === "work")!, NOW);
    expect(feedBands([work]).map(item => item.key)).toEqual(["earlier"]);
  });
});

describe("Bots view under load", () => {
  it("handles the 44-task peak: every open task is an ask, a row, or counted in the waiting fold", async () => {
    const peak = peakDay();
    expect(peak.bots.reduce((sum, bot) => sum + bot.tasks.length, 0)).toBe(44);
    const started = performance.now();
    const { slot } = renderList(peak);
    const needs = await screen.findByRole("region", { name: "Needs you" });
    const asks = Number(needs.querySelector(".radar-section-count")!.textContent);
    const rows = slot.container.querySelectorAll(".radar-now .radar-feed-row").length;
    const waiting = Number(band("waiting")!.querySelector(".radar-band-count")!.textContent);
    expect(asks + rows + waiting).toBe(44);
    expect(asks).toBe(8);
    expect(performance.now() - started).toBeLessThan(2_000);
  });

  it("puts all ten decisions one tap from the phone drawer", async () => {
    const navigate = vi.fn();
    const { slot } = renderList(tenDecisions(), { compact: true, onNavigate: navigate });
    const needs = await screen.findByRole("region", { name: "Needs you" });
    const rows = Array.from(needs.querySelectorAll<HTMLButtonElement>(".radar-ask-open"));
    expect(rows).toHaveLength(10);
    expect(within(needs).queryByText(/more ask/)).toBeNull();
    for (const row of rows) fireEvent.click(row);
    // Opening the drawer is tap one; each decision is tap two, landing on its own thread.
    expect(opened(slot)).toEqual(["thr_dec_3", "thr_dec_4", "thr_dec_5", "thr_dec_0", "thr_dec_1", "thr_dec_2", "thr_dec_8", "thr_dec_9", "thr_dec_6", "thr_dec_7"]);
    expect(navigate).toHaveBeenCalledTimes(10);
    expect(screen.getByRole("button", { name: "Bots, 10 need you" })).toBeTruthy();
  });

  it("reaches all ten on a desktop in one click, and keeps focus on the first ask it revealed", async () => {
    renderList(tenDecisions());
    const needs = await screen.findByRole("region", { name: "Needs you" });
    expect(needs.querySelectorAll(".radar-ask")).toHaveLength(3);
    fireEvent.click(within(needs).getByRole("button", { name: "7 more asks" }));
    expect(needs.querySelectorAll(".radar-ask")).toHaveLength(10);
    expect((document.activeElement as HTMLElement).textContent).toContain("Is the iPhone connected to the Mac?");
    fireEvent.click(within(needs).getByRole("button", { name: "Show fewer" }));
    expect(needs.querySelectorAll(".radar-ask")).toHaveLength(3);
  });
});

describe("Bots view: RTL and long titles", () => {
  it("isolates every title, detail and question with dir=auto", async () => {
    const { slot } = renderList(rtlAndEmpty());
    await screen.findByRole("region", { name: "Now" });
    fireEvent.click(band("waiting")!.querySelector("[data-fold]")!);
    const nodes = Array.from(slot.container.querySelectorAll(".radar-feed-title, .radar-feed-detail, .radar-ask-question, .radar-ask-task"));
    expect(nodes.length).toBe(6);
    for (const node of nodes) {
      expect(node.tagName).toBe("BDI");
      expect(node.getAttribute("dir")).toBe("auto");
    }
    const rtl = slot.container.querySelector('[data-task-id="t_rtl"] .radar-feed-title')!;
    expect(rtl.textContent!.length).toBeGreaterThan(150);
    expect(css()).toMatch(/\.radar-feed-title \{[^}]*text-overflow: ellipsis;[^}]*white-space: nowrap;[^}]*unicode-bidi: isolate;/);
    // English counts keep their order in an RTL page ("1 needs you", not "needs you 1").
    expect(css()).toMatch(/\.radar-desk-status, [^{]*\{ unicode-bidi: plaintext; \}/);
    // Separators are their own elements, so they sit between parts whatever each part's direction.
    expect(slot.container.querySelector(".radar-ask-who .radar-sep")).toBeTruthy();
  });
});

describe("Bots view without bot_tasks", () => {
  it("says so in one line with a way to Threads when the core is older", async () => {
    const { slot } = renderList(new Error('HTTP 404: plugin "orchestrator-mode" has no rpc method "bot_tasks"'));
    const status = await screen.findByText(/This bots core has no task list yet/);
    expect(status.closest('[role="status"]')).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Show threads" }));
    await waitFor(() => expect(rowIds(slot.container)).toContain("plain"));
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Threads" }));
  });

  it("never shows a blank list while loading or after a transient failure", async () => {
    renderList(new Error("fetch failed"));
    expect(await screen.findByText("Bot tasks didn't load. Retrying automatically.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Show threads" })).toBeTruthy();
  });

  it("keeps the last tasks on a transient failure and says how old they are", async () => {
    let fail = false;
    renderList(() => { if (fail) throw new Error("fetch failed"); return normalDay(); });
    await screen.findByRole("region", { name: "Bots" });
    fail = true;
    act(() => { window.dispatchEvent(new Event(NEEDS_CHANGED)); });
    expect(await screen.findByText(/^As of .*Retrying\.$/)).toBeTruthy();
    expect(screen.getByRole("region", { name: "Bots" })).toBeTruthy();
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

describe("Bots view: dates and waits", () => {
  it("shows a night completion under Done today with the local day, not the server's UTC date", async () => {
    const local = new Date(NOW); local.setHours(0, 30, 0, 0);
    const day = normalDay();
    day.bots[2]!.tasks.push({ ...day.bots[2]!.tasks[0]!, id: "t_night", title: "Night job", displayState: "done", line: `Done ${local.toISOString().slice(0, 10)}`, completedAt: local.getTime() });
    renderList(day);
    await screen.findByRole("region", { name: "Now" });
    fireEvent.click(band("done")!.querySelector("[data-fold]")!);
    const row = within(band("done")!).getByRole("button", { name: /^Night job, Lab, Done, / });
    expect(row.textContent).not.toContain(local.toISOString().slice(0, 10));
  });

  it("shows what a waiting task waits for, not only whom", () => {
    expect(waitingLine({ line: "Waiting for the bot: Kitchen TV standby wakes with Wake on Wi-Fi off · wakes 09:00", waitFor: "the bot" }))
      .toBe("Kitchen TV standby wakes with Wake on Wi-Fi off · wakes 09:00");
    expect(waitingLine({ line: "Waiting for Mohamed Omar: the reconciliation file · no wake set", waitFor: "Mohamed Omar" }))
      .toBe("Mohamed Omar: the reconciliation file · no wake set");
    expect(waitingLine({ line: "", waitFor: "Islam" })).toBe("Waiting for Islam");
    expect(waitingLine({ line: "", waitFor: undefined })).toBe("Waiting");
    expect(waitingLine({ line: "Blocked until the host returns", waitFor: "the bot" })).toBe("Blocked until the host returns");
  });

  it("says 'no date' for a wait on the bot with no wake (Salem, 2026-10-29)", async () => {
    renderList(normalDay());
    await screen.findByRole("region", { name: "Now" });
    fireEvent.click(band("waiting")!.querySelector("[data-fold]")!);
    const row = screen.getByRole("button", { name: /^Kitchen TV standby, Home, Waiting for the bot, 2h/ });
    expect(within(row).getByText("no date")).toBeTruthy();
    expect(within(screen.getByRole("button", { name: /^Chat · Islam · login code, ERBareeq, Waiting for Islam, 1h/ })).getByText("Islam")).toBeTruthy();
    expect(rowDetail(makeTask("x", "a", "waiting", { waitFor: "the bot", wakeAt: NOW + 3_600_000 }), NOW)).not.toBe("no date");
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
    expect(rowStateWord(makeTask("x", "a", "done", { line: "Done 2026-10-28 · 62 lines matched", completedAt: NOW }), NOW)).toBe("Done today");
    expect(rowStateWord(makeTask("x", "a", "done", { line: "Done 29 Oct", completedAt: NOW }), NOW)).toBe("Done today");
    expect(rowDetail(makeTask("x", "a", "done", { line: "Done 29 Oct · 62 lines matched", completedAt: NOW }), NOW)).toBe("62 lines matched");
    expect(rowStateWord(makeTask("x", "a", "done", { line: "62 lines matched", completedAt: NOW }), NOW)).toBe("Done");
    expect(rowStateWord(makeTask("x", "a", "stopped", { line: "Stopped by Salem", completedAt: NOW }), NOW)).toBe("Stopped");
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

describe("Bots view: nothing vanishes, workers as a task's attempts (Salem, thr_g9gsfjxfyx)", () => {
  const attemptLabels = (scope: HTMLElement) => Array.from(scope.querySelectorAll(".radar-task-attempt")).map(node => node.getAttribute("aria-label"));

  it("keeps closed work from earlier this week, folded with its count, with the day in the age column", async () => {
    renderList(normalDay());
    await screen.findByRole("region", { name: "Now" });
    const earlier = band("earlier")!;
    expect(earlier.querySelector(".radar-band-count")!.textContent).toBe("5");
    fireEvent.click(earlier.querySelector("[data-fold]")!);
    expect(feedTitles(earlier)).toEqual(["MSSQL database on our host", "Expense report for October", "Orange lines: September invoice check", "Warranty QR relabel for Yasser", "Instagram views report"]);
    expect(within(earlier).getByRole("button", { name: /^Instagram views report, ERBareeq, Stopped, Thu\b/ })).toBeTruthy();
    expect(within(earlier).getByRole("button", { name: /^Orange lines: September invoice check, ERBareeq, Done, Sat\b/ })).toBeTruthy();
    // A quiet bot's week is there too: Work's October expense report.
    expect(within(earlier).getByRole("button", { name: /^Expense report for October, Work, Done, / })).toBeTruthy();
  });

  it("lists a task's attempts newest first with model, effort and times, each opening its thread; the row still opens the latest", async () => {
    const { slot, callRpc } = renderList(normalDay());
    await screen.findByRole("region", { name: "Now" });
    fireEvent.click(screen.getByRole("button", { name: "Show details: Move the backend off Replit" }));
    const details = await screen.findByRole("region", { name: "Move the backend off Replit: details" });
    await waitFor(() => expect(attemptLabels(details)).toHaveLength(3));
    expect(callRpc).toHaveBeenCalledWith(expect.objectContaining({ method: "task_detail", input: { taskId: "t_replit" } }));
    expect(attemptLabels(details)).toEqual([
      expect.stringMatching(/^Replit move: phase 3, installer syncs, Running, gpt-6\.1-sol · xhigh, Started \S+( [AP]M)?, latest attempt$/),
      expect.stringMatching(/^Replit move: phase 2 \(retry after outage\), Ended, claude-opus-5-5 · medium, \S+( [AP]M)? · ended \S+( [AP]M)?$/),
      expect.stringMatching(/^Replit move: phase 1, Express paths, Ended, gpt-6\.1-sol · high, \S+( [AP]M)? · ended \S+( [AP]M)?$/),
    ]);
    fireEvent.click(within(details).getAllByRole("button")[2]!);
    expect(opened(slot)).toEqual(["thr_replit_a1"]);
    fireEvent.click(screen.getByRole("button", { name: /^Move the backend off Replit, ERBareeq, Working/ }));
    expect(opened(slot)).toEqual(["thr_replit_a1", "thr_task_t_replit"]);
    // Only one task's details are open at a time; the toggle closes its own.
    fireEvent.click(screen.getByRole("button", { name: "Show details: Survey stress test and video" }));
    expect(screen.queryByRole("region", { name: "Move the backend off Replit: details" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Hide details: Survey stress test and video" }));
    expect(screen.queryByRole("region", { name: /: details$/ })).toBeNull();
  });

  it("shows a task the bot did itself as one attempt from its conversation", async () => {
    renderList(normalDay());
    await screen.findByRole("region", { name: "Now" });
    fireEvent.click(band("done")!.querySelector("[data-fold]")!);
    fireEvent.click(screen.getByRole("button", { name: "Show details: Unused company lines (Orange)" }));
    const details = await screen.findByRole("region", { name: "Unused company lines (Orange): details" });
    await waitFor(() => expect(attemptLabels(details)).toHaveLength(1));
    expect(attemptLabels(details)[0]).toMatch(/^Unused company lines \(Orange\), Ended, \S+( [AP]M)? · ended \S+( [AP]M)?, latest attempt$/);
    expect(within(details).getByText(/finished/)).toBeTruthy();
  });

  it("says so when the core has no task_detail, or the read fails, and still offers the latest attempt", async () => {
    const { slot } = renderList(normalDay(), { detail: "missing" });
    await screen.findByRole("region", { name: "Now" });
    fireEvent.click(screen.getByRole("button", { name: "Show details: Move the backend off Replit" }));
    const details = await screen.findByRole("region", { name: "Move the backend off Replit: details" });
    await within(details).findByText("This core doesn't list attempts yet; only the latest is known.");
    expect(attemptLabels(details)).toEqual([expect.stringMatching(/^Replit move: phase 3, installer syncs, Running, Started .*, latest attempt$/)]);
    fireEvent.click(within(details).getByRole("button"));
    expect(opened(slot)).toEqual(["thr_task_t_replit"]);
    cleanup();
    resetTaskAttempts();
    renderList(normalDay(), { detail: "error" });
    await screen.findByRole("region", { name: "Now" });
    fireEvent.click(screen.getByRole("button", { name: "Show details: Move the backend off Replit" }));
    await screen.findByText("Attempts didn't load; only the latest is known.");
  });

  it("works on a phone: the details toggle is its own target beside each row", async () => {
    const { slot } = renderList(normalDay(), { compact: true });
    await screen.findByRole("region", { name: "Now" });
    const toggle = screen.getByRole("button", { name: "Show details: Move the backend off Replit" });
    expect(toggle.closest(".radar-feed-rowline")).toBeTruthy();
    expect(toggle.classList.contains("radar-feed-more")).toBe(true);
    expect(slot.container.querySelector(".radar-list-compact")).toBeTruthy();
    fireEvent.click(toggle);
    expect(await screen.findByRole("region", { name: "Move the backend off Replit: details" })).toBeTruthy();
  });

  it("shows a worker started while the details are open on the next bots refresh, with one task_detail per refresh (Fable, thr_kekmhnwp6p)", async () => {
    let observedAt = NOW;
    const { callRpc } = renderList(() => ({ ...normalDay(), observedAt }));
    await screen.findByRole("region", { name: "Now" });
    fireEvent.click(screen.getByRole("button", { name: "Show details: Move the backend off Replit" }));
    const details = await screen.findByRole("region", { name: "Move the backend off Replit: details" });
    await waitFor(() => expect(attemptLabels(details)).toHaveLength(3));
    const detailCalls = () => callRpc.mock.calls.filter(([call]) => call.method === "task_detail").length;
    const botTasksCalls = () => callRpc.mock.calls.filter(([call]) => call.method === "bot_tasks").length;
    expect(detailCalls()).toBe(1);
    const original = callRpc.getMockImplementation()!;
    callRpc.mockImplementation(async (args: { method: string; input?: unknown }) => {
      if (args.method !== "task_detail") return original(args);
      const found = taskDetails().t_replit;
      return { ...found, workers: [...found.workers, { threadId: "thr_replit_a3", title: "Replit move: phase 4, cutover", model: null, effort: null, state: "running" }] };
    });
    const before = botTasksCalls();
    act(() => { window.dispatchEvent(new Event(NEEDS_CHANGED)); });
    await waitFor(() => expect(botTasksCalls()).toBe(before + 1));
    await act(async () => { await Promise.resolve(); });
    expect(detailCalls()).toBe(1);
    observedAt = NOW + 60_000;
    act(() => { window.dispatchEvent(new Event(NEEDS_CHANGED)); });
    await waitFor(() => expect(attemptLabels(details)).toHaveLength(4));
    expect(detailCalls()).toBe(2);
    expect(attemptLabels(details)[3]).toMatch(/^Replit move: phase 4, cutover, Running/);
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

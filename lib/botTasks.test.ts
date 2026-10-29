import { describe, expect, it } from "vitest";
import { botTasksSchema, isSameLocalDay, layoutBot, localizeDoneLine, needRows, orderedBots, shortModel, taskAttempts, taskDetailSchema } from "./botTasks";
import { DAY, HOUR, NOW } from "@/components/radar/fixtures";
import { BOT_SEEDS, attemptThreads, makeBot, makeOutput, makeTask, normalDay, taskDetails } from "@/components/radar/botTasksFixtures";

describe("bot_tasks parsing", () => {
  it("accepts the contract shape", () => {
    expect(botTasksSchema.parse(normalDay()).bots).toHaveLength(6);
  });

  it("keeps an unknown state visible as open work and drops only a malformed row", () => {
    const day = makeOutput([makeBot(BOT_SEEDS[0]!, [makeTask("erbareeq", "Fine", "working")])]);
    const tasks = day.bots[0]!.tasks as unknown[];
    tasks.push({ id: "future", title: "From a newer core", displayState: "paused-by-host" }, { title: "no id" });
    const parsed = botTasksSchema.parse(day);
    expect(parsed.bots[0]!.tasks.map(task => [task.title, task.displayState])).toEqual([["Fine", "working"], ["From a newer core", "ready"]]);
  });

  it("fills defaults for an older core's lighter rows", () => {
    const parsed = botTasksSchema.parse({ bots: [{ key: "home", name: "Home Bot", coordinatorThreadId: "c", tasks: [{ id: "t", displayState: "waiting" }] }] });
    expect(parsed.bots[0]).toMatchObject({ order: 0, tasksV2: false, unlinked: [], tasks: [{ title: "", tags: [], conversationThreadId: null, origin: "unverified" }] });
    expect(parsed.needs).toEqual([]);
    expect(parsed.notFiled).toEqual([]);
  });
});

describe("contract sync with core 36fb0ce", () => {
  it("accepts the additive fields and still strips unknown keys", () => {
    const day = makeOutput([makeBot(BOT_SEEDS[3]!, [makeTask("home", "Wake", "waiting", { wakeAt: NOW + HOUR, retryAt: NOW + 2 * HOUR })])]);
    const raw = JSON.parse(JSON.stringify(day));
    raw.bots[0].tasks[0].fromTheFuture = true;
    raw.bots[0].surprise = 1;
    const parsed = botTasksSchema.parse(raw);
    expect(parsed.bots[0]!.summary.notStarted).toBe(0);
    expect(parsed.bots[0]!.tasks[0]).toMatchObject({ wakeAt: NOW + HOUR, retryAt: NOW + 2 * HOUR });
    expect(parsed.bots[0]!.tasks[0]).not.toHaveProperty("fromTheFuture");
    expect(parsed.bots[0]).not.toHaveProperty("surprise");
  });
});

describe("fold rules", () => {
  it("orders open work by urgency and folds waiting after three", () => {
    const bot = botTasksSchema.parse(makeOutput([makeBot(BOT_SEEDS[1]!, [
      makeTask("bricks", "w1", "waiting"), makeTask("bricks", "w2", "waiting"), makeTask("bricks", "q", "queued"),
      makeTask("bricks", "w3", "waiting"), makeTask("bricks", "w4", "waiting"), makeTask("bricks", "o", "overdue"),
      makeTask("bricks", "n", "needs"), makeTask("bricks", "k", "working"), makeTask("bricks", "off", "offline"),
    ])])).bots[0]!;
    const layout = layoutBot(bot, NOW);
    expect(layout.needs.map(task => task.title)).toEqual(["n"]);
    expect(layout.active.map(task => task.title)).toEqual(["o", "off", "k", "q"]);
    expect(layout.waitingShown.map(task => task.title)).toEqual(["w1", "w2", "w3"]);
    expect(layout.waitingFolded.map(task => task.title)).toEqual(["w4"]);
    expect(layout.quiet).toBe(false);
    expect(layout.summary).toBe("1 for you · 1 overdue · 1 offline · 1 working · 1 queued · 4 waiting");
  });

  it("never counts a result waiting for the bot's check as working (Salem's status pass, 2026-10-29)", () => {
    const bot = botTasksSchema.parse(makeOutput([makeBot(BOT_SEEDS[1]!, [makeTask("bricks", "c", "checking"), makeTask("bricks", "w", "waiting")])])).bots[0]!;
    expect(layoutBot(bot, NOW).summary).toBe("1 to check · 1 waiting");
  });

  it("counts a completion as today only on the same local calendar day", () => {
    const midnight = new Date(NOW); midnight.setHours(0, 0, 0, 0);
    expect(isSameLocalDay(midnight.getTime(), NOW)).toBe(true);
    expect(isSameLocalDay(midnight.getTime() - 1, NOW)).toBe(false);
    const bot = botTasksSchema.parse(makeOutput([makeBot(BOT_SEEDS[0]!, [
      makeTask("erbareeq", "today", "done", { completedAt: midnight.getTime() + 1 }),
      makeTask("erbareeq", "late yesterday", "done", { completedAt: midnight.getTime() - 1 }),
      makeTask("erbareeq", "no date", "done"),
      makeTask("erbareeq", "stopped now", "stopped", { completedAt: NOW - HOUR }),
    ])])).bots[0]!;
    const layout = layoutBot(bot, NOW);
    expect(layout.closedToday.map(task => task.title)).toEqual(["stopped now", "today"]);
    expect(layout.quiet).toBe(true);
    expect(layout.summary).toBe("quiet · 2 done today");
  });

  it("lists decisions in roster order, keeping plain needs tasks", () => {
    const day = normalDay();
    day.bots.reverse();
    day.needs = day.needs.filter(item => item.taskId !== "t_brk42");
    const data = botTasksSchema.parse(day);
    expect(orderedBots(data).map(bot => bot.key)).toEqual(["erbareeq", "bricks", "lab", "home", "personal", "work"]);
    expect(needRows(data).map(row => [row.botKey, row.question, row.threadId])).toEqual([
      ["erbareeq", "Merge and deploy dark, flag off?", "thr_worker_surveys"],
      ["erbareeq", "Send one voice note in each app so I can confirm?", "thr_ask_voice"],
      ["bricks", "Is the iPhone connected to the Mac?", "thr_ask_iphone"],
      ["bricks", "Open the MR for Yasser?", "thr_ask_brk42"],
    ]);
  });
});

describe("live qualification on Lab (thr_g9gsfjxfyx, 2026-10-29)", () => {
  it("calls a legacy ready task not started, never queued", () => {
    const bot = botTasksSchema.parse(makeOutput([makeBot(BOT_SEEDS[3]!, [
      makeTask("home", "Filed", "ready", { line: "Filed. Not started." }), makeTask("home", "Held", "queued"),
    ])])).bots[0]!;
    expect(layoutBot(bot, NOW).summaryParts).toEqual(["1 queued", "1 not started"]);
  });

  it("rewrites a server's UTC Done date into the device's local day", () => {
    // 00:30 BST on the fixture day is 23:30 UTC the day before: a UTC formatter says the previous date.
    const local = new Date(NOW); local.setHours(0, 30, 0, 0);
    const utcDate = new Date(local.getTime()).toISOString().slice(0, 10);
    const task = botTasksSchema.parse(makeOutput([makeBot(BOT_SEEDS[2]!, [
      makeTask("lab", "Night job", "done", { line: `Done ${utcDate} · TLS fix`, completedAt: local.getTime() }),
    ])])).bots[0]!.tasks[0]!;
    expect(utcDate).not.toBe(`${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, "0")}-${String(local.getDate()).padStart(2, "0")}`);
    expect(localizeDoneLine(task, NOW)).toBe("Done today · TLS fix");
    const yesterday = { ...task, line: "Done 2026-09-19", completedAt: local.getTime() - DAY };
    expect(localizeDoneLine(yesterday, NOW)).toMatch(/^Done (20 Sept|Sep 20|20 Sep)$/);
    expect(localizeDoneLine({ ...task, line: "Checks passed" }, NOW)).toBe("Checks passed");
  });
});

describe("a week of closed work and a task's attempts (Salem, thr_g9gsfjxfyx: nothing vanishes)", () => {
  it("files closed rows before today, or undated, under earlier this week, newest first", () => {
    const bot = makeBot(BOT_SEEDS[0]!, [
      makeTask("erbareeq", "Today", "done", { completedAt: NOW - HOUR }),
      makeTask("erbareeq", "Yesterday", "done", { completedAt: NOW - DAY }),
      makeTask("erbareeq", "Last week", "stopped", { completedAt: NOW - 6 * DAY }),
      makeTask("erbareeq", "Undated", "cancelled"),
      makeTask("erbareeq", "Open", "working"),
    ]);
    const layout = layoutBot(botTasksSchema.parse(makeOutput([bot])).bots[0]!, NOW);
    expect(layout.closedToday.map(task => task.title)).toEqual(["Today"]);
    expect(layout.closedEarlier.map(task => task.title)).toEqual(["Yesterday", "Last week", "Undated"]);
    expect(layout.active.map(task => task.title)).toEqual(["Open"]);
    expect(layout.quiet).toBe(false);
  });

  it("parses task_detail with defaults for a lighter core and strips what it does not read", () => {
    const parsed = taskDetailSchema.parse({ taskId: "t", outcome: "x", checks: [{ criterion: "c", status: "pass" }], wait: null, workers: [{ threadId: "w" }], history: [], conversation: null });
    expect(parsed).toEqual({ taskId: "t", outcome: "x", workers: [{ threadId: "w", title: "", model: null, effort: null, state: "unknown" }], history: [], conversation: null });
  });

  it("orders attempts by their threads' start, newest first, and by the latest then the core's reverse order without times", () => {
    const detail = taskDetailSchema.parse(taskDetails().t_replit);
    const timed = taskAttempts({ conversationThreadId: "thr_task_t_replit" }, detail, attemptThreads());
    expect(timed.map(attempt => [attempt.threadId, attempt.state, attempt.latest])).toEqual([
      ["thr_task_t_replit", "running", true], ["thr_replit_a2", "idle", false], ["thr_replit_a1", "idle", false],
    ]);
    expect(timed[0]).toMatchObject({ model: "codex/gpt-6.1-sol", effort: "xhigh", startedAt: NOW - HOUR, endedAt: null });
    expect(timed[1]).toMatchObject({ startedAt: NOW - 3 * HOUR - 30 * 60_000, endedAt: NOW - 2 * HOUR });
    const untimed = taskAttempts({ conversationThreadId: "thr_replit_a1" }, detail);
    expect(untimed.map(attempt => attempt.threadId)).toEqual(["thr_replit_a1", "thr_replit_a2", "thr_task_t_replit"]);
    expect(untimed[0]).toMatchObject({ startedAt: null, endedAt: null, state: "idle", latest: true });
  });

  it("orders attempts deterministically when threads.list answers only some: timed newest first, then untimed with the latest leading (Fable, thr_kekmhnwp6p)", () => {
    const detail = taskDetailSchema.parse(taskDetails().t_replit);
    const some = attemptThreads().filter(thread => thread.id !== "thr_replit_a2");
    // The latest (the conversation) has no time; an older worker does.
    const partial = taskAttempts({ conversationThreadId: "thr_replit_a2" }, detail, some);
    expect(partial.map(attempt => [attempt.threadId, attempt.latest])).toEqual([
      ["thr_task_t_replit", false], ["thr_replit_a1", false], ["thr_replit_a2", true],
    ]);
    // The same answer in any order of threads gives the same list.
    expect(taskAttempts({ conversationThreadId: "thr_replit_a2" }, detail, [...some].reverse())).toEqual(partial);
    const extra = taskDetailSchema.parse({ ...taskDetails().t_replit, workers: [...taskDetails().t_replit.workers, { threadId: "thr_new", title: "New" }] });
    const mixed = taskAttempts({ conversationThreadId: "thr_task_t_replit" }, extra, attemptThreads().filter(thread => thread.id === "thr_replit_a1" || thread.id === "thr_task_t_replit"));
    expect(mixed.map(attempt => attempt.threadId)).toEqual(["thr_task_t_replit", "thr_replit_a1", "thr_new", "thr_replit_a2"]);
    expect(mixed.filter(attempt => attempt.latest).map(attempt => attempt.threadId)).toEqual(["thr_task_t_replit"]);
  });

  it("falls back to the task's conversation as its one attempt when the detail lists no worker or is unavailable", () => {
    const own = taskAttempts({ conversationThreadId: "thr_task_t_orange" }, taskDetailSchema.parse(taskDetails().t_orange), attemptThreads());
    expect(own).toEqual([{ threadId: "thr_task_t_orange", title: "Unused company lines (Orange)", model: null, effort: null, state: "idle", startedAt: NOW - 5 * HOUR, endedAt: NOW - 2 * HOUR, latest: true }]);
    expect(taskAttempts({ conversationThreadId: "thr_x" }, null)).toEqual([{ threadId: "thr_x", title: "Worker", model: null, effort: null, state: "unknown", startedAt: null, endedAt: null, latest: true }]);
    expect(taskAttempts({ conversationThreadId: null }, null)).toEqual([]);
    expect(shortModel("codex/gpt-6.1-sol")).toBe("gpt-6.1-sol");
    expect(shortModel(null)).toBe("");
  });
});

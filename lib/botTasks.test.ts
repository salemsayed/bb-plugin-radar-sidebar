import { describe, expect, it } from "vitest";
import { botTasksSchema, isSameLocalDay, layoutBot, localizeDoneLine, needRows, orderedBots } from "./botTasks";
import { DAY, HOUR, NOW } from "@/components/radar/fixtures";
import { BOT_SEEDS, makeBot, makeOutput, makeTask, normalDay } from "@/components/radar/botTasksFixtures";

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


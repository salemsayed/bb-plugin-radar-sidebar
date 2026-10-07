import { describe, expect, it } from "vitest";
import { makeThread, MINUTE, NOW, HOUR } from "./fixtures";
import { arrangeCrew, withoutListedAsks, crewChapters, crewFeed, crewRow, jobsByBot, startOfToday, shortAgo, shortAutomationName, watchInterval, type CrewAutomation } from "./crew";
import type { RosterBot } from "./bots";

const bot = (key: string, projectId = `proj_${key}`): RosterBot =>
  ({ key, name: `${key[0]!.toUpperCase()}${key.slice(1)} Bot`, current: `coord_${key}`, projectId, projects: [], hostId: "host_1", providerId: "pi", model: "m", rollover: null });
const automation = (fields: Partial<CrewAutomation> & { name: string }): CrewAutomation => ({
  id: fields.name, projectId: "proj_bricks", enabled: true, trigger: { triggerType: "schedule", cron: "0 9 * * *" },
  execution: null, nextRunAt: null, lastRunAt: null, lastRunStatus: null, lastRunThreadId: null, lastError: null, ...fields,
});
const row = (args: Partial<Parameters<typeof crewRow>[0]> & { bot: RosterBot }) =>
  crewRow({ threads: [], pulse: null, automations: [], now: NOW, ...args });
const reply = (subject: string, decision: string | null = null) => ({ subject, decision, quiet: false });

describe("crew row", () => {
  it("keeps a read decision as the bot's line until the coordinator replies again", () => {
    const work = bot("work");
    const coordinator = makeThread({ id: work.current, latestAttentionAt: NOW - HOUR });
    const pulse = reply("Omarchy update succeeded", "reboot salem-pc when convenient.");
    expect(row({ bot: work, threads: [coordinator], pulse })).toMatchObject({
      more: 0,
      line: { tone: "ask", text: "Reboot salem-pc when convenient.", threadId: work.current, at: NOW - HOUR },
    });
    expect(row({ bot: work, threads: [{ ...coordinator, status: "active" }], pulse }).line).toMatchObject({
      tone: "running", text: "Thinking", threadId: work.current,
    });
  });

  it("uses Jev's judgement of the same reply when there is no Decision needed line", () => {
    const personal = bot("personal");
    const coordinator = makeThread({ id: personal.current, latestAttentionAt: NOW - HOUR });
    const pulse = reply("Tickets are EGP 800 each.");
    const judgement = (fields: object) => ({ threadId: personal.current, version: NOW - HOUR, waiting: 0.9, ask: "should I book two for Saturday?", ...fields });
    expect(row({ bot: personal, threads: [coordinator], pulse, judgement: judgement({}) }).line)
      .toMatchObject({ tone: "ask", text: "Should I book two for Saturday?", threadId: personal.current });
    expect(row({ bot: personal, threads: [coordinator], pulse, judgement: judgement({ ask: null }) }).line.text).toBe("Tickets are EGP 800 each.");
    // An older reply's verdict, a low probability, an unavailable Jev or a live coordinator never count.
    for (const stale of [judgement({ version: NOW - 2 * HOUR }), judgement({ waiting: 0.3 }), judgement({ waiting: null })]) {
      expect(row({ bot: personal, threads: [coordinator], pulse, judgement: stale }).line.tone).toBe("quiet");
    }
    expect(row({ bot: personal, threads: [{ ...coordinator, status: "active" }], pulse, judgement: judgement({}) }).line.tone).toBe("running");
    // The bot's own marker wins over Jev's pick.
    expect(row({ bot: personal, threads: [coordinator], pulse: reply("Done", "go to post it?"), judgement: judgement({ waiting: 0.1 }) }).line.text).toBe("Go to post it?");
  });

  it("puts failures ahead of questions and counts the rest", () => {
    const bricks = bot("bricks");
    const threads = [
      makeThread({ id: bricks.current }),
      makeThread({ id: "ask", parentThreadId: bricks.current, title: "Approve deploy", hasPendingInteraction: true, latestAttentionAt: NOW }),
      makeThread({ id: "boom", lifecycleOwnerThreadId: bricks.current, title: "Sync", indicator: "unread-error", isUnread: true, status: "error", latestAttentionAt: NOW - HOUR }),
      makeThread({ id: "run", parentThreadId: bricks.current, status: "active" }),
    ];
    expect(row({ bot: bricks, threads })).toMatchObject({ more: 1, line: { tone: "failed", text: "Sync failed", threadId: "boom" } });
  });

  it("shows the newest running job and how many more are running", () => {
    const bricks = bot("bricks");
    const threads = [
      makeThread({ id: bricks.current }),
      makeThread({ id: "old", parentThreadId: bricks.current, status: "active", createdAt: NOW - HOUR }),
      makeThread({ id: "new", parentThreadId: bricks.current, title: "Review fe!974", status: "active", createdAt: NOW - 3 * MINUTE }),
      makeThread({ id: "hidden", parentThreadId: bricks.current, status: "active", isHidden: true }),
      makeThread({ id: "archived", parentThreadId: bricks.current, status: "active", isArchived: true }),
      makeThread({ id: "elsewhere", status: "active" }),
    ];
    expect(row({ bot: bricks, threads })).toMatchObject({
      more: 1, line: { tone: "running", text: "Review fe!974", threadId: "new", at: NOW - 3 * MINUTE },
    });
  });

  it("falls back to the latest reply, bold only while unread", () => {
    const personal = bot("personal");
    const pulse = reply("Inbox rules updated");
    expect(row({ bot: personal, threads: [makeThread({ id: personal.current, isUnread: true })], pulse }).line).toMatchObject({ tone: "new", text: "Inbox rules updated" });
    expect(row({ bot: personal, threads: [makeThread({ id: personal.current })], pulse }).line.tone).toBe("quiet");
  });

  it("flags failing and stalled automations, and nothing while they are healthy", () => {
    const bricks = bot("bricks");
    const threads = [makeThread({ id: bricks.current })];
    const gate = { name: "Bricks Bot: GitLab activity gate", trigger: { triggerType: "schedule", cron: "*/10 * * * *" } };
    const healthy = [
      automation({ ...gate, nextRunAt: NOW + 5 * MINUTE, lastRunStatus: "skipped" }),
      automation({ name: "Weekly digest", nextRunAt: NOW - 2 * HOUR }),
      automation({ name: "Paused", enabled: false, lastRunStatus: "failed" }),
      automation({ name: "Someone else's", execution: { worker: { owner: { bot: "work" } } }, lastRunStatus: "failed" }),
    ];
    expect(row({ bot: bricks, threads, automations: healthy }).line.tone).toBe("quiet");
    expect(row({ bot: bricks, threads, automations: [automation({ ...gate, nextRunAt: NOW - 40 * MINUTE })] }).line)
      .toMatchObject({ tone: "failed", text: "GitLab activity gate hasn't run in 40m", threadId: bricks.current });
    expect(row({ bot: bricks, threads, automations: [automation({ name: "Daily report", lastRunStatus: "failed", lastError: "token expired\nstack", lastRunThreadId: "run_1" })] }).line)
      .toMatchObject({ tone: "failed", text: "Daily report failed: token expired", threadId: "run_1" });
    expect(row({ bot: bricks, threads, automations: null }).line.tone).toBe("quiet");
  });
});

describe("crew arrangement", () => {
  it("lets bots with something to say speak, most urgent first, and rests the others", () => {
    const keys = ["personal", "home", "bricks", "work", "erbareeq"];
    const threads = [
      makeThread({ id: "coord_personal" }),
      makeThread({ id: "coord_home", isUnread: true }),
      makeThread({ id: "coord_bricks", status: "active" }),
      makeThread({ id: "coord_work" }),
      makeThread({ id: "coord_erbareeq", status: "error" }),
    ];
    const rows = keys.map((key) => row({ bot: bot(key), threads, pulse: key === "work" ? reply("Paused", "type your password") : reply("Done") }));
    const { speaking, resting } = arrangeCrew(rows);
    expect(speaking.map((entry) => [entry.bot.key, entry.line.tone])).toEqual([
      ["erbareeq", "failed"], ["work", "ask"], ["bricks", "running"], ["home", "new"],
    ]);
    expect(resting.map((entry) => entry.bot.key)).toEqual(["personal"]);
  });
});

describe("crew helpers", () => {
  it("recognises frequent schedules as watchers", () => {
    const of = (cron: string) => watchInterval(automation({ name: "x", trigger: { triggerType: "schedule", cron } }));
    expect([of("*/5 * * * *"), of("*/3 7-23 * * *"), of("* * * * *"), of("0 9 * * *"), of("*/45 * * * *")]).toEqual([5, 3, 1, null, null]);
    expect(watchInterval(automation({ name: "x", trigger: { triggerType: "event" } }))).toBeNull();
  });

  it("shortens automation names and times", () => {
    expect(shortAutomationName("Bricks Bot: GitLab activity gate")).toBe("GitLab activity gate");
    expect(shortAutomationName("SAIB statement eligibility gate (VPS run)")).toBe("SAIB statement eligibility gate");
    expect([shortAgo(NOW, NOW), shortAgo(NOW - 3 * MINUTE, NOW), shortAgo(NOW - 2 * HOUR, NOW), shortAgo(NOW - 50 * HOUR, NOW)]).toEqual(["now", "3m", "2h", "2d"]);
  });
});

describe("today's feed", () => {
  it("lists every job the crew started today, newest first, once each", () => {
    const bricks = bot("bricks");
    const home = bot("home");
    const dayStart = startOfToday(NOW);
    const threads = [
      makeThread({ id: bricks.current }),
      makeThread({ id: "live", parentThreadId: bricks.current, title: "Review fe!974", status: "active", createdAt: dayStart + 9 * HOUR }),
      makeThread({ id: "hidden", lifecycleOwnerThreadId: home.current, title: "Vacancy check", createdAt: dayStart + 8 * HOUR, isHidden: true }),
      makeThread({ id: "broke", parentThreadId: bricks.current, title: "Sync", status: "error", createdAt: dayStart + 7 * HOUR }),
      makeThread({ id: "elsewhere", title: "Not a job", createdAt: dayStart + 10 * HOUR }),
    ];
    const archived = new Map([[bricks.current, [
      { id: "done", title: "Astra review", status: "idle", createdAt: dayStart + 6 * HOUR },
      { id: "live", title: "Stale copy", status: "idle", createdAt: dayStart + 9 * HOUR },
      { id: "yesterday", title: "Old", status: "idle", createdAt: dayStart - HOUR },
    ]]]);
    expect(crewFeed({ roster: [bricks, home], threads, archived, now: NOW }).map((item) => [item.id, item.bot.key, item.state])).toEqual([
      ["live", "bricks", "running"], ["hidden", "home", "done"], ["broke", "bricks", "failed"], ["done", "bricks", "done"],
    ]);
  });
});

describe("today's chapters", () => {
  it("folds consecutive jobs by one bot into a card with a time range and tallies", () => {
    const [bricks, home] = [bot("bricks"), bot("home")];
    const item = (id: string, owner: RosterBot, at: number, state: "running" | "done" | "failed") => ({ id, bot: owner, title: id, startedAt: at, state });
    const feed = [
      item("a", bricks, 50, "running"), item("b", bricks, 40, "done"), item("c", bricks, 30, "failed"),
      item("d", home, 20, "done"),
      item("e", bricks, 10, "done"),
    ];
    expect(crewChapters(feed).map((chapter) => [chapter.bot.key, chapter.items.length, chapter.from, chapter.to, chapter.running, chapter.done, chapter.failed]))
      .toEqual([["bricks", 3, 30, 50, 1, 1, 1], ["home", 1, 20, 20, 0, 1, 0], ["bricks", 1, 10, 10, 0, 1, 0]]);
    expect(Object.fromEntries(jobsByBot(feed))).toEqual({ bricks: 4, home: 1 });
  });
});

describe("asks already on the Needs-you list", () => {
  it("rests the bot instead of repeating its listed ask, and keeps other asks", () => {
    const bot = (key: string) => ({ key, name: key, current: `thr_${key}` }) as never;
    const row = (key: string, text: string) => ({ bot: bot(key), line: { tone: "ask" as const, text, threadId: `thr_${key}`, at: 1 }, more: 0, context: null });
    const rows = withoutListedAsks([row("home", "I need the current Mum apt meter balance when you have it."), row("work", "Confirm UNITED payment?")],
      [{ bot: "home", text: "I need the current Mum apt meter balance when you have it", state: "open" },
       { bot: "work", text: "Confirm UNITED payment?", state: "done" }]);
    expect(rows.map((r) => r.line.tone)).toEqual(["quiet", "ask"]);
    expect(arrangeCrew(rows).speaking.map((r) => r.bot.key)).toEqual(["work"]);
  });
});

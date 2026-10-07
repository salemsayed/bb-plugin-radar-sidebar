import { describe, expect, it } from "vitest";
import { makeThread, MINUTE, NOW, HOUR } from "./fixtures";
import { arrangeCrew, isListedAsk, withoutListedAsks, crewChapters, crewFeed, crewRow, jobsByBot, startOfToday, shortAgo, shortAutomationName, watchInterval, type CrewAutomation } from "./crew";
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
  it("separates queued work, handover and unavailable coordinators from running and resting", () => {
    const home = bot("home");
    const coordinator = makeThread({ id: home.current });
    const queued = makeThread({ id: "queue", parentThreadId: home.current, queuedWork: "waiting", createdAt: NOW });
    expect(row({ bot: home, threads: [coordinator, queued] }).line).toMatchObject({ tone: "queued", threadId: "queue", text: "Queued, waiting to run" });
    expect(row({ bot: { ...home, rollover: "replacement" }, threads: [coordinator] }).line.tone).toBe("rollover");
    const unavailable = row({ bot: home });
    expect(unavailable.line.tone).toBe("unavailable");
    expect(arrangeCrew([unavailable]).resting).toHaveLength(0);
    const feed = crewFeed({ roster: [home], threads: [queued], archived: new Map(), now: NOW });
    expect(feed[0]?.state).toBe("queued");
    expect(crewChapters(feed)[0]?.queued).toBe(1);
  });

  it("includes nested and previous-coordinator workers and keeps read failures actionable", () => {
    const home = { ...bot("home"), coordinatorIds: ["old"] };
    const threads = [makeThread({ id: home.current }), makeThread({ id: "middle", parentThreadId: "old" }),
      makeThread({ id: "boom", parentThreadId: "middle", queuedWork: "failed", isUnread: false })];
    expect(row({ bot: home, threads }).line).toMatchObject({ tone: "failed", threadId: "boom" });
  });
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
  const listBot = (key: string) => ({ key, name: key, current: `thr_${key}` }) as never;
  const askRow = (key: string, text: string, itemId?: string | null) =>
    ({ bot: listBot(key), line: { tone: "ask" as const, text, threadId: `thr_${key}`, at: 1, ...(itemId === undefined ? {} : { itemId }) }, more: 0, context: null });
  it("avoids sleeping tiles for bots already represented by a saved ask, and keeps other asks", () => {
    const rows = withoutListedAsks([askRow("home", "I need the current Mum apt meter balance when you have it."), askRow("work", "Confirm UNITED payment?")],
      [{ id: "n1", bot: "home", text: "I need the current Mum apt meter balance when you have it", state: "open" },
       { id: "n2", bot: "work", text: "Confirm UNITED payment?", state: "done" }]);
    expect(rows.map((r) => r.line.tone)).toEqual(["ask"]);
    expect(arrangeCrew(rows).speaking.map((r) => r.bot.key)).toEqual(["work"]);
    expect(arrangeCrew(rows).resting).toHaveLength(0);
  });
  it("matches the bubble to its card by the saved item, whatever the card says", () => {
    // The card keeps the first sentence; the bubble may still quote the whole decision line.
    const listed = [{ id: "n1", bot: "home", text: "Top up the meter?", state: "open" }];
    expect(withoutListedAsks([askRow("home", "Top up the meter? It is at EGP 12 and the tariff changes Sunday.", "n1")], listed)).toEqual([]);
    expect(withoutListedAsks([askRow("home", "Top up the meter? It is at EGP 12 and the tariff changes Sunday.")], listed)).toHaveLength(1);
    // A different item, or a store that lost the item, leaves the bubble speaking.
    expect(withoutListedAsks([askRow("home", "Top up the meter?", "n9")], listed)).toHaveLength(1);
    expect(withoutListedAsks([askRow("home", "Top up the meter?", "n1")], [])).toHaveLength(1);
    expect(isListedAsk(listBot("home"), { tone: "running", text: "Top up the meter?", threadId: "thr_home", at: 1, itemId: "n1" }, listed)).toBe(false);
  });
});

describe("one ask identity", () => {
  const personal = bot("personal");
  const judgement = (fields: object) => ({ threadId: personal.current, version: NOW - HOUR, waiting: 0.9, ask: "should I book two for Saturday?", itemId: "n1", ...fields });
  it("quotes the saved text and carries the item the judge saved it as", () => {
    const coordinator = makeThread({ id: personal.current, latestAttentionAt: NOW - HOUR });
    const pulse = reply("Tickets are EGP 800 each.", "should I book two for Saturday? Prices rise on Monday.");
    expect(row({ bot: personal, threads: [coordinator], pulse, judgement: judgement({}) }).line)
      .toMatchObject({ tone: "ask", text: "Should I book two for Saturday?", itemId: "n1" });
    // Before the judgement arrives, the decision line speaks, without an item.
    expect(row({ bot: personal, threads: [coordinator], pulse }).line)
      .toMatchObject({ tone: "ask", text: "Should I book two for Saturday? Prices rise on Monday.", itemId: null });
  });
  it("keeps the bubble away after Done for that reply, and brings it back on the next reply", () => {
    const coordinator = makeThread({ id: personal.current, latestAttentionAt: NOW - HOUR, isUnread: false });
    const pulse = reply("Tickets are EGP 800 each.", "should I book two for Saturday?");
    expect(row({ bot: personal, threads: [coordinator], pulse, judgement: judgement({ dismissed: true }) }).line.tone).toBe("quiet");
    const next = { ...coordinator, latestAttentionAt: NOW };
    expect(row({ bot: personal, threads: [next], pulse, judgement: judgement({ dismissed: true }) }).line.tone).toBe("ask");
    expect(row({ bot: personal, threads: [next], pulse, judgement: judgement({ version: NOW, dismissed: false }) }).line).toMatchObject({ tone: "ask", itemId: "n1" });
  });
  it("keeps a queued coordinator's ask while its message waits to run", () => {
    const queued = makeThread({ id: personal.current, latestAttentionAt: NOW - HOUR, queuedWork: "waiting" });
    expect(row({ bot: personal, threads: [queued], pulse: reply("Tickets are EGP 800 each."), judgement: judgement({}) }).line)
      .toMatchObject({ tone: "ask", text: "Should I book two for Saturday?", itemId: "n1" });
    expect(row({ bot: personal, threads: [queued], pulse: reply("Tickets are EGP 800 each."), judgement: judgement({ waiting: 0.1, ask: null, itemId: null }) }).line.tone).toBe("queued");
  });
});

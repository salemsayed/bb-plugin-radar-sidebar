import { describe, expect, it } from "vitest";
import { hasUnresolvedActivity, botAttention, botActivity, botActivityText, botRailState, botScopeIds, botWorkers, rosterRefreshKey } from "./botScope";
import { makeThread } from "./fixtures";
import type { RosterBot } from "./bots";

const bot: RosterBot = { key: "personal", name: "Personal Bot", current: "root", projectId: "primary", projects: ["owned"], hostId: "h", providerId: "pi", model: "m", rollover: null };

describe("bot scope", () => {
  it("includes only owned descendants across projects and excludes unrelated project matches", () => {
    const threads = [
      makeThread({ id: "grandchild", projectId: "elsewhere", parentThreadId: "worker" }),
      makeThread({ id: "worker", projectId: "elsewhere", lifecycleOwnerThreadId: "root" }),
      makeThread({ id: "root", projectId: "primary" }),
      makeThread({ id: "archive", projectId: "owned", isArchived: true, parentThreadId: "root" }),
      makeThread({ id: "unrelated", projectId: "owned" }),
      makeThread({ id: "cycle-a", projectId: "elsewhere", parentThreadId: "cycle-b" }),
      makeThread({ id: "cycle-b", projectId: "elsewhere", parentThreadId: "cycle-a" }),
    ];
    expect([...botScopeIds(threads, bot)].sort()).toEqual(["archive", "grandchild", "root", "worker"]);
  });
  it("keeps an unseen decision ahead of worker activity", () => {
    const root = makeThread({ id: "root", isUnread: true });
    const worker = makeThread({ id: "worker", parentThreadId: "root", status: "active" });
    expect(botRailState([root, worker], bot, { subject: "Booking", decision: "Approve?", quiet: false })).toBe("decision");
  });
  it("keeps workers of previous coordinators after rollover without counting coordinator roots", () => {
    const next = { ...bot, current: "replacement", coordinatorIds: ["root", "replacement"] };
    const threads = [makeThread({ id: "old-worker", parentThreadId: "root" }), makeThread({ id: "new-worker", lifecycleOwnerThreadId: "replacement" }), makeThread({ id: "replacement" }), makeThread({ id: "helper", parentThreadId: "root", isHidden: true }), makeThread({ id: "archive", parentThreadId: "root", isArchived: true })];
    expect([...botScopeIds(threads, next)].sort()).toEqual(["archive", "helper", "new-worker", "old-worker", "replacement", "root"]);
    expect(botWorkers(threads, next).map(t => t.id)).toEqual(["old-worker", "new-worker"]);
  });
  it("shows a worker that a retry is running again as working, not failed (Home outage test, 2026-10-15)", () => {
    const root = makeThread({ id: "root", projectId: "primary" });
    const retried = makeThread({ id: "worker", lifecycleOwnerThreadId: "root", status: "active", isUnread: true, indicator: "unread-error" });
    expect(botRailState([root, retried], bot, null)).toBe("working");
    // Until it runs again, the unread failure still stands.
    expect(botRailState([root, { ...retried, status: "idle" }], bot, null)).toBe("failed");
    // Background work left over after the failure does not hide it.
    const leftover = { workflows: 0, backgroundAgents: 0, backgroundCommands: 1, planMode: 0, goals: 0 };
    expect(botRailState([root, { ...retried, status: "idle", activity: leftover }], bot, null)).toBe("failed");
    expect(botRailState([root, { ...retried, status: "error", activity: leftover }], bot, null)).toBe("failed");
    // A failed send is a failure even while the thread runs.
    expect(botRailState([root, { ...retried, indicator: "queued-failed" }], bot, null)).toBe("failed");
  });
  it("shows family failures and input waits without borrowing unrelated project activity", () => {
    const root = makeThread({ id: "root", projectId: "primary" });
    const unrelated = makeThread({ id: "unrelated", projectId: "owned", status: "error" });
    expect(botRailState([root, unrelated], bot, null)).toBe("idle");
    const worker = makeThread({ id: "worker", lifecycleOwnerThreadId: "root", hasPendingInteraction: true });
    expect(botRailState([root, worker], bot, null)).toBe("needs-you");
    expect(botRailState([root, { ...worker, status: "error" }], bot, null)).toBe("failed");
    expect(botRailState([root, { ...worker, isHidden: true }], bot, null)).toBe("needs-you");
  });
  it("preserves a blocked handover failure even with a live lifecycle-owned worker", () => {
    const root = makeThread({ id: "root" });
    const worker = makeThread({ id: "worker", lifecycleOwnerThreadId: "root", projectId: "elsewhere", isHidden: true, status: "active" });
    const blocked = { ...bot, rollover: null, rolloverBlocked: true };
    expect(botRailState([root], blocked, null)).toBe("failed");
    expect(botRailState([root, worker], blocked, null)).toBe("failed");
    expect(botRailState([root, worker], bot, null)).toBe("working");
    expect(botRailState([root, { ...worker, status: "idle" }], bot, null)).toBe("idle");
  });
  it("reads held work as idle, keeping failures, handovers and running work", () => {
    const root = makeThread({ id: "root" });
    const queued = makeThread({ id: "worker", parentThreadId: "root", queuedWork: "waiting" });
    expect(botRailState([root, queued], bot, null)).toBe("idle");
    expect(botRailState([{ ...root, queuedWork: "waiting" }, queued], bot, null)).toBe("idle");
    expect(botRailState([root, { ...queued, status: "active" }], bot, null)).toBe("working");
    expect(botRailState([root, { ...queued, queuedWork: "failed" }], bot, null)).toBe("failed");
    expect(botRailState([root, queued], { ...bot, rollover: "summary" }, null)).toBe("rollover");
    expect(botRailState([root, queued, makeThread({ id: "running", parentThreadId: "root", status: "active" })], bot, null)).toBe("working");
  });
});

describe("memoised family walks", () => {
  it("walks each threads array once per bot and reuses the family across calls", () => {
    const threads = [makeThread({ id: "root" }), makeThread({ id: "worker", parentThreadId: "root" }), makeThread({ id: "grandchild", parentThreadId: "worker" })];
    expect(botScopeIds(threads, bot)).toBe(botScopeIds(threads, bot));
    expect(botWorkers(threads, bot).map(t => t.id)).toEqual(["worker", "grandchild"]);
    expect(botRailState(threads, bot, null)).toBe("idle");
    // A new array (any sidebar update) is walked afresh.
    const next = [...threads, makeThread({ id: "late", lifecycleOwnerThreadId: "grandchild", status: "active" })];
    expect(botScopeIds(next, bot)).not.toBe(botScopeIds(threads, bot));
    expect(botRailState(next, bot, null)).toBe("working");
    expect(botRailState(threads, bot, null)).toBe("idle");
    // Rollover changes the coordinator set and therefore the cached entry.
    const rolled = { ...bot, current: "fresh", coordinatorIds: ["root", "fresh"] };
    expect([...botScopeIds(next, rolled)].sort()).toEqual(["fresh", "grandchild", "late", "root", "worker"]);
  });
});

describe("roster refresh key", () => {
  it("changes on create, archive and unarchive but not on reorder or timestamps", () => {
    const a = makeThread({ id: "a", updatedAt: 1 });
    const b = makeThread({ id: "b", updatedAt: 2 });
    const base = rosterRefreshKey([a, b]);
    expect(rosterRefreshKey([b, a])).toBe(base);
    expect(rosterRefreshKey([{ ...a, updatedAt: 50, isUnread: true }, b])).toBe(base);
    expect(rosterRefreshKey([a, b, makeThread({ id: "c" })])).not.toBe(base);
    expect(rosterRefreshKey([a])).not.toBe(base);
    const archived = rosterRefreshKey([a, { ...b, isArchived: true }]);
    expect(archived).not.toBe(base);
    expect(rosterRefreshKey([{ ...b, isArchived: true }, a])).toBe(archived);
    // Swapping one id for another at equal counts still refreshes.
    expect(rosterRefreshKey([a, makeThread({ id: "d" })])).not.toBe(base);
    const same = [a, b];
    expect(rosterRefreshKey(same)).toBe(rosterRefreshKey(same));
  });
});


describe("blocked handover independent signals", () => {
  const bot = { key: "personal", name: "Personal Bot", current: "root", coordinatorIds: ["old", "root"], projectId: "proj_a", projects: [], hostId: "h", providerId: "codex", model: "m", rollover: null, rolloverBlocked: true };
  it("counts hidden lifecycle work once across previous coordinators without counting archived or unrelated work", () => {
    const rows = [makeThread({ id: "root" }), makeThread({ id: "old" }),
      makeThread({ id: "hidden", parentThreadId: "old", lifecycleOwnerThreadId: "root", projectId: "other", isHidden: true, status: "active" }),
      makeThread({ id: "archived", lifecycleOwnerThreadId: "root", isArchived: true, status: "active" }),
      makeThread({ id: "unrelated", projectId: "proj_a", status: "active" })];
    expect(botRailState(rows, bot, null)).toBe("failed");
    expect(botActivity(rows, bot, null)).toEqual({ workers: 1, hiddenWorkers: 1, active: 1, questions: 0, decisions: 0, unread: false, updates: 0 });
    expect(botActivityText(botActivity(rows, bot, null))).toBe("1 worker · 1 active");
    expect(botWorkers(rows, bot)).toEqual([]);
  });
  it("keeps blocked failure and background work even if a phase is also present", () => {
    const rows = [makeThread({ id: "root", activity: { workflows: 0, backgroundAgents: 0, backgroundCommands: 1, planMode: 0, goals: 0 }, hasPendingInteraction: true })];
    const entry = { ...bot, rollover: "summary", actionableNeeds: 1 };
    expect(botRailState(rows, entry, null)).toBe("failed");
    expect(botActivity(rows, entry, null)).toMatchObject({ active: 1, questions: 1, decisions: 1 });
  });
  it.each(["question", "saved decision", "pulse decision", "missing coordinator"])("keeps failure with %s and preserves independent attention", kind => {
    const rows = kind === "missing coordinator" ? [] : [makeThread({ id: "root", hasPendingInteraction: kind === "question" })];
    const entry = { ...bot, actionableNeeds: kind === "saved decision" ? 2 : 0 };
    const pulse = kind === "pulse decision" ? { subject: "Choose", decision: "Choose option", quiet: false } : null;
    expect(botRailState(rows, entry, pulse)).toBe("failed");
    expect(botActivity(rows, entry, pulse)).toMatchObject({ active: 0, questions: kind === "question" ? 1 : 0, decisions: kind === "saved decision" ? 2 : kind === "pulse decision" ? 1 : 0 });
  });
});

describe("activity coverage and last known topology", () => {
  it("keeps fresh work linked through a stale archived bridge without counting that bridge as working", () => {
    const threads = [makeThread({ id: "root" }), makeThread({ id: "live", parentThreadId: "bridge", status: "active" })];
    const coverage = { complete: false, staleThreads: [makeThread({ id: "bridge", parentThreadId: "root", isArchived: true, status: "active" })] };
    expect(botActivity(threads, bot, null, coverage)).toMatchObject({ workers: 1, active: 1, lastKnownActive: 0, complete: false });
    expect(botRailState(threads, bot, null, coverage)).toBe("working");
  });
  it("lets a fresh idle or archived row supersede stale active facts with the same id", () => {
    const staleThreads = [makeThread({ id: "worker", parentThreadId: "root", status: "active", hasPendingInteraction: true })];
    for (const isArchived of [false, true]) {
      const threads = [makeThread({ id: "root" }), makeThread({ id: "worker", parentThreadId: "root", isArchived })];
      expect(botActivity(threads, bot, null, { complete: false, staleThreads })).toMatchObject({ workers: isArchived ? 0 : 1, active: 0, questions: 0, lastKnownActive: 0, lastKnownQuestions: 0 });
    }
  });
  it("distinguishes a complete zero from unavailable and stale counts", () => {
    const rows = [makeThread({ id: "root" })];
    expect(botActivityText(botActivity(rows, bot, null, { complete: true, staleThreads: [] }))).toBe("0 workers");
    expect(botActivityText(botActivity(rows, bot, null, { complete: false, staleThreads: [] }))).toBe("Worker count unavailable · Activity incomplete");
    const staleThreads = [makeThread({ id: "worker", parentThreadId: "root", status: "active", hasPendingInteraction: true })];
    const text = botActivityText(botActivity(rows, bot, null, { complete: false, staleThreads }));
    expect(text).toContain("1 last known active");
    expect(text).toContain("1 last known waiting on you");
    expect(botRailState(rows, bot, null, { complete: false, staleThreads })).toBe("unavailable");
  });
});


describe("missing ancestry coverage", () => {
  it("marks unresolved ownership incomplete while preserving known family work", () => {
    const orphan = makeThread({ id: "worker", parentThreadId: "missing-archived-bridge", status: "active" });
    expect(hasUnresolvedActivity([orphan], [bot])).toBe(true);
    expect(hasUnresolvedActivity([{ ...orphan, lifecycleOwnerThreadId: "root" }], [bot])).toBe(false);
    expect(hasUnresolvedActivity([orphan, makeThread({ id: "missing-archived-bridge", parentThreadId: "root", isArchived: true })], [bot])).toBe(false);
    expect(hasUnresolvedActivity([makeThread({ id: "unrelated-root", sourceThreadId: "absent" })], [bot])).toBe(false);
  });
});


describe("bot attention lifecycle", () => {
  it("keeps chat unread independent of saved updates through read, resolve and reload", () => {
    const saved = { ...bot, unseenAttention: 1, actionableNeeds: 0 };
    const unread = [makeThread({ id: "root", isUnread: true })];
    const read = [makeThread({ id: "root", isUnread: false })];
    expect(botAttention(unread, saved)).toEqual({ unread: true, updates: 1 });
    expect(botRailState(read, saved, null)).toBe("updates");
    expect(botAttention(read, JSON.parse(JSON.stringify(saved)))).toEqual({ unread: false, updates: 1 });
    const resolved = { ...saved, unseenAttention: 0 };
    expect(botRailState(read, resolved, null)).toBe("idle");
    expect(botRailState(unread, resolved, null)).toBe("unread");
    expect(botAttention(read, resolved)).toEqual({ unread: false, updates: 0 });
  });
  it("keeps visible worker unread and saved updates during active work without borrowing hidden or unrelated replies", () => {
    const saved = { ...bot, unseenAttention: 1 };
    const threads = [makeThread({ id: "root", status: "active" }), makeThread({ id: "child", parentThreadId: "root", isUnread: true })];
    expect(botRailState(threads, saved, null)).toBe("working");
    expect(botActivity(threads, saved, null)).toMatchObject({ unread: true, updates: 1 });
    expect(botRailState([{ ...threads[0]!, status: "idle" }, threads[1]!], { ...saved, unseenAttention: 0 }, null)).toBe("unread");
    expect(botAttention([threads[0]!, { ...threads[1]!, isHidden: true }, makeThread({ id: "unrelated", isUnread: true })], saved)).toEqual({ unread: false, updates: 1 });
  });
});

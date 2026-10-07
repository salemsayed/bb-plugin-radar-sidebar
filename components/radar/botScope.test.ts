import { describe, expect, it } from "vitest";
import { botRailState, botScopeIds, botWorkers, rosterRefreshKey } from "./botScope";
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
  it("shows family failures and input waits without borrowing unrelated project activity", () => {
    const root = makeThread({ id: "root", projectId: "primary" });
    const unrelated = makeThread({ id: "unrelated", projectId: "owned", status: "error" });
    expect(botRailState([root, unrelated], bot, null)).toBe("idle");
    const worker = makeThread({ id: "worker", lifecycleOwnerThreadId: "root", hasPendingInteraction: true });
    expect(botRailState([root, worker], bot, null)).toBe("needs-you");
    expect(botRailState([root, { ...worker, status: "error" }], bot, null)).toBe("failed");
    expect(botRailState([root, { ...worker, isHidden: true }], bot, null)).toBe("idle");
  });
  it("keeps queued work distinct from running work and handovers", () => {
    const root = makeThread({ id: "root" });
    const queued = makeThread({ id: "worker", parentThreadId: "root", queuedWork: "waiting" });
    expect(botRailState([root, queued], bot, null)).toBe("queued");
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

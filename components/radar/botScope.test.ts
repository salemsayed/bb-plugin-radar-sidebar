import { describe, expect, it } from "vitest";
import { botRailState, botScopeIds, botWorkers } from "./botScope";
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
});

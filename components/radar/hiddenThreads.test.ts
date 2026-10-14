import { describe, expect, it } from "vitest";
import { HOUR, NOW, makeListedThread, makeThread } from "./fixtures";
import { mergeHiddenThreads, toSidebarThread } from "./hiddenThreads";

describe("toSidebarThread", () => {
  it("turns a hidden list row into a quiet sidebar row", () => {
    const row = toSidebarThread(makeListedThread({
      id: "relayed",
      projectId: "proj_b",
      title: null,
      titleFallback: "Consolidate agent memories",
      lifecycleOwnerThreadId: "coord",
      status: "active",
      runtime: { displayStatus: "waiting-for-host" },
      hasPendingInteraction: true,
      queuedWork: "waiting",
      pinnedAt: NOW,
      activity: { activeBackgroundAgentCount: 2, activeBackgroundCommandCount: 1, activeGoalCount: 0, activePlanModeCount: 0, activeWorkflowCount: 3 },
      environmentHostId: "host_2",
      updatedAt: NOW - HOUR,
    }));
    expect(row).toMatchObject({
      id: "relayed",
      projectId: "proj_b",
      displayTitle: "Consolidate agent memories",
      lifecycleOwnerThreadId: "coord",
      parentThreadId: null,
      status: "active",
      runtimeStatus: "waiting-for-host",
      activity: { workflows: 3, backgroundAgents: 2, backgroundCommands: 1, planMode: 0, goals: 0 },
      isHidden: true,
      isUnread: false,
      isPinned: false,
      pinnedAt: null,
      indicator: "none",
      indicatorLabel: null,
      queuedWork: "none",
      hasPendingInteraction: false,
      href: "/projects/proj_b/threads/relayed",
      host: null,
      latestAttentionAt: NOW - HOUR,
    });
    expect(row.environment?.id).toBe("env_relayed");
  });

  it("falls back to the id for an untitled row and has no environment without one", () => {
    const row = toSidebarThread(makeListedThread({ id: "bare", title: null, environmentId: null }));
    expect(row.displayTitle).toBe("bare");
    expect(row.environment).toBeNull();
  });

  it("borrows the feed's href shape and host name", () => {
    const feed = [makeThread({ id: "visible", projectId: "proj_b", href: "/p/proj_b/t/visible", host: { id: "host_2", name: "salem-pc" } })];
    const row = toSidebarThread(makeListedThread({ id: "relayed", projectId: "proj_b", environmentHostId: "host_2" }), feed);
    expect(row.href).toBe("/p/proj_b/t/relayed");
    expect(row.host).toEqual({ id: "host_2", name: "salem-pc" });
  });
});

describe("mergeHiddenThreads", () => {
  const feed = [makeThread({ id: "coord" }), makeThread({ id: "worker", lifecycleOwnerThreadId: "coord" })];

  it("appends hidden workers after the feed", () => {
    const merged = mergeHiddenThreads(feed, [
      makeListedThread({ id: "relayed", lifecycleOwnerThreadId: "coord" }),
      makeListedThread({ id: "forked", parentThreadId: "worker" }),
    ]);
    expect(merged.map(thread => thread.id)).toEqual(["coord", "worker", "relayed", "forked"]);
    expect(merged.slice(2).every(thread => thread.isHidden)).toBe(true);
  });

  it("drops rows the feed already has, visible rows, repeats and hidden roots", () => {
    const merged = mergeHiddenThreads(feed, [
      makeListedThread({ id: "worker", lifecycleOwnerThreadId: "coord" }),
      makeListedThread({ id: "shown", lifecycleOwnerThreadId: "coord", visibility: "visible" }),
      makeListedThread({ id: "relayed", lifecycleOwnerThreadId: "coord" }),
      makeListedThread({ id: "relayed", lifecycleOwnerThreadId: "coord" }),
      makeListedThread({ id: "old-coordinator" }),
    ]);
    expect(merged.map(thread => thread.id)).toEqual(["coord", "worker", "relayed"]);
    expect(merged[1]!.isHidden).toBe(false);
  });

  it("returns the feed itself when nothing is added", () => {
    expect(mergeHiddenThreads(feed, [])).toBe(feed);
  });
});

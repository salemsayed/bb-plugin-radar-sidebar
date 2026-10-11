import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeThread, makeProject, makeSection, NOW, HOUR, DAY } from "./fixtures";
import { useThreadGroups } from "./useThreadGroups";

type Args = Parameters<typeof useThreadGroups>[0];
function argsFor(threads: Args["threads"]): Args {
  return { threads, query: "", statusFilter: "all", grouping: "time",
    projectOrder: [], projects: [makeProject({ id: "proj_a" })], sections: [], now: NOW };
}
afterEach(cleanup);

describe("family derivation cache", () => {
  it("shares activity and summary work across sorting, headers and row renders", () => {
    const parent = makeThread({ id: "p", latestAttentionAt: NOW - HOUR });
    const child = makeThread({ id: "c", parentThreadId: "p", latestAttentionAt: NOW });
    const activityRead = vi.fn(() => NOW);
    const unreadRead = vi.fn(() => false);
    Object.defineProperty(child, "latestAttentionAt", { get: activityRead });
    Object.defineProperty(child, "isUnread", { get: unreadRead });
    const args = argsFor([parent, child, makeThread({ id: "other" })]);
    const hook = renderHook((props: Args) => useThreadGroups(props), { initialProps: args });
    const first = hook.result.current;
    const counts = first.countSubtree(parent);
    expect(first.subtreeActivity(parent)).toBe(NOW);
    activityRead.mockClear();
    unreadRead.mockClear();
    for (let i = 0; i < 100; i++) {
      expect(first.countSubtree(parent)).toBe(counts);
      expect(first.subtreeActivity(parent)).toBe(NOW);
    }
    hook.rerender({ ...args, grouping: "project" });
    expect(hook.result.current.countSubtree(parent)).toBe(counts);
    expect(hook.result.current.subtreeActivity(parent)).toBe(NOW);
    expect(activityRead).not.toHaveBeenCalled();
    expect(unreadRead).not.toHaveBeenCalled();
  });

  it("invalidates summaries on a new snapshot and when filtering changes descendants", () => {
    const parent = makeThread({ id: "p", title: "Parentneedle" });
    const child = makeThread({ id: "c", parentThreadId: "p" });
    const args = argsFor([parent, child]);
    const hook = renderHook((props: Args) => useThreadGroups(props), { initialProps: args });
    const before = hook.result.current.countSubtree(parent);
    const failed = { ...child, isUnread: true, indicator: "unread-error" as const };
    const updated = { ...args, threads: [parent, failed] };
    hook.rerender(updated);
    const after = hook.result.current.countSubtree(parent);
    expect(after).not.toBe(before);
    expect(after).toMatchObject({ total: 2, unread: 1, failed: 1 });
    expect(hook.result.current.groups[0]).toMatchObject({ total: 2, unread: 1, failed: 1 });
    hook.rerender({ ...updated, query: "Parentneedle" });
    expect(hook.result.current.countSubtree(parent)).toMatchObject({ total: 1, unread: 0, failed: 0, kids: [] });
    hook.rerender({ ...updated, statusFilter: "unread" });
    expect(hook.result.current.countSubtree(parent)).toMatchObject({ total: 2, unread: 1, failed: 1 });
  });

  it("sorts live work by when it went live and invalidates when live work ends", () => {
    const parent = makeThread({ id: "p", latestAttentionAt: NOW - 3 * HOUR });
    const child = makeThread({ id: "c", parentThreadId: "p", status: "active", latestAttentionAt: NOW - HOUR });
    const args = argsFor([parent, child]);
    const hook = renderHook((props: Args) => useThreadGroups(props), { initialProps: args });
    expect(hook.result.current.subtreeActivity(parent)).toBe(NOW);
    // The clock moving on must not float the family again.
    hook.rerender({ ...args, now: NOW + HOUR });
    expect(hook.result.current.subtreeActivity(parent)).toBe(NOW);
    hook.rerender({ ...args, threads: [parent, { ...child, status: "idle" }] });
    expect(hook.result.current.subtreeActivity(parent)).toBe(NOW - HOUR);
    expect(hook.result.current.countSubtree(parent).live).toBe(0);
  });

  it("preserves all descendant counts and the first five previews in depth-first order", () => {
    const parent = makeThread({ id: "p" });
    const threads = [parent,
      makeThread({ id: "a", parentThreadId: "p", status: "active" }),
      makeThread({ id: "a1", parentThreadId: "a", indicator: "waiting-for-input", hasPendingInteraction: true }),
      makeThread({ id: "b", parentThreadId: "p", isUnread: true, indicator: "unread-error", latestAttentionAt: NOW - HOUR }),
      makeThread({ id: "c", parentThreadId: "p", isUnread: true, latestAttentionAt: NOW - 2 * HOUR }),
      makeThread({ id: "d", parentThreadId: "p", latestAttentionAt: NOW - 3 * HOUR }),
      makeThread({ id: "e", parentThreadId: "p", latestAttentionAt: NOW - 4 * HOUR }),
    ];
    const hook = renderHook(() => useThreadGroups(argsFor(threads)));
    const counts = hook.result.current.countSubtree(parent);
    expect(counts).toMatchObject({ total: 7, unread: 2, live: 1, needsUser: 1, failed: 1 });
    expect(counts.kids.map(({ id, dot }) => [id, dot])).toEqual([
      ["a", "radar-dot-running radar-dot-pulse"], ["a1", "radar-dot-attention"],
      ["b", "radar-dot-error"], ["c", "radar-unread"], ["d", null],
    ]);
  });

  it("preserves the traversal depth guard", () => {
    const threads = Array.from({ length: 32 }, (_, i) => makeThread({
      id: `t${i}`, parentThreadId: i === 0 ? null : `t${i - 1}`,
      latestAttentionAt: NOW - (40 - i) * HOUR,
    }));
    const hook = renderHook(() => useThreadGroups(argsFor(threads)));
    expect(hook.result.current.countSubtree(threads[0]).total).toBe(27);
    expect(hook.result.current.subtreeActivity(threads[0])).toBe(threads[26].latestAttentionAt);
  });
});

describe("salem fork: owner nesting, bot cards, needs-you lane, empty sections", () => {
  it("nests a parentless worker under its lifecycle owner only when asked", () => {
    const owner = makeThread({ id: "coord", title: "Personal Bot", isPinned: true });
    const worker = makeThread({ id: "run", lifecycleOwnerThreadId: "coord" });
    const off = renderHook(() => useThreadGroups(argsFor([owner, worker])));
    expect(off.result.current.roots.map((t) => t.id).sort()).toEqual(["coord", "run"]);
    const on = renderHook(() => useThreadGroups({ ...argsFor([owner, worker]), nestByOwner: true }));
    expect(on.result.current.roots.map((t) => t.id)).toEqual(["coord"]);
    expect(on.result.current.shownChildren.get("coord")?.map((t) => t.id)).toEqual(["run"]);
  });
  it("gives each coordinator its own group and lifts blocked threads into a needs-you lane", () => {
    const coord = makeThread({ id: "coord", title: "Personal Bot", isPinned: true });
    const other = makeThread({ id: "other", title: "Pinned note", isPinned: true });
    const asking = makeThread({ id: "ask", title: "Chat · Sherif", hasPendingInteraction: true });
    const failed = makeThread({ id: "boom", indicator: "unread-error", isUnread: true });
    const plain = makeThread({ id: "plain" });
    const hook = renderHook(() => useThreadGroups({ ...argsFor([coord, other, asking, failed, plain]), botThreadIds: ["coord", "missing"] }));
    const { botGroups, needsYouGroup, pinnedGroup, groups, shownTotal } = hook.result.current;
    expect(botGroups.map((g) => g.id)).toEqual(["bot:coord"]);
    expect(needsYouGroup?.roots.map((t) => t.id).sort()).toEqual(["ask", "boom"]);
    expect(pinnedGroup?.roots.map((t) => t.id)).toEqual(["other"]);
    expect(groups.flatMap((g) => g.roots.map((t) => t.id))).toEqual(["plain"]);
    expect(shownTotal).toBe(5);
  });
  it("leaves blocked threads in their groups when the needs-you lane is off", () => {
    const asking = makeThread({ id: "ask", hasPendingInteraction: true });
    const pinnedFail = makeThread({ id: "boom", indicator: "unread-error", isUnread: true, isPinned: true });
    const plain = makeThread({ id: "plain" });
    const result = renderHook(() => useThreadGroups({ ...argsFor([asking, pinnedFail, plain]), needsYouLane: false })).result.current;
    expect(result.needsYouGroup).toBeNull();
    expect(result.pinnedGroup?.roots.map((t) => t.id)).toEqual(["boom"]);
    expect(result.groups.flatMap((g) => g.roots.map((t) => t.id)).sort()).toEqual(["ask", "plain"]);
    expect(result.shownTotal).toBe(3);
  });
  it("hides empty sections in section view when asked", () => {
    const filed = makeThread({ id: "f", sectionId: "sec_desk" });
    const base = { ...argsFor([filed]), grouping: "section" as const,
      sections: [makeSection({ id: "sec_desk", name: "Chat desk" }), makeSection({ id: "sec_empty", name: "Bots" })] };
    expect(renderHook(() => useThreadGroups(base)).result.current.groups.map((g) => g.label)).toEqual(["Chat desk", "Bots", "Unfiled"]);
    expect(renderHook(() => useThreadGroups({ ...base, hideEmptySections: true })).result.current.groups.map((g) => g.label)).toEqual(["Chat desk"]);
  });
});

describe("working drawer", () => {
  const ids = (list: readonly { id: string }[] | undefined) => (list ?? []).map((t) => t.id);
  const listed = (groups: readonly { roots: readonly { id: string }[] }[]) => groups.flatMap((g) => ids(g.roots));

  it("parks running families in the drawer only when asked, and returns them once idle", () => {
    const running = makeThread({ id: "run", status: "active" });
    const background = makeThread({ id: "bg", activity: { workflows: 0, backgroundAgents: 1, backgroundCommands: 0, planMode: 0, goals: 0 } });
    const plain = makeThread({ id: "plain" });
    const base = argsFor([running, background, plain]);
    const off = renderHook(() => useThreadGroups(base)).result.current;
    expect(off.workingGroup).toBeNull();
    expect(listed(off.groups).sort()).toEqual(["bg", "plain", "run"]);
    const hook = renderHook((props: Args) => useThreadGroups(props), { initialProps: { ...base, hideWorking: true } });
    expect(ids(hook.result.current.workingGroup?.roots).sort()).toEqual(["bg", "run"]);
    expect(listed(hook.result.current.groups)).toEqual(["plain"]);
    expect(hook.result.current.shownTotal).toBe(3);
    hook.rerender({ ...base, hideWorking: true, threads: [{ ...running, status: "idle" }, background, plain] });
    expect(ids(hook.result.current.workingGroup?.roots)).toEqual(["bg"]);
    expect(listed(hook.result.current.groups).sort()).toEqual(["plain", "run"]);
  });

  it("keeps a family in view when any member needs you, and moves it when only a child runs", () => {
    const parent = makeThread({ id: "p" });
    const runner = makeThread({ id: "c1", parentThreadId: "p", status: "active" });
    const asking = makeThread({ id: "c2", parentThreadId: "p", indicator: "waiting-for-input" });
    const quiet = makeThread({ id: "q" });
    const quietRunner = makeThread({ id: "q1", parentThreadId: "q", status: "active" });
    const blocked = makeThread({ id: "b", status: "active", hasPendingInteraction: true });
    const hook = renderHook(() => useThreadGroups({ ...argsFor([parent, runner, asking, quiet, quietRunner, blocked]), hideWorking: true }));
    const { workingGroup, needsYouGroup, groups } = hook.result.current;
    expect(ids(workingGroup?.roots)).toEqual(["q"]);
    expect(workingGroup).toMatchObject({ total: 2, live: 1 });
    expect(hook.result.current.workingCount).toBe(1);
    expect(ids(needsYouGroup?.roots)).toEqual(["b"]);
    expect(listed(groups)).toEqual(["p"]);
  });

  it("leaves the open thread's family, pinned threads and coordinators where they are", () => {
    const open = makeThread({ id: "open", status: "active" });
    const parent = makeThread({ id: "p" });
    const openChild = makeThread({ id: "pc", parentThreadId: "p", status: "active" });
    const pinned = makeThread({ id: "pin", status: "active", isPinned: true });
    const coord = makeThread({ id: "coord", status: "active" });
    const away = makeThread({ id: "away", status: "active" });
    const base = { ...argsFor([open, parent, openChild, pinned, coord, away]), hideWorking: true, botThreadIds: ["coord"] };
    const hook = renderHook((props: Args) => useThreadGroups(props), { initialProps: { ...base, activeThreadId: "open" } });
    expect(ids(hook.result.current.workingGroup?.roots).sort()).toEqual(["away", "p"]);
    expect(listed(hook.result.current.groups)).toEqual(["open"]);
    expect(ids(hook.result.current.pinnedGroup?.roots)).toEqual(["pin"]);
    expect(ids(hook.result.current.botGroups.flatMap((g) => g.roots))).toEqual(["coord"]);
    hook.rerender({ ...base, activeThreadId: "pc" });
    expect(ids(hook.result.current.workingGroup?.roots).sort()).toEqual(["away", "open"]);
    expect(listed(hook.result.current.groups)).toEqual(["p"]);
  });

  it("counts any live work as working, including a background command left running", () => {
    const idle = { workflows: 0, backgroundAgents: 0, backgroundCommands: 0, planMode: 0, goals: 0 };
    const threads = [
      makeThread({ id: "server", activity: { ...idle, backgroundCommands: 1 } }),
      makeThread({ id: "plan", activity: { ...idle, planMode: 1 } }),
      makeThread({ id: "agents", activity: { ...idle, backgroundAgents: 2 } }),
      makeThread({ id: "goal", activity: { ...idle, goals: 1 } }),
      makeThread({ id: "queued", status: "active", queuedWork: "waiting" }),
      makeThread({ id: "stuck", queuedWork: "failed", indicator: "queued-failed" }),
      makeThread({ id: "done", indicator: "unread-success", isUnread: true }),
      // A message parked on an idle thread is held, not work in flight.
      makeThread({ id: "held", queuedWork: "waiting", indicator: "queued-waiting" }),
    ];
    const result = renderHook(() => useThreadGroups({ ...argsFor(threads), hideWorking: true })).result.current;
    expect(ids(result.workingGroup?.roots).sort()).toEqual(["agents", "goal", "plan", "queued", "server"]);
    expect(ids(result.needsYouGroup?.roots)).toEqual(["stuck"]);
    expect(listed(result.groups).sort()).toEqual(["done", "held"]);
    expect(result.workingCount).toBe(5);
  });

  it("shows matches in place while searching or filtering", () => {
    const running = makeThread({ id: "run", title: "Deploy fix", status: "active" });
    const base = { ...argsFor([running, makeThread({ id: "plain" })]), hideWorking: true };
    for (const filter of [{ query: "deploy" }, { statusFilter: "live" as const }]) {
      const result = renderHook(() => useThreadGroups({ ...base, ...filter })).result.current;
      expect(result.workingGroup).toBeNull();
      expect(listed(result.groups)).toEqual(["run"]);
    }
  });

describe("held threads", () => {
  it("leave the live filter and live counts, and sort like idle threads", () => {
    const threads = [
      makeThread({ id: "held", queuedWork: "waiting", indicator: "queued-waiting", latestAttentionAt: NOW - 3 * DAY }),
      makeThread({ id: "behind", status: "active", queuedWork: "waiting", latestAttentionAt: NOW - 3 * DAY }),
      makeThread({ id: "recent", latestAttentionAt: NOW - HOUR }),
    ];
    const all = renderHook(() => useThreadGroups(argsFor(threads))).result.current;
    expect(all.statusCounts.live).toBe(1);
    expect(all.groups.map((group) => [group.id, ids(group.roots)])).toEqual([
      ["time:today", ["behind", "recent"]],
      ["time:week", ["held"]],
    ]);
    const live = renderHook(() => useThreadGroups({ ...argsFor(threads), statusFilter: "live" })).result.current;
    expect(listed(live.groups)).toEqual(["behind"]);
  });
});
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { activityTime, isHeldThread, isLiveThread, isQueuedThread, isRunningThread, timeAgo, timeGroupFor, shortAgo } from "./time";
import { makeThread, NOW, DAY, HOUR, MINUTE } from "./fixtures";

describe("isLiveThread", () => {
  it("treats executing statuses as live", () => {
    for (const status of ["starting", "active", "stopping"] as const) {
      expect(isLiveThread(makeThread({ id: "t", status }))).toBe(true);
    }
  });

  it("treats background activity counts as live", () => {
    const thread = makeThread({
      id: "t",
      status: "idle",
      activity: {
        workflows: 0,
        backgroundAgents: 1,
        backgroundCommands: 0,
        planMode: 0,
        goals: 0,
      },
    });
    expect(isLiveThread(thread)).toBe(true);
  });

  it("treats work queued behind a run and pending interactions as live", () => {
    expect(
      isLiveThread(makeThread({ id: "q", status: "active", queuedWork: "waiting" })),
    ).toBe(true);
    expect(
      isLiveThread(makeThread({ id: "p", hasPendingInteraction: true })),
    ).toBe(true);
  });

  it("treats a read idle thread as not live", () => {
    expect(isLiveThread(makeThread({ id: "t", status: "idle" }))).toBe(false);
  });
});

describe("isRunningThread", () => {
  it("keeps blocked work live without calling it running", () => {
    const approval = makeThread({ id: "approval", hasPendingInteraction: true, indicator: "waiting-for-input", queuedWork: "waiting" });
    expect(isLiveThread(approval)).toBe(true);
    expect(isRunningThread(approval)).toBe(false);
    expect(isHeldThread(approval)).toBe(false);
    // Queued work on its own never makes a thread live, failed or not.
    expect(isLiveThread(makeThread({ id: "failed", queuedWork: "failed", indicator: "queued-failed" }))).toBe(false);
    expect(isRunningThread(makeThread({ id: "run", status: "active" }))).toBe(true);
    expect(isRunningThread(makeThread({ id: "background", activity: {
      workflows: 1, backgroundAgents: 0, backgroundCommands: 0, planMode: 0, goals: 0,
    } }))).toBe(true);
  });
});

describe("isHeldThread", () => {
  it("holds a message parked on an idle thread, and nothing else", () => {
    const parked = makeThread({ id: "parked", status: "idle", queuedWork: "waiting", indicator: "queued-waiting" });
    expect(isHeldThread(parked)).toBe(true);
    expect(isQueuedThread(parked)).toBe(false);
    expect(isLiveThread(parked)).toBe(false);
    const behind = { ...parked, status: "active" as const };
    expect(isHeldThread(behind)).toBe(false);
    expect(isQueuedThread(behind)).toBe(true);
    expect(isLiveThread(behind)).toBe(true);
    const background = { ...parked, activity: { workflows: 0, backgroundAgents: 1, backgroundCommands: 0, planMode: 0, goals: 0 } };
    expect(isHeldThread(background)).toBe(false);
    expect(isHeldThread({ ...parked, queuedWork: "none" as const })).toBe(false);
  });

  it("sorts a held thread by its latest attention, never floating it", () => {
    const parked = makeThread({ id: "parked-sort", queuedWork: "waiting", latestAttentionAt: NOW - 3 * DAY });
    expect(activityTime(parked, NOW)).toBe(NOW - 3 * DAY);
    expect(activityTime(parked, NOW + HOUR)).toBe(NOW - 3 * DAY);
  });
});

describe("activityTime", () => {
  it("counts a live thread from when it went live so it lands in Today", () => {
    const stale = makeThread({
      id: "live",
      status: "active",
      createdAt: NOW - 30 * DAY,
      latestAttentionAt: NOW - 30 * DAY,
    });
    expect(activityTime(stale, NOW)).toBe(NOW);
    expect(timeGroupFor(activityTime(stale, NOW), NOW)).toBe("today");
  });

  it("keeps a live thread at the time it went live instead of floating with the clock", () => {
    const live = makeThread({ id: "live", status: "active", latestAttentionAt: NOW - DAY });
    expect(activityTime(live, NOW)).toBe(NOW);
    expect(activityTime(live, NOW + HOUR)).toBe(NOW);
    // Newer attention while still live (a finished turn, more queued) counts.
    expect(activityTime({ ...live, latestAttentionAt: NOW + 30 * MINUTE }, NOW + HOUR)).toBe(NOW + 30 * MINUTE);
  });

  it("forgets the went-live time once the thread stops being live", () => {
    const live = makeThread({ id: "again", status: "active", latestAttentionAt: NOW - DAY });
    expect(activityTime(live, NOW)).toBe(NOW);
    const idle = { ...live, status: "idle" as const, latestAttentionAt: NOW + MINUTE };
    expect(activityTime(idle, NOW + HOUR)).toBe(NOW + MINUTE);
    expect(activityTime(live, NOW + 2 * HOUR)).toBe(NOW + 2 * HOUR);
  });

  it("remembers went-live times across a reload of the page", async () => {
    const live = makeThread({ id: "reloaded", status: "active", latestAttentionAt: NOW - DAY });
    expect(activityTime(live, NOW)).toBe(NOW);
    expect(JSON.parse(sessionStorage.getItem("radar-sidebar:went-live:v1")!)).toEqual([["reloaded", NOW]]);
    vi.resetModules();
    const reloaded = await import("./time");
    expect(reloaded.activityTime(live, NOW + HOUR)).toBe(NOW);
    // Stopping clears the stored time too.
    reloaded.activityTime({ ...live, status: "idle" }, NOW + HOUR);
    expect(JSON.parse(sessionStorage.getItem("radar-sidebar:went-live:v1")!)).toEqual([]);
  });

  it("keeps at most 500 stored went-live times, dropping the oldest", () => {
    for (let i = 0; i < 510; i++) {
      activityTime(makeThread({ id: `cap-${i}`, status: "active" }), NOW + i);
    }
    const stored = JSON.parse(sessionStorage.getItem("radar-sidebar:went-live:v1")!) as [string, number][];
    expect(stored).toHaveLength(500);
    expect(stored[0]).toEqual(["cap-10", NOW + 10]);
  });

  it("ignores unreadable or failing storage", () => {
    sessionStorage.setItem("radar-sidebar:went-live:v1", "{not json");
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    const live = makeThread({ id: "quota", status: "active", latestAttentionAt: NOW - DAY });
    expect(activityTime(live, NOW)).toBe(NOW);
    expect(activityTime(live, NOW + HOUR)).toBe(NOW);
    setItem.mockRestore();
  });

  it("falls back to the latest attention when the went-live time is unknown", () => {
    const live = makeThread({ id: "unknown", status: "active", latestAttentionAt: NOW - HOUR });
    expect(activityTime(live, Number.NaN)).toBe(NOW - HOUR);
  });

  it("ignores read time: opening a thread must not float it to Today", () => {
    // The bug this guards: reading bumps updatedAt, so grouping off it
    // dragged every visited thread into Today.
    const read = makeThread({
      id: "read",
      status: "idle",
      updatedAt: NOW,
      lastReadAt: NOW,
      latestAttentionAt: NOW - 60 * DAY,
    });
    // Keys off attention, not the freshly-read updatedAt.
    expect(activityTime(read, NOW)).toBe(NOW - 60 * DAY);
    expect(timeGroupFor(activityTime(read, NOW), NOW)).toBe("older");
    // Had it used updatedAt, this same thread would have landed in Today.
    expect(timeGroupFor(read.updatedAt, NOW)).toBe("today");
  });
});

describe("timeGroupFor", () => {
  it("buckets by local day boundaries", () => {
    expect(timeGroupFor(NOW, NOW)).toBe("today");
    expect(timeGroupFor(NOW - DAY - HOUR, NOW)).toBe("yesterday");
    expect(timeGroupFor(NOW - 6 * DAY, NOW)).toBe("week");
    expect(timeGroupFor(NOW - 8 * DAY, NOW)).toBe("month");
    expect(timeGroupFor(NOW - 60 * DAY, NOW)).toBe("older");
  });

  it.each([
    [new Date(2026, 9, 26, 12), new Date(2026, 9, 25), "yesterday", "week"],
    [new Date(2026, 10, 1, 12), new Date(2026, 9, 25), "week", "month"],
    [new Date(2026, 10, 24, 12), new Date(2026, 9, 25), "month", "older"],
    [new Date(2026, 2, 30, 12), new Date(2026, 2, 29), "yesterday", "week"],
    [new Date(2026, 3, 5, 12), new Date(2026, 2, 29), "week", "month"],
    [new Date(2026, 3, 28, 12), new Date(2026, 2, 29), "month", "older"],
  ])("uses calendar boundaries across DST (%s, %s)", (now, boundary, group, preceding) => {
    expect(timeGroupFor(Number(boundary) + 30 * MINUTE, Number(now))).toBe(group);
    expect(timeGroupFor(Number(boundary) - MINUTE, Number(now))).toBe(preceding);
  });
});

describe("timeAgo", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("preserves locale dates with the year only for older years", () => {
    const now = Number(new Date(2026, 8, 30, 12));
    for (const [date, options] of [
      [new Date(2026, 8, 10, 12), { month: "short", day: "numeric" }],
      [new Date(2025, 8, 10, 12), { month: "short", day: "numeric", year: "numeric" }],
    ] as const) {
      expect(timeAgo(Number(date), now)).toBe(date.toLocaleDateString(undefined, options));
    }
    expect(timeAgo(now + DAY, now)).toBe("just now");
  });

  it("reuses two formatters instead of constructing one per old timestamp", () => {
    // Intl's types declare a method; at runtime this is a bound-function getter.
    const formatters = vi.spyOn(Intl.DateTimeFormat.prototype as { format: unknown }, "format", "get");
    const perCallFormatting = vi.spyOn(Date.prototype, "toLocaleDateString");
    const now = Number(new Date(2026, 8, 30, 12));
    for (let i = 0; i < 500; i++) {
      timeAgo(Number(new Date(2026, 8, 10, 12)), now);
      timeAgo(Number(new Date(2025, 8, 10, 12)), now);
    }
    expect(formatters).toHaveBeenCalledTimes(1000);
    expect(new Set(formatters.mock.contexts).size).toBe(2);
    expect(perCallFormatting).not.toHaveBeenCalled();
  });

  it.each([NaN, -Infinity])("preserves the invalid-date fallback for %s", (timestamp) => {
    expect(timeAgo(timestamp, NOW)).toBe("Invalid Date");
  });

  it("shortens recent spans", () => {
    expect(timeAgo(NOW - 30 * 1000, NOW)).toBe("just now");
    expect(timeAgo(NOW - 5 * MINUTE, NOW)).toBe("5m ago");
    expect(timeAgo(NOW - 3 * HOUR, NOW)).toBe("3h ago");
    expect(timeAgo(NOW - DAY, NOW)).toBe("yesterday");
    expect(timeAgo(NOW - 3 * DAY, NOW)).toBe("3d ago");
  });
});

describe("shortAgo", () => {
  it("gives a compact age", () => {
    expect([shortAgo(NOW, NOW), shortAgo(NOW - 3 * MINUTE, NOW), shortAgo(NOW - 2 * HOUR, NOW), shortAgo(NOW - 50 * HOUR, NOW)]).toEqual(["now", "3m", "2h", "2d"]);
  });
});

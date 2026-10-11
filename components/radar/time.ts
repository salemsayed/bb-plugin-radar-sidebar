/** Time grouping + relative timestamps for the thread list. */

import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";

/**
 * True while a thread is live: executing, winding down, running background
 * work (with or without messages queued behind it), or blocked on the user.
 * Queued work alone is not live: on an idle thread it is held (see
 * `isHeldThread`). Live threads count as active right now for grouping and
 * sorting.
 */
export function isLiveThread(thread: PluginSidebarThread): boolean {
  return isRunningThread(thread) || thread.hasPendingInteraction;
}

/**
 * A message parked on an idle thread. BB reports `queuedWork: "waiting"` both
 * for a message queued behind a running turn and for one held on a thread
 * that is not running; only the first will run on its own.
 */
export function isHeldThread(thread: PluginSidebarThread): boolean {
  return (
    thread.queuedWork === "waiting" &&
    !isRunningThread(thread) &&
    !thread.hasPendingInteraction
  );
}

/** A queued message that will run on its own (not held). */
export function isQueuedThread(thread: PluginSidebarThread): boolean {
  return thread.queuedWork === "waiting" && !isHeldThread(thread);
}

/** Execution and background work, excluding queued or blocked work. */
export function isRunningThread(thread: PluginSidebarThread): boolean {
  if (
    thread.status === "starting" ||
    thread.status === "active" ||
    thread.status === "stopping"
  ) {
    return true;
  }
  const activity = thread.activity;
  if (
    activity.workflows +
      activity.backgroundAgents +
      activity.backgroundCommands +
      activity.planMode +
      activity.goals >
    0
  ) {
    return true;
  }
  return false;
}

// When each live thread went live, as first seen by this client. Sorting a
// live thread by `now` floated it to the top on every clock tick, moving rows
// under the pointer; sorting by when it went live places it once. Kept in
// sessionStorage so a reload doesn't restart every live thread's clock.
const WENT_LIVE_KEY = "radar-sidebar:went-live:v1";
const WENT_LIVE_CAP = 500;
let wentLiveAt: Map<string, number> | null = null;

function wentLiveTimes(): Map<string, number> {
  if (wentLiveAt) return wentLiveAt;
  wentLiveAt = new Map();
  try {
    const stored: unknown = JSON.parse(globalThis.sessionStorage?.getItem(WENT_LIVE_KEY) ?? "null");
    if (Array.isArray(stored)) {
      for (const entry of stored) {
        if (Array.isArray(entry) && typeof entry[0] === "string" && Number.isFinite(entry[1])) {
          wentLiveAt.set(entry[0], entry[1]);
        }
      }
    }
  } catch {
    // Unavailable or corrupt storage: start empty.
  }
  return wentLiveAt;
}

function saveWentLive(times: Map<string, number>): void {
  // Oldest first in insertion order: drop those (often deleted threads).
  for (const id of times.keys()) {
    if (times.size <= WENT_LIVE_CAP) break;
    times.delete(id);
  }
  try {
    globalThis.sessionStorage?.setItem(WENT_LIVE_KEY, JSON.stringify([...times]));
  } catch {
    // Storage full or blocked: the in-memory times still apply.
  }
}

/** Forget every went-live time, stored ones included (tests). */
export function resetWentLive(): void {
  wentLiveAt = null;
  try {
    globalThis.sessionStorage?.removeItem(WENT_LIVE_KEY);
  } catch {
    // Nothing stored to forget.
  }
}

/**
 * Last real activity: when a live thread went live (or its latest attention,
 * if that is newer), otherwise the latest attention (completions, failures).
 * Reads bump `updatedAt` but never touch this — merely visiting a thread must
 * not float it to Today.
 */
export function activityTime(
  thread: PluginSidebarThread,
  now: number,
): number {
  const times = wentLiveTimes();
  if (!isLiveThread(thread)) {
    if (times.delete(thread.id)) saveWentLive(times);
    return thread.latestAttentionAt;
  }
  let since = times.get(thread.id);
  if (since === undefined) {
    if (!Number.isFinite(now)) return thread.latestAttentionAt;
    since = now;
    times.set(thread.id, since);
    saveWentLive(times);
  }
  return Math.max(since, thread.latestAttentionAt);
}

export type TimeGroupId = "today" | "yesterday" | "week" | "month" | "older";

export const TIME_GROUP_ORDER: readonly TimeGroupId[] = [
  "today",
  "yesterday",
  "week",
  "month",
  "older",
];

export const TIME_GROUP_LABELS: Record<TimeGroupId, string> = {
  today: "Today",
  yesterday: "Yesterday",
  week: "Previous 7 days",
  month: "Previous 30 days",
  older: "Older",
};

function startOfLocalDay(ts: number, daysAgo = 0): number {
  const date = new Date(ts);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - daysAgo);
  return date.getTime();
}

export function timeGroupFor(updatedAt: number, now: number): TimeGroupId {
  const todayStart = startOfLocalDay(now);
  if (updatedAt >= todayStart) return "today";
  if (updatedAt >= startOfLocalDay(now, 1)) return "yesterday";
  if (updatedAt >= startOfLocalDay(now, 7)) return "week";
  if (updatedAt >= startOfLocalDay(now, 30)) return "month";
  return "older";
}

// Reuse locale formatters: toLocaleDateString constructs one on every call.
const shortDateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short", day: "numeric",
});
const fullDateFormatter = new Intl.DateTimeFormat(undefined, {
  month: "short", day: "numeric", year: "numeric",
});

export function timeAgo(ts: number, now: number): string {
  const diff = Math.max(0, now - ts);
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days}d ago`;
  const date = new Date(ts);
  // Preserve Date#toLocaleDateString's fallback instead of Intl throwing.
  if (Number.isNaN(date.getTime())) return "Invalid Date";
  const sameYear = new Date(now).getFullYear() === date.getFullYear();
  return (sameYear ? shortDateFormatter : fullDateFormatter).format(date);
}

/** Compact age for dense rows: now, 3m, 2h, 2d. */
export function shortAgo(ts: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - ts) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

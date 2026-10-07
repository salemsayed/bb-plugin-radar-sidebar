import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { botState, needsYou, type BotState, type Pulse, type RosterBot } from "./bots";
import { isLiveThread } from "./time";

/** Include descendants across projects, including lifecycle-owned workers.
 * Iteration handles unordered input and protects against cycles. */
function descendants(threads: readonly PluginSidebarThread[], seeds: Iterable<string>): Set<string> {
  const ids = new Set(seeds);
  let changed = true;
  while (changed) {
    changed = false;
    for (const thread of threads) {
      if (!ids.has(thread.id) &&
          ((thread.parentThreadId && ids.has(thread.parentThreadId)) ||
           (thread.lifecycleOwnerThreadId && ids.has(thread.lifecycleOwnerThreadId)))) {
        ids.add(thread.id);
        changed = true;
      }
    }
  }
  return ids;
}

export function botCoordinatorIds(bot: RosterBot): Set<string> {
  return new Set([bot.current, ...(bot.coordinatorIds ?? [])]);
}

/** Visible workers only; coordinators live in the rail and hidden helpers stay hidden. */
export function botWorkers(threads: readonly PluginSidebarThread[], bot: RosterBot): PluginSidebarThread[] {
  const ids = botScopeIds(threads, bot);
  const roots = botCoordinatorIds(bot);
  return threads.filter(t => ids.has(t.id) && !roots.has(t.id) && !t.isHidden && !t.isArchived);
}

export function botScopeIds(threads: readonly PluginSidebarThread[], bot: RosterBot): Set<string> {
  return descendants(threads, botCoordinatorIds(bot));
}

/** Indicators describe the coordinator family, never unrelated project work. */
export function botRailState(threads: readonly PluginSidebarThread[], bot: RosterBot, pulse: Pulse | null): BotState {
  const ids = botScopeIds(threads, bot);
  const family = threads.filter(t => ids.has(t.id) && !t.isHidden && !t.isArchived);
  if (family.some(t => t.status === "error" || t.indicator === "unread-error" || t.indicator === "queued-failed")) return "failed";
  if (family.some(needsYou)) return "needs-you";
  const coordinator = threads.find(t => t.id === bot.current);
  const state = botState(coordinator, pulse, bot.rollover);
  if (state === "decision") return state;
  if (family.some(isLiveThread)) return "working";
  return state === "idle" && family.some(t => t.isUnread) ? "unread" : state;
}

/** Creation/archive changes trigger a roster refresh, without polling each token. */
export function rosterRefreshKey(threads: readonly PluginSidebarThread[]): string {
  return threads.map(t => `${t.id}:${t.isArchived}`).sort().join("|");
}

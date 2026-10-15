import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { botState, needsYou, type BotState, type Pulse, type RosterBot } from "./bots";
import { isRunningThread } from "./time";

/** Per threads array: child index, the family of each coordinator set, and the refresh key.
 * The sidebar hands the same array to every render until something changes, so
 * walking it once per bot per array replaces walking it per bot per render. */
interface ThreadsIndex {
  byId: Map<string, PluginSidebarThread>;
  childrenOf: Map<string, PluginSidebarThread[]>;
  scopes: Map<string, Set<string>>;
  families: Map<string, PluginSidebarThread[]>;
  refreshKey: string | null;
}
const indexes = new WeakMap<readonly PluginSidebarThread[], ThreadsIndex>();

function indexOf(threads: readonly PluginSidebarThread[]): ThreadsIndex {
  let index = indexes.get(threads);
  if (index) return index;
  const byId = new Map<string, PluginSidebarThread>();
  const childrenOf = new Map<string, PluginSidebarThread[]>();
  const link = (owner: string | null | undefined, thread: PluginSidebarThread) => {
    if (!owner) return;
    const list = childrenOf.get(owner);
    if (list) list.push(thread);
    else childrenOf.set(owner, [thread]);
  };
  for (const thread of threads) {
    byId.set(thread.id, thread);
    link(thread.parentThreadId, thread);
    if (thread.lifecycleOwnerThreadId !== thread.parentThreadId) link(thread.lifecycleOwnerThreadId, thread);
  }
  index = { byId, childrenOf, scopes: new Map(), families: new Map(), refreshKey: null };
  indexes.set(threads, index);
  return index;
}

/** Include descendants across projects, including lifecycle-owned workers.
 * Breadth-first over the child index handles unordered input and cycles. */
function descendants(index: ThreadsIndex, seeds: Iterable<string>): Set<string> {
  const ids = new Set(seeds);
  const queue = [...ids];
  while (queue.length > 0) {
    const id = queue.pop()!;
    for (const child of index.childrenOf.get(id) ?? []) {
      if (ids.has(child.id)) continue;
      ids.add(child.id);
      queue.push(child.id);
    }
  }
  return ids;
}

function scopeKey(bot: RosterBot): string {
  return [bot.current, ...(bot.coordinatorIds ?? [])].join("\u0000");
}

export function botCoordinatorIds(bot: RosterBot): Set<string> {
  return new Set([bot.current, ...(bot.coordinatorIds ?? [])]);
}

export function botScopeIds(threads: readonly PluginSidebarThread[], bot: RosterBot): Set<string> {
  const index = indexOf(threads);
  const key = scopeKey(bot);
  let ids = index.scopes.get(key);
  if (!ids) {
    ids = descendants(index, botCoordinatorIds(bot));
    index.scopes.set(key, ids);
  }
  return ids;
}

/** The coordinator family as the user sees it: coordinators plus visible, unarchived descendants, in sidebar order. */
export function botFamily(threads: readonly PluginSidebarThread[], bot: RosterBot): readonly PluginSidebarThread[] {
  const index = indexOf(threads);
  const key = scopeKey(bot);
  let family = index.families.get(key);
  if (!family) {
    const ids = botScopeIds(threads, bot);
    family = threads.filter(t => ids.has(t.id) && !t.isHidden && !t.isArchived);
    index.families.set(key, family);
  }
  return family;
}

/** Visible workers only; coordinators live in the rail and hidden helpers stay hidden. */
export function botWorkers(threads: readonly PluginSidebarThread[], bot: RosterBot): PluginSidebarThread[] {
  const roots = botCoordinatorIds(bot);
  return botFamily(threads, bot).filter(t => !roots.has(t.id));
}

/** Coverage belongs to the census, never the filtered/displayed rows. */
export interface ActivityCoverage {
  complete: boolean;
  staleThreads: readonly PluginSidebarThread[];
}

/** Active-only server lists can omit an archived ancestor. Unless a row is
 * already attached to a registered family, a dangling ownership link means
 * the census cannot prove that no additional bot work exists. */
export function hasUnresolvedActivity(threads: readonly PluginSidebarThread[], bots: readonly RosterBot[]): boolean {
  const known = new Set([...threads.map(thread => thread.id), ...bots.flatMap(bot => [...botCoordinatorIds(bot)])]);
  const assigned = new Set(bots.flatMap(bot => [...botScopeIds(threads, bot)]));
  return threads.some(thread => !thread.isArchived && !assigned.has(thread.id) &&
    [thread.parentThreadId, thread.lifecycleOwnerThreadId].some(owner => owner && !known.has(owner)));
}

/** Execution and attention are independent of the primary failure badge.
 * Include hidden lifecycle-owned work in counts without exposing hidden rows. */
export function botActivity(threads: readonly PluginSidebarThread[], bot: RosterBot, pulse: Pulse | null, coverage?: ActivityCoverage) {
  const known = indexOf(threads).byId;
  const stale = coverage?.staleThreads.filter(thread => !known.has(thread.id)) ?? [];
  const ids = botScopeIds(stale.length ? [...threads, ...stale] : threads, bot);
  const roots = botCoordinatorIds(bot);
  const family = threads.filter(thread => ids.has(thread.id) && !thread.isArchived);
  const workers = family.filter(thread => !roots.has(thread.id));
  const coordinator = family.find(thread => thread.id === bot.current);
  const staleFamily = stale.filter(thread => ids.has(thread.id) && !thread.isArchived);
  const staleWorkers = staleFamily.filter(thread => !roots.has(thread.id));
  return {
    ...(coverage ? { complete: coverage.complete, lastKnownWorkers: staleWorkers.length, lastKnownActive: staleFamily.filter(isRunningThread).length,
      lastKnownQuestions: staleFamily.filter(thread => thread.hasPendingInteraction).length } : {}),
    workers: workers.length + staleWorkers.length,
    hiddenWorkers: [...workers, ...staleWorkers].filter(thread => thread.isHidden).length,
    active: family.filter(isRunningThread).length,
    questions: family.filter(thread => thread.hasPendingInteraction || thread.indicator === "waiting-for-input").length,
    decisions: Math.max(bot.actionableNeeds ?? 0, pulse?.decision && (!coordinator || !isRunningThread(coordinator)) ? 1 : 0),
  };
}
export type BotActivity = ReturnType<typeof botActivity>;

export function botActivityText(activity: BotActivity): string {
  const parts = [activity.complete === false && activity.workers === 0 ? "Worker count unavailable" : `${activity.workers} worker${activity.workers === 1 ? "" : "s"}`];
  if (activity.active) parts.push(`${activity.active} active`);
  if (activity.lastKnownActive) parts.push(`${activity.lastKnownActive} last known active`);
  if (activity.lastKnownQuestions) parts.push(`${activity.lastKnownQuestions} last known waiting on you`);
  if (activity.questions) parts.push(`${activity.questions} waiting on you`);
  if (activity.decisions) parts.push(`${activity.decisions} decision${activity.decisions === 1 ? "" : "s"}`);
  if (activity.complete === false) parts.push(activity.lastKnownWorkers ? "Activity incomplete; includes last known workers" : activity.workers > 0 ? "Activity incomplete; counts are lower bounds" : "Activity incomplete");
  return parts.join(" · ");
}

/** Indicators describe the coordinator family, never unrelated project work. */
export function botRailState(threads: readonly PluginSidebarThread[], bot: RosterBot, pulse: Pulse | null, coverage?: ActivityCoverage): BotState {
  const known = indexOf(threads).byId;
  const stale = coverage?.staleThreads.filter(thread => !known.has(thread.id)) ?? [];
  const ids = botScopeIds(stale.length ? [...threads, ...stale] : threads, bot);
  const family = threads.filter(t => ids.has(t.id) && !t.isArchived);
  if (bot.rolloverBlocked) return "failed";
  if (family.some(t => t.status === "error" || t.queuedWork === "failed" || t.indicator === "unread-error" || t.indicator === "queued-failed")) return "failed";
  if (family.some(needsYou)) return "needs-you";
  if ((bot.actionableNeeds ?? 0) > 0) return "decision";
  const coordinator = indexOf(threads).byId.get(bot.current);
  const state = botState(coordinator, pulse, bot.rollover, undefined, bot.rolloverBlocked);
  if (state === "failed" || state === "decision" || state === "rollover") return state;
  if (family.some(isRunningThread)) return "working";
  if (coverage && !coverage.complete && (state === "idle" || state === "unavailable")) return "unavailable";
  if (bot.unseenAttention !== undefined) {
    if (bot.unseenAttention > 0 && (state === "idle" || state === "unread")) return "unread";
    return state === "unread" ? coverage?.complete === false ? "unavailable" : "idle" : state;
  }
  return state === "idle" && family.some(t => t.isUnread) ? "unread" : state;
}

/** Order-independent 32-bit mix of a string (FNV-1a), so sorting is unnecessary. */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Creation/archive changes trigger a roster refresh, without polling each token.
 * Count, archived count and an order-independent id digest change on any
 * create, archive or unarchive while reordering and timestamps leave it alone. */
export function rosterRefreshKey(threads: readonly PluginSidebarThread[]): string {
  const index = indexOf(threads);
  if (index.refreshKey !== null) return index.refreshKey;
  let archived = 0;
  let digest = 0;
  for (const thread of threads) {
    if (thread.isArchived) archived++;
    digest = (digest + hash(`${thread.id}:${thread.isArchived ? 1 : 0}`)) >>> 0;
  }
  index.refreshKey = `${threads.length}:${archived}:${digest.toString(36)}`;
  return index.refreshKey;
}

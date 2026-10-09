import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { RosterBot } from "./bots";
import { botCoordinatorIds, botScopeIds } from "./botScope";
import { isRunningThread } from "./time";

export type CrewActivityState = "failed" | "working" | "queued" | "waiting" | "handover" | "unavailable" | "idle";
export interface CrewBotActivity {
  bot: RosterBot;
  state: CrewActivityState;
  threadId: string;
  text: string;
  workers: number;
  more: number;
  pending: PluginSidebarThread[];
}

const rank: Record<CrewActivityState, number> = { failed: 0, working: 1, queued: 2, waiting: 3, handover: 4, unavailable: 5, idle: 6 };
function stateOf(thread: PluginSidebarThread): CrewActivityState {
  if (thread.status === "error" || thread.queuedWork === "failed" || thread.indicator === "unread-error" || thread.indicator === "queued-failed") return "failed";
  if (thread.runtimeStatus === "waiting-for-host" || thread.runtimeStatus === "provisioning") return "waiting";
  if (isRunningThread(thread)) return "working";
  if (thread.queuedWork === "waiting") return "queued";
  return "idle";
}

/** Read runtime evidence only. Imports, project membership and prose never create activity. */
export function crewActivity(roster: readonly RosterBot[], threads: readonly PluginSidebarThread[]): CrewBotActivity[] {
  return roster.map(bot => {
    const ids = botScopeIds(threads, bot);
    const roots = botCoordinatorIds(bot);
    // Include hidden running automation children and workers left with a registered predecessor.
    const family = threads.filter(t => ids.has(t.id) && !t.isArchived && (t.id === bot.current || !roots.has(t.id)));
    const pending = family.filter(t => t.hasPendingInteraction || t.indicator === "waiting-for-input");
    const candidates = family.filter(t => !pending.includes(t) && stateOf(t) !== "idle")
      .sort((a, b) => rank[stateOf(a)] - rank[stateOf(b)] || Number(roots.has(a.id)) - Number(roots.has(b.id)) || b.updatedAt - a.updatedAt);
    const target = candidates[0];
    const state = target ? stateOf(target) : bot.rollover ? "handover" : family.some(t => t.id === bot.current) ? "idle" : "unavailable";
    const coordinatorText = state === "working" ? "Coordinator working" : state === "queued" ? "Coordinator waiting to run" : state === "failed" ? "The coordinator's last turn failed" : "Waiting for its machine";
    return {
      bot, state, threadId: target?.id ?? bot.current,
      text: target ? target.id === bot.current ? coordinatorText : target.displayTitle : state === "handover" ? "Coordinator handover in progress" : state === "unavailable" ? "Bot status unavailable" : pending.length ? "Waiting for your answer above" : "No work in progress",
      workers: candidates.filter(t => !roots.has(t.id) && stateOf(t) === "working").length,
      more: Math.max(0, candidates.length - 1), pending,
    };
  }).sort((a, b) => rank[a.state] - rank[b.state]);
}

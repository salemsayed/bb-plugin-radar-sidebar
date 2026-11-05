import { useMemo } from "react";
import { experimental_useSidebarThreads, type PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { useBotRoster } from "./useBotRoster";
import { botScopeIds } from "./botScope";
import type { RosterBot } from "./bots";
import { useBotTasks } from "./useBotTasks";

export function looseThreads(threads: readonly PluginSidebarThread[], bots: readonly RosterBot[]): PluginSidebarThread[] {
  const owned = new Set(bots.flatMap(bot => [...botScopeIds(threads, bot), ...(bot.deskThreadIds ?? [])]));
  const eligible = (thread: PluginSidebarThread) => !thread.isHidden && !thread.isArchived && !owned.has(thread.id) && !thread.originPluginId?.includes("composer-predictions");
  const owners = (thread: PluginSidebarThread) => [thread.parentThreadId, thread.lifecycleOwnerThreadId].filter((id): id is string => !!id);
  const childrenOf = new Map<string, PluginSidebarThread[]>();
  for (const thread of threads) {
    for (const owner of new Set(owners(thread))) {
      const list = childrenOf.get(owner);
      if (list) list.push(thread);
      else childrenOf.set(owner, [thread]);
    }
  }
  const loose: PluginSidebarThread[] = [];
  const seen = new Set<string>();
  const visit = (thread: PluginSidebarThread) => {
    if (seen.has(thread.id) || !eligible(thread)) return;
    seen.add(thread.id);
    loose.push(thread);
    for (const child of childrenOf.get(thread.id) ?? []) visit(child);
  };
  const roots = threads.filter(thread => eligible(thread) && !thread.originPluginId && owners(thread).length === 0)
    .sort((a, b) => b.latestAttentionAt - a.latestAttentionAt);
  for (const root of roots) visit(root);
  return loose;
}

export function useThreadClaims() {
  const { threads, projects, status } = experimental_useSidebarThreads();
  const bots = useBotRoster(true);
  const desksLoaded = useBotTasks(true).data != null;
  return useMemo(() => {
    const loose = looseThreads(threads, bots);
    const byBot: Record<string, PluginSidebarThread[]> = {};
    for (const thread of loose) {
      const matches = bots.filter(bot => [bot.projectId, ...bot.projects, ...(bot.key === "personal" ? ["proj_personal"] : [])].includes(thread.projectId));
      if (matches.length === 1) (byBot[matches[0].key] ??= []).push(thread);
    }
    const projectName = new Map(projects.map(project => [project.id, project.name]));
    return { byBot, loose, projectName, ready: bots.length > 0 && desksLoaded && status === "ready" };
  }, [threads, projects, bots, desksLoaded, status]);
}

export function ClaimedThreads({ threads, onOpen }: { threads: readonly PluginSidebarThread[]; onOpen: (id: string) => void }) {
  if (!threads.length) return null;
  return <section className="radar-claimed" aria-label="Started by you"><header className="dispatch-section-head"><h3>Started by you</h3><span>{threads.length}</span></header>{threads.map(thread => <button type="button" className="radar-desk-row" key={thread.id} onClick={() => onOpen(thread.id)}><span className="radar-desk-copy" dir="auto">{thread.displayTitle}</span></button>)}</section>;
}

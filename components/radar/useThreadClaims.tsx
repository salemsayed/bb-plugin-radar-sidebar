import { useMemo } from "react";
import { experimental_useSidebarThreads, type PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { useBotRoster } from "./useBotRoster";
import { botScopeIds } from "./botScope";
import type { RosterBot } from "./bots";
import { useBotTasks } from "./useBotTasks";
import { Icon } from "@/components/ui/icon";
import { Isolated } from "./Isolated";
import { shortAgo } from "./time";

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

export function ChatCard({ title, status, onOpen, tone = "quiet" }: { title: string; status: string; onOpen: () => void; tone?: string }) {
  return <article className="dispatch-task-group dispatch-card" data-tone={tone}>
    <div className="dispatch-card-head">
      <button type="button" className="dispatch-task" aria-label={`${title}. ${status}`} onClick={onOpen}><b dir="auto"><Isolated text={title} /></b></button>
      <button type="button" className="dispatch-task-continue" aria-label={`Open the chat for ${title}`} title="Opens this chat" onClick={onOpen}><span className="dispatch-continue-pill"><Icon name="MessageSquare" aria-hidden="true" />Open chat</span></button>
    </div>
    <div className="dispatch-card-ask" aria-hidden="true" onClick={onOpen}><span className="dispatch-status-line"><i aria-hidden="true" /><span dir="auto">{status}</span></span></div>
  </article>;
}

export function ClaimedThreads({ threads, onOpen }: { threads: readonly PluginSidebarThread[]; onOpen: (id: string) => void }) {
  if (!threads.length) return null;
  const now = Date.now();
  return <section className="radar-claimed" aria-label="Started by you"><header className="dispatch-section-head"><h3>Started by you</h3><span>{threads.length}</span></header>
    <div className="dispatch-open">{threads.map(thread => {
      const age = shortAgo(thread.latestAttentionAt, now);
      return <ChatCard key={thread.id} title={thread.displayTitle} status={`Your chat${age ? ` \u00b7 active ${age === "now" ? "just now" : `${age} ago`}` : ""}`} onOpen={() => onOpen(thread.id)} />;
    })}</div>
  </section>;
}

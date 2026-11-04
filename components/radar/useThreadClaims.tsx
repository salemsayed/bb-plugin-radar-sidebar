import { useMemo } from "react";
import { experimental_useSidebarThreads, type PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { useBotRoster } from "./useBotRoster";
import { botScopeIds } from "./botScope";

export function useThreadClaims() {
  const { threads, status } = experimental_useSidebarThreads();
  const bots = useBotRoster(true);
  return useMemo(() => {
    const owned = new Set(bots.flatMap(bot => [...botScopeIds(threads, bot), ...(bot.deskThreadIds ?? [])]));
    const byBot: Record<string, PluginSidebarThread[]> = {};
    const other: PluginSidebarThread[] = [];
    const eligible = threads.filter(thread => !thread.isHidden && !thread.isArchived && !thread.originPluginId?.includes("composer-predictions"));
    for (const thread of eligible) {
      if (owned.has(thread.id)) continue;
      const matches = bots.filter(bot => [bot.projectId, ...bot.projects, ...(bot.key === "personal" ? ["proj_personal"] : [])].includes(thread.projectId));
      if (matches.length === 1) (byBot[matches[0].key] ??= []).push(thread);
      else other.push(thread);
    }
    const surfaced = new Set([...owned, ...Object.values(byBot).flat().map(thread => thread.id), ...other.map(thread => thread.id)]);
    return { byBot, other, onlyThreads: eligible.filter(thread => !surfaced.has(thread.id)).length, ready: bots.length > 0 && status === "ready", total: eligible.length };
  }, [threads, bots, status]);
}
export function ClaimedThreads({ threads, onOpen }: { threads: readonly PluginSidebarThread[]; onOpen: (id: string) => void }) {
  if (!threads.length) return null;
  return <section className="radar-claimed" aria-label="Started by you"><header className="dispatch-section-head"><h3>Started by you</h3><span>{threads.length}</span></header>{threads.map(thread => <button type="button" className="radar-desk-row" key={thread.id} onClick={() => onOpen(thread.id)}><span className="radar-desk-copy" dir="auto">{thread.displayTitle}</span></button>)}</section>;
}

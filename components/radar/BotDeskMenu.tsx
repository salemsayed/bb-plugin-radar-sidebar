import { createContext, useContext, useMemo, type ReactNode } from "react";
import {
  experimental_THREAD_ACTION_GROUPS,
  experimental_ThreadActionsContextMenu as ThreadActionsContextMenu,
  experimental_useSidebarThreads,
  type PluginSidebarThread,
  type PluginThreadActionTarget,
  type PluginThreadActionsInlineItem,
} from "@get-bb/plugin-sdk/app";
import { threadActionTarget } from "./threadActions";
import type { DeskMenuProps } from "./BotsView";

/** The sidebar's threads by id, read once for every desk rather than once per desk. */
const SidebarThreads = createContext<ReadonlyMap<string, PluginSidebarThread>>(new Map());

export function BotDeskMenuProvider({ children }: { children: ReactNode }) {
  const { threads } = experimental_useSidebarThreads();
  const byId = useMemo(() => new Map(threads.map(thread => [thread.id, thread])), [threads]);
  return <SidebarThreads.Provider value={byId}>{children}</SidebarThreads.Provider>;
}

/** A coordinator the sidebar does not list (hidden, or not loaded yet) still gets its menu, from its id alone. */
export function coordinatorTarget(thread: PluginSidebarThread | undefined, threadId: string): PluginThreadActionTarget {
  if (thread) return threadActionTarget(thread);
  return { ...{ parentNotifications: "auto" as const }, id: threadId, projectId: "", parentThreadId: null, archivedAt: null, pinnedAt: null, sectionId: null, isUnread: false, status: "idle", environment: null };
}

/**
 * A desk's menu (Salem, thr_2gjivwx8ea seq 2358: "I'm unable to open the bot context menu at all"): bb's own
 * thread menu for the bot's coordinator, the same one its row in Threads opens (pin, rename, notifications,
 * other plugins' actions, archive, delete), with Open chat on top (a tap on the desk shows the bot's work).
 * bb opens it on right-click and on a long-press; the desk turns its own long-press into the same event.
 */
export function BotDeskMenu({ bot, children, onOpenChat }: DeskMenuProps) {
  const threads = useContext(SidebarThreads);
  const target = coordinatorTarget(threads.get(bot.coordinatorThreadId), bot.coordinatorThreadId);
  const inline = useMemo<PluginThreadActionsInlineItem[]>(() => [
    { key: "radar-sidebar/bot-open-chat", group: experimental_THREAD_ACTION_GROUPS.open,
      action: { label: "Open chat", icon: "MessageSquare", run: onOpenChat } },
  ], [onOpenChat]);
  return <ThreadActionsContextMenu thread={target} inline={inline}>{children}</ThreadActionsContextMenu>;
}

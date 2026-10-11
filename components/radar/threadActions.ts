import { useMemo, useRef } from "react";
import { useBbNavigate, useSdk, type PluginSidebarThread, type PluginThreadActionEntry, type PluginThreadActionTarget } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";

export function threadActionTarget(thread: PluginSidebarThread): PluginThreadActionTarget {
  return {
    id: thread.id, projectId: thread.projectId, parentThreadId: thread.parentThreadId,
    archivedAt: thread.archivedAt, pinnedAt: thread.pinnedAt, sectionId: thread.sectionId,
    isUnread: thread.isUnread, status: thread.status,
    environment: thread.environment?.id ? { id: thread.environment.id, path: thread.environment.path } : null,
  };
}

export function runThreadAction(entries: readonly PluginThreadActionEntry[], key: string) {
  const entry = entries.find(entry => entry.key === key);
  if (!entry || entry.action.disabled) return;
  void entry.action.run().catch(() => toast.error("Couldn't update thread"));
}

/** Data and navigation use public SDK APIs. Destructive actions keep BB's
 * registered confirmation, Undo, pane closing and route repair flows. Rows
 * supply the same bound actions their native menus use for keyboard/bulk use. */
export function useRadarThreadActions() {
  const sdk = useSdk();
  const navigate = useBbNavigate();
  const registered = useRef(new Map<string, readonly PluginThreadActionEntry[]>());
  return useMemo(() => {
    const run = (threadId: string, key: string) => {
      runThreadAction(registered.current.get(threadId) ?? [], key);
    };
    return {
      open: (threadId: string, options?: { split?: boolean }) => navigate.toThread(threadId, options),
      openNewThread: (options: { projectId: string; focusPrompt?: boolean }) => navigate.toCompose(options),
      setPinned: (threadId: string, pinned: boolean) => pinned ? sdk.threads.pin({ threadId }) : sdk.threads.unpin({ threadId }),
      setRead: (threadId: string, read: boolean) => read ? sdk.threads.markRead({ threadId }) : sdk.threads.markUnread({ threadId }),
      rename: (threadId: string, title: string) => sdk.threads.update({ threadId, title }),
      archive: (threadId: string) => run(threadId, "bb--core/archive"),
      requestDelete: (threadId: string) => run(threadId, "bb--core/delete"),
      register: (threadId: string, entries: readonly PluginThreadActionEntry[]) => {
        registered.current.set(threadId, entries);
        return () => { if (registered.current.get(threadId) === entries) registered.current.delete(threadId); };
      },
    };
  }, [sdk, navigate]);
}

export type RadarThreadActions = ReturnType<typeof useRadarThreadActions>;

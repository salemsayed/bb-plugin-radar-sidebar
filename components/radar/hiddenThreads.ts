import { useEffect, useMemo, useState } from "react";
import { useSdk, type PluginBrowserBbSdk, type PluginSidebarThread } from "@get-bb/plugin-sdk/app";

/** One row of `sdk.threads.list`: bb's raw thread, not the sidebar's view of it. */
export type ListedThread = Awaited<ReturnType<PluginBrowserBbSdk["threads"]["list"]>>[number];

export const HIDDEN_CHANGED = "radar:hidden-changed";
/** A row action changed a thread's visibility: refetch now instead of on the next tick. */
export function hiddenChanged() { window.dispatchEvent(new Event(HIDDEN_CHANGED)); }

const LIST_LIMIT = 200;

/**
 * A hidden thread from `threads.list` as a sidebar row. Hidden rows never count
 * as unread, pinned or waiting, so those fields stay quiet; the rest is copied
 * from what the list response carries. `feed` lends a host name and the href
 * shape bb uses for that project.
 */
export function toSidebarThread(raw: ListedThread, feed: readonly PluginSidebarThread[] = []): PluginSidebarThread {
  const sibling = feed.find(thread => thread.projectId === raw.projectId && thread.href.endsWith(`/${thread.id}`));
  const hostName = raw.environmentHostId ? feed.find(thread => thread.host?.id === raw.environmentHostId)?.host?.name : undefined;
  return {
    id: raw.id,
    projectId: raw.projectId,
    title: raw.title,
    titleFallback: raw.titleFallback,
    displayTitle: raw.title ?? raw.titleFallback ?? raw.id,
    parentThreadId: raw.parentThreadId,
    lifecycleOwnerThreadId: raw.lifecycleOwnerThreadId,
    sourceThreadId: raw.sourceThreadId,
    sectionId: raw.sectionId,
    originKind: raw.originKind,
    originPluginId: raw.originPluginId,
    providerId: raw.providerId,
    status: raw.status,
    runtimeStatus: raw.runtime?.displayStatus ?? raw.status,
    queuedWork: "none",
    hasPendingInteraction: false,
    activity: {
      workflows: raw.activity?.activeWorkflowCount ?? 0,
      backgroundAgents: raw.activity?.activeBackgroundAgentCount ?? 0,
      backgroundCommands: raw.activity?.activeBackgroundCommandCount ?? 0,
      planMode: raw.activity?.activePlanModeCount ?? 0,
      goals: raw.activity?.activeGoalCount ?? 0,
    },
    indicator: "none",
    indicatorLabel: null,
    isUnread: false,
    isPinned: false,
    pinnedAt: null,
    pinSortKey: null,
    isArchived: raw.archivedAt !== null,
    archivedAt: raw.archivedAt,
    href: sibling
      ? `${sibling.href.slice(0, -sibling.id.length)}${raw.id}`
      : `/projects/${raw.projectId}/threads/${raw.id}`,
    isHidden: true,
    environment: raw.environmentId === null ? null : {
      id: raw.environmentId,
      name: raw.environmentName,
      branchName: raw.environmentBranchName,
      path: raw.environmentPath,
      isWorktree: raw.environmentIsWorktree,
      providerId: raw.environmentProviderId,
      workspaceDisplayKind: raw.environmentWorkspaceDisplayKind ?? null,
    },
    host: raw.environmentHostId && hostName ? { id: raw.environmentHostId, name: hostName } : null,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    lastReadAt: raw.lastReadAt,
    latestAttentionAt: raw.updatedAt,
  };
}

/** Hidden workers the feed does not already carry, appended after it. Hidden
 * roots (retired coordinators, plugin helpers) are not workers and stay out. */
export function mergeHiddenThreads(
  feed: readonly PluginSidebarThread[],
  hidden: readonly ListedThread[],
): readonly PluginSidebarThread[] {
  const known = new Set(feed.map(thread => thread.id));
  const extra: PluginSidebarThread[] = [];
  for (const raw of hidden) {
    if (raw.visibility !== "hidden" || known.has(raw.id)) continue;
    if (!raw.parentThreadId && !raw.lifecycleOwnerThreadId) continue;
    known.add(raw.id);
    extra.push(toSidebarThread(raw, feed));
  }
  return extra.length === 0 ? feed : [...feed, ...extra];
}

/**
 * bb's sidebar feed leaves hidden threads out, so with the option on Radar
 * lists each project itself, including hidden threads. Refetches on `tick`,
 * window focus and {@link hiddenChanged}; off, it fetches and keeps nothing.
 */
export function useHiddenThreads(enabled: boolean, projectIds: readonly string[], tick: unknown): readonly ListedThread[] {
  const sdk = useSdk();
  const [rows, setRows] = useState<readonly ListedThread[]>([]);
  const [nudge, setNudge] = useState(0);
  const projectKey = useMemo(() => [...new Set(projectIds)].sort().join("\u0000"), [projectIds]);
  useEffect(() => {
    if (!enabled) return;
    const bump = () => setNudge(value => value + 1);
    window.addEventListener("focus", bump);
    window.addEventListener(HIDDEN_CHANGED, bump);
    return () => {
      window.removeEventListener("focus", bump);
      window.removeEventListener(HIDDEN_CHANGED, bump);
    };
  }, [enabled]);
  useEffect(() => {
    if (!enabled || projectKey === "") {
      setRows([]);
      return;
    }
    const controller = new AbortController();
    const projects = projectKey.split("\u0000");
    void Promise.all(projects.map(async projectId => {
      try {
        const listed = await sdk.threads.list({ projectId, includeHidden: true, archived: false, limit: LIST_LIMIT, signal: controller.signal });
        return listed.filter(thread => thread.visibility === "hidden");
      } catch (error) {
        if (!controller.signal.aborted) console.warn(`radar: hidden threads for ${projectId} failed`, error);
        return null;
      }
    })).then(lists => {
      if (controller.signal.aborted) return;
      // A project whose request failed keeps the rows it had.
      setRows(previous => projects.flatMap((projectId, index) =>
        lists[index] ?? previous.filter(thread => thread.projectId === projectId)));
    });
    return () => controller.abort();
  }, [enabled, projectKey, tick, nudge, sdk]);
  return enabled ? rows : [];
}

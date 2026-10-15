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

/** A bounded, independent census. Display preferences never invalidate it.
 * A failed, expired or truncated read is not evidence of zero activity. */
export const ACTIVITY_MAX_AGE = 120_000;
const MAX_PAGES = 10;
interface ProjectCensus { rows: readonly ListedThread[]; staleRows?: readonly ListedThread[]; checkedAt: number; complete: boolean }
export function useThreadCensus(enabled: boolean, projectIds: readonly string[], tick: unknown) {
  const sdk = useSdk();
  const [state, setState] = useState<{ key: string; snapshots: Record<string, ProjectCensus> }>({ key: "", snapshots: {} });
  const [nudge, setNudge] = useState(0);
  const projectKey = useMemo(() => [...new Set(projectIds)].sort().join("\u0000"), [projectIds]);
  useEffect(() => {
    if (!enabled) return;
    const bump = () => setNudge(value => value + 1);
    window.addEventListener("focus", bump);
    window.addEventListener(HIDDEN_CHANGED, bump);
    return () => { window.removeEventListener("focus", bump); window.removeEventListener(HIDDEN_CHANGED, bump); };
  }, [enabled]);
  useEffect(() => {
    if (!enabled || !projectKey) return;
    const controller = new AbortController();
    const projects = projectKey.split("\u0000");
    // A refresh has no current observations until its pages arrive. Keep old
    // observations only as explicitly stale, and never carry them across scopes.
    setState(previous => ({ key: projectKey, snapshots: Object.fromEntries(projects.map(id => {
      const old = previous.key === projectKey ? previous.snapshots[id] : undefined;
      const cached = [...new Map([...(old?.rows ?? []), ...(old?.staleRows ?? [])].map(row => [row.id, row])).values()];
      return [id, { rows: [], staleRows: cached, checkedAt: 0, complete: false }];
    })) }));
    const publish = (id: string, rows: Map<string, ListedThread>, complete: boolean) => {
      if (controller.signal.aborted) return;
      const current = [...rows.values()];
      setState(previous => {
        if (controller.signal.aborted || previous.key !== projectKey) return previous;
        const old = previous.snapshots[id];
        const cached = new Map([...(old?.rows ?? []), ...(old?.staleRows ?? [])].map(row => [row.id, row]));
        const staleRows = complete ? [] : [...cached.values()].filter(row => !rows.has(row.id));
        return { key: projectKey, snapshots: { ...previous.snapshots,
          [id]: { rows: current, staleRows, checkedAt: Date.now(), complete } } };
      });
    };
    const load = async (projectId: string) => {
      const rows = new Map<string, ListedThread>();
      try {
        for (let page = 0; page < MAX_PAGES; page++) {
          const listed = await sdk.threads.list({ projectId, includeHidden: true, archived: false,
            limit: LIST_LIMIT, offset: page * LIST_LIMIT, signal: controller.signal });
          if (controller.signal.aborted) return;
          const previousSize = rows.size;
          for (const row of listed) rows.set(row.id, row);
          const complete = listed.length < LIST_LIMIT;
          // Publish each successful page BEFORE waiting for more. Pending,
          // failed or bounded pagination can only establish a lower bound.
          publish(projectId, rows, complete);
          if (complete || rows.size === previousSize) return;
        }
      } catch {
        // Successful pages remain current; the missing remainder stays unknown.
        // If no page arrived, the refresh-start snapshot is stale-only.
      }
    };
    for (const id of projects) void load(id);
    return () => controller.abort();
  }, [enabled, projectKey, tick, nudge, sdk]);
  return useMemo(() => {
    const rows: ListedThread[] = [], staleRows: ListedThread[] = [];
    let complete = enabled && projectKey !== "";
    for (const id of projectKey ? projectKey.split("\u0000") : []) {
      const snapshot = enabled && state.key === projectKey ? state.snapshots[id] : undefined;
      if (!snapshot) { complete = false; continue; }
      const fresh = Date.now() - snapshot.checkedAt < ACTIVITY_MAX_AGE;
      (fresh ? rows : staleRows).push(...snapshot.rows);
      staleRows.push(...(snapshot.staleRows ?? []));
      if (!fresh || !snapshot.complete) complete = false;
    }
    return { rows, staleRows, complete };
  }, [enabled, projectKey, state, tick, nudge]);
}

/** Compatibility wrapper for row-only consumers. */
export function useHiddenThreads(enabled: boolean, projectIds: readonly string[], tick: unknown): readonly ListedThread[] {
  const census = useThreadCensus(enabled, projectIds, tick);
  return enabled ? [...census.rows, ...census.staleRows].filter(row => row.visibility === "hidden") : [];
}

/** Activity uses raw runtime and question facts, independently of quiet hidden-row styling.
 * The subscribed sidebar takes precedence over polled rows with the same ID. */
export function mergeActivityThreads(feed: readonly PluginSidebarThread[], listed: readonly ListedThread[]): readonly PluginSidebarThread[] {
  const known = new Set(feed.map(thread => thread.id));
  const extra: PluginSidebarThread[] = [];
  for (const raw of listed) {
    if (known.has(raw.id)) continue;
    known.add(raw.id);
    extra.push({ ...toSidebarThread(raw, feed), isHidden: raw.visibility === "hidden",
      queuedWork: raw.queuedWork, hasPendingInteraction: raw.hasPendingInteraction });
  }
  return extra.length ? [...feed, ...extra] : feed;
}

import type {
  PluginSidebarProject,
  PluginSidebarSection,
  PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import type { ListedThread } from "./hiddenThreads";

/** Deterministic clock used across fixtures so grouping maths is stable. */
export const NOW = 1_790_000_000_000;
export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

type ThreadFixture = Partial<PluginSidebarThread> & { id: string };

/**
 * A complete sidebar thread row. Every field is spelled out on purpose: when
 * the host adds a required field, the type errors here instead of a test
 * passing against a stale shape.
 */
export function makeThread(fixture: ThreadFixture): PluginSidebarThread {
  return {
    id: fixture.id,
    projectId: fixture.projectId ?? "proj_a",
    title: fixture.title ?? `Thread ${fixture.id}`,
    titleFallback: fixture.titleFallback ?? null,
    displayTitle: fixture.displayTitle ?? fixture.title ?? `Thread ${fixture.id}`,
    parentThreadId: fixture.parentThreadId ?? null,
    lifecycleOwnerThreadId: fixture.lifecycleOwnerThreadId ?? null,
    sourceThreadId: fixture.sourceThreadId ?? null,
    sectionId: fixture.sectionId ?? null,
    originKind: fixture.originKind ?? null,
    originPluginId: fixture.originPluginId ?? null,
    providerId: fixture.providerId ?? "pi",
    status: fixture.status ?? "idle",
    runtimeStatus: fixture.runtimeStatus ?? fixture.status ?? "idle",
    queuedWork: fixture.queuedWork ?? "none",
    hasPendingInteraction: fixture.hasPendingInteraction ?? false,
    activity: fixture.activity ?? {
      workflows: 0,
      backgroundAgents: 0,
      backgroundCommands: 0,
      planMode: 0,
      goals: 0,
    },
    indicator: fixture.indicator ?? "none",
    indicatorLabel: fixture.indicatorLabel ?? null,
    isUnread: fixture.isUnread ?? false,
    isPinned: fixture.isPinned ?? false,
    pinnedAt: fixture.pinnedAt ?? null,
    pinSortKey: fixture.pinSortKey ?? null,
    isArchived: fixture.isArchived ?? false,
    archivedAt: fixture.archivedAt ?? null,
    href: fixture.href ?? `/projects/proj_a/threads/${fixture.id}`,
    isHidden: fixture.isHidden ?? false,
    environment:
      fixture.environment === undefined
        ? {
            id: `env_${fixture.id}`,
            name: null,
            branchName: null,
            path: null,
            isWorktree: false,
            providerId: "project-checkout",
            workspaceDisplayKind: null,
          }
        : fixture.environment,
    host: fixture.host === undefined ? { id: "host_1", name: "This Mac" } : fixture.host,
    createdAt: fixture.createdAt ?? NOW - DAY,
    updatedAt: fixture.updatedAt ?? NOW,
    lastReadAt: fixture.lastReadAt ?? NOW,
    latestAttentionAt: fixture.latestAttentionAt ?? fixture.updatedAt ?? NOW - DAY,
  };
}

export function makeProject(
  fixture: Partial<PluginSidebarProject> & { id: string },
): PluginSidebarProject {
  return {
    id: fixture.id,
    name: fixture.name ?? `Project ${fixture.id}`,
    isPersonal: fixture.isPersonal ?? false,
    href: fixture.href ?? `/projects/${fixture.id}`,
    settingsHref: fixture.settingsHref ?? `/projects/${fixture.id}/settings`,
  };
}

export function makeSection(
  fixture: Partial<PluginSidebarSection> & { id: string; name: string },
): PluginSidebarSection {
  return {
    id: fixture.id,
    name: fixture.name,
    createdAt: fixture.createdAt ?? NOW - DAY,
    updatedAt: fixture.updatedAt ?? NOW,
  };
}

/** A raw `sdk.threads.list` row, hidden unless told otherwise. */
export function makeListedThread(fixture: Partial<ListedThread> & { id: string }): ListedThread {
  return {
    id: fixture.id,
    projectId: fixture.projectId ?? "proj_a",
    title: fixture.title === undefined ? `Thread ${fixture.id}` : fixture.title,
    titleFallback: fixture.titleFallback ?? null,
    parentThreadId: fixture.parentThreadId ?? null,
    lifecycleOwnerThreadId: fixture.lifecycleOwnerThreadId ?? null,
    sourceThreadId: fixture.sourceThreadId ?? null,
    sectionId: fixture.sectionId ?? null,
    originKind: fixture.originKind ?? null,
    originPluginId: fixture.originPluginId ?? null,
    parentNotifications: fixture.parentNotifications ?? "auto",
    providerId: fixture.providerId ?? "pi",
    status: fixture.status ?? "idle",
    runtime: fixture.runtime ?? { displayStatus: fixture.status ?? "idle" },
    queuedWork: fixture.queuedWork ?? "none",
    hasPendingInteraction: fixture.hasPendingInteraction ?? false,
    activity: fixture.activity ?? {
      activeBackgroundAgentCount: 0,
      activeBackgroundCommandCount: 0,
      activeGoalCount: 0,
      activePlanModeCount: 0,
      activeWorkflowCount: 0,
    },
    pinnedAt: fixture.pinnedAt ?? null,
    pinSortKey: fixture.pinSortKey ?? null,
    archivedAt: fixture.archivedAt ?? null,
    deletedAt: fixture.deletedAt ?? null,
    visibility: fixture.visibility ?? "hidden",
    environmentId: fixture.environmentId === undefined ? `env_${fixture.id}` : fixture.environmentId,
    environmentName: fixture.environmentName ?? null,
    environmentBranchName: fixture.environmentBranchName ?? null,
    environmentPath: fixture.environmentPath ?? null,
    environmentIsWorktree: fixture.environmentIsWorktree ?? false,
    environmentProviderId: fixture.environmentProviderId ?? null,
    environmentWorkspaceDisplayKind: fixture.environmentWorkspaceDisplayKind ?? "other",
    environmentHostId: fixture.environmentHostId === undefined ? "host_1" : fixture.environmentHostId,
    createdAt: fixture.createdAt ?? NOW - DAY,
    updatedAt: fixture.updatedAt ?? NOW,
    lastReadAt: fixture.lastReadAt ?? null,
    latestAttentionAt: fixture.latestAttentionAt ?? fixture.updatedAt ?? NOW,
  };
}

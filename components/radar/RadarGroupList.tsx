import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  defaultKeyboardCoordinateGetter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type {
  PluginBrowserBbSdk,
  PluginSidebarSection,
  PluginSidebarThread,
  experimental_useProviders,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { requestBotAttention } from "@/lib/botAttention";
import { RadarThreadRow } from "./RadarThreadRow";
import type { RadarThreadActions } from "./threadActions";
import { RadarBotCard } from "./RadarBotCard";
import { botState, botStyle, crewDigest, shortBotName, type Pulse, type RosterBot } from "./bots";
import type { NeedsItem } from "@/lib/needs";
import type { useVisibleBots } from "./botVisibility";
import { activityTime, isRunningThread, timeAgo } from "./time";
import { GroupHeader, SortableGroupSection } from "./RadarGroupHeader";
import { RadarMenu } from "./RadarMenu";
import type { SubtreeCounts, ThreadGroup } from "./useThreadGroups";
import {
  COLLAPSED_KEY,
  COLLAPSED_THREADS_KEY,
  PROJECT_ORDER_KEY,
  usePersistedSet,
  writeStored,
  type Grouping,
  type ListSettings,
  type LifecycleFilter,
} from "./useListSettings";
import { nThreads, reportBulk } from "./listFeedback";

/** Row drag affordance handed to a thread row's grip handle. */
export interface RowDragHandle {
  attributes: ReturnType<typeof useDraggable>["attributes"];
  listeners: ReturnType<typeof useDraggable>["listeners"];
  isDragging: boolean;
}

export type RenderRow = (
  thread: PluginSidebarThread,
  depth: number,
  groupProjectId: string | null,
  isLastChild: boolean,
  dragHandle: RowDragHandle | null,
  hidden: boolean,
) => ReactNode;

const EMPTY_ID_SET: ReadonlySet<string> = new Set();

/**
 * A section group that accepts a dragged thread. Highlighting is driven by
 * dnd-kit's `isOver`, so the drop target is unmistakable before release.
 */
function DroppableSectionSection({
  group,
  draggingThreadId,
  onDropThread,
  children,
}: {
  group: ThreadGroup;
  draggingThreadId: string | null;
  onDropThread: (threadId: string, sectionId: string | null) => void;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: group.id,
    data: { sectionId: group.sectionId },
  });
  const dragged = draggingThreadId
    ? group.roots.find((root) => root.id === draggingThreadId)
    : null;
  // No point offering a thread its own current section.
  const alreadyHere =
    dragged != null && (dragged.sectionId ?? null) === group.sectionId;
  return (
    // A plain div: the wrapped group already renders the labelled <section>.
    <div
      ref={setNodeRef}
      className={cn(
        "radar-group",
        "radar-group-section",
        isOver && draggingThreadId && !alreadyHere && "radar-group-drop-active",
        isOver && draggingThreadId && alreadyHere && "radar-group-drop-same",
      )}
      onDrop={(event) => {
        if (!draggingThreadId) return;
        event.preventDefault();
        onDropThread(draggingThreadId, group.sectionId);
      }}
      onDragOver={(event) => {
        if (draggingThreadId) event.preventDefault();
      }}
    >
      {children}
    </div>
  );
}

/** Wraps a row so its grip can start a drag onto a section header. */
function DraggableThreadRow({
  threadId,
  renderRow,
}: {
  threadId: string;
  renderRow: (handle: RowDragHandle) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `thread:${threadId}`,
    data: { threadId },
  });
  return (
    <div
      ref={setNodeRef}
      className={cn("radar-row-draggable", isDragging && "radar-row-dragging")}
    >
      {renderRow({ attributes, listeners, isDragging })}
    </div>
  );
}

/** Outlasts the `.radar-fold` collapse transition (280ms in styles/groups.css). */
const FOLD_UNMOUNT_MS = 320;

/**
 * A collapsible group or family body. Its rows stay mounted only while open
 * and through the closing animation, so a folded group costs nothing: no
 * rows, no per-row host subscriptions, no pull-request lookups. Opening
 * mounts them in the same commit the grid starts growing, so it animates.
 */
export function Fold({
  collapsed,
  role,
  label,
  children,
}: {
  collapsed: boolean;
  role: "list" | "group";
  label: string;
  children: () => ReactNode;
}) {
  const [closed, setClosed] = useState(collapsed);
  useEffect(() => {
    if (!collapsed) {
      setClosed(false);
      return;
    }
    const timer = setTimeout(() => setClosed(true), FOLD_UNMOUNT_MS);
    return () => clearTimeout(timer);
  }, [collapsed]);
  return (
    <div
      className={cn("radar-fold", collapsed && "radar-fold-collapsed")}
      aria-hidden={collapsed || undefined}
      inert={collapsed || undefined}
    >
      <div className="radar-fold-inner" role={role} aria-label={label}>
        {collapsed && closed ? null : children()}
      </div>
    </div>
  );
}

export function renderSubtree(
  thread: PluginSidebarThread,
  depth: number,
  renderRow: RenderRow,
  children: Map<string, PluginSidebarThread[]>,
  groupProjectId: string | null,
  collapsedIds: ReadonlySet<string>,
  isLastChild: boolean,
  draggable: boolean,
  /** Inside a closing group or family fold: still mounted, no longer shown. */
  hidden: boolean,
): ReactNode {
  const kids = depth > 25 ? [] : (children.get(thread.id) ?? []);
  const folded = collapsedIds.has(thread.id);
  const rowNode =
    draggable && depth === 0 ? (
      <DraggableThreadRow
        threadId={thread.id}
        renderRow={(handle) =>
          renderRow(thread, depth, groupProjectId, isLastChild, handle, hidden)
        }
      />
    ) : (
      renderRow(thread, depth, groupProjectId, isLastChild, null, hidden)
    );
  const node = (
    <Fragment key={thread.id}>
      {rowNode}
      {kids.length === 0 ? null : (
        <Fold collapsed={folded} role="group" label="Replies">
          {() =>
            kids.map((child, index) =>
              renderSubtree(
                child,
                depth + 1,
                renderRow,
                children,
                groupProjectId,
                collapsedIds,
                index === kids.length - 1,
                false,
                hidden || folded,
              ),
            )
          }
        </Fold>
      )}
    </Fragment>
  );

  if (depth === 0) {
    return (
      <div key={thread.id} className="radar-thread-cluster" role="listitem">
        {node}
      </div>
    );
  }

  return node;
}

/**
 * Which groups and families are folded (persisted per client), and the
 * expand/collapse-all controls over the groups on screen. Filtering forces
 * everything open so matches never hide inside folds.
 */
export function useGroupFolds({
  isFiltering,
  needsYouGroup,
  botGroups,
  pinnedGroup,
  groups,
}: {
  isFiltering: boolean;
  needsYouGroup: ThreadGroup | null;
  botGroups: ThreadGroup[];
  pinnedGroup: ThreadGroup | null;
  groups: ThreadGroup[];
}) {
  const [collapsed, setCollapsed] = usePersistedSet(COLLAPSED_KEY);
  const [collapsedThreads, setCollapsedThreads] = usePersistedSet(COLLAPSED_THREADS_KEY);
  const collapseIds: ReadonlySet<string> =
    isFiltering ? EMPTY_ID_SET : collapsedThreads;
  const collapsedGroupIds: ReadonlySet<string> =
    isFiltering ? EMPTY_ID_SET : collapsed;

  const allGroupIds = useMemo(
    () => [
      ...(needsYouGroup ? [needsYouGroup.id] : []),
      ...botGroups.map((g) => g.id),
      ...(pinnedGroup ? [pinnedGroup.id] : []),
      ...groups.map((g) => g.id),
    ],
    [needsYouGroup, botGroups, pinnedGroup, groups],
  );

  const areAllGroupsCollapsed = useMemo(() => {
    if (allGroupIds.length === 0) return false;
    return allGroupIds.every((id) => collapsedGroupIds.has(id));
  }, [allGroupIds, collapsedGroupIds]);

  const toggleAllGroups = useCallback(() => {
    setCollapsed((previous) =>
      allGroupIds.every((id) => previous.has(id))
        ? new Set<string>()
        : new Set(allGroupIds),
    );
  }, [allGroupIds, setCollapsed]);

  const expandAllGroups = useCallback(() => {
    setCollapsed(new Set<string>());
  }, [setCollapsed]);

  const collapseAllGroups = useCallback(() => {
    setCollapsed(new Set(allGroupIds));
  }, [allGroupIds, setCollapsed]);

  const toggleThreadCollapse = useCallback((id: string) => {
    setCollapsedThreads((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, [setCollapsedThreads]);

  return {
    setCollapsed,
    collapseIds,
    collapsedGroupIds,
    areAllGroupsCollapsed,
    toggleAllGroups,
    expandAllGroups,
    collapseAllGroups,
    toggleThreadCollapse,
  };
}

/** One stable row renderer: rows are memoised, so it only changes when
 * something every row reads changes. */
export function useRowRenderer({
  settings,
  lifecycle,
  activeThreadId,
  editingId,
  actions,
  now,
  onNavigate,
  sections,
  sectionById,
  projectNameFor,
  celebrateIds,
  onMarkFamilyRead,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onUnarchive,
  providerById,
  primaryHostId,
  shownChildren,
  childrenOf,
  collapseIds,
  countSubtree,
  toggleThreadCollapse,
  sdk,
  modelEpoch,
  density,
  selectedIds,
  keyboardFocusedId,
  handleToggleSelect,
  visibleThreadIds,
}: {
  settings: ListSettings;
  lifecycle: LifecycleFilter;
  activeThreadId: string | null;
  editingId: string | null;
  actions: RadarThreadActions;
  now: number;
  onNavigate: () => void;
  sections: readonly PluginSidebarSection[];
  sectionById: Map<string, PluginSidebarSection>;
  projectNameFor: (thread: PluginSidebarThread) => string;
  celebrateIds: ReadonlySet<string>;
  onMarkFamilyRead: (thread: PluginSidebarThread) => Promise<void>;
  onStartRename: (thread: PluginSidebarThread) => void;
  onCommitRename: (thread: PluginSidebarThread, title: string) => void;
  onCancelRename: () => void;
  onUnarchive: (thread: PluginSidebarThread) => void;
  providerById: Map<string, ReturnType<typeof experimental_useProviders>["providers"][number]>;
  primaryHostId: string | null;
  shownChildren: Map<string, PluginSidebarThread[]>;
  childrenOf: Map<string, PluginSidebarThread[]>;
  collapseIds: ReadonlySet<string>;
  countSubtree: (root: PluginSidebarThread) => SubtreeCounts;
  toggleThreadCollapse: (id: string) => void;
  sdk: PluginBrowserBbSdk;
  modelEpoch: number;
  density: "comfortable" | "compact";
  selectedIds: Set<string>;
  keyboardFocusedId: string | null;
  handleToggleSelect: (event: { shiftKey: boolean }, threadId: string) => void;
  visibleThreadIds: ReadonlySet<string>;
}): RenderRow {
  return useCallback(
    (
      thread: PluginSidebarThread,
      depth: number,
      groupProjectId: string | null,
      isLastChild: boolean,
      dragHandle: RowDragHandle | null,
      hidden: boolean,
    ) => {
      const kidCount = (shownChildren.get(thread.id) ?? []).length;
      const counts = kidCount > 0 ? countSubtree(thread) : null;
      const collapse =
        kidCount > 0 && counts
          ? {
              collapsed: collapseIds.has(thread.id),
              hiddenTotal: counts.total - 1,
              hiddenUnread:
                counts.unread - (thread.isUnread ? 1 : 0),
              hiddenLive: counts.live - Number(isRunningThread(thread)) > 0,
              hiddenNeedsUser:
                counts.needsUser -
                  Number(thread.indicator === "waiting-for-input") > 0,
              hiddenFailed:
                counts.failed - Number(
                  thread.indicator === "unread-error" ||
                  thread.indicator === "queued-failed",
                ) > 0,
              hiddenKids: counts.kids,
              onToggle: () => toggleThreadCollapse(thread.id),
            }
          : null;
      const provider = providerById.get(thread.providerId) ?? null;
      return (
        <RadarThreadRow
          key={thread.id}
          thread={thread}
          depth={depth}
          isLastChild={isLastChild}
          projectName={projectNameFor(thread)}
          projectTag={
            groupProjectId !== null && thread.projectId === groupProjectId
              ? null
              : projectNameFor(thread)
          }
          primaryHostId={primaryHostId}
          sectionName={
            thread.sectionId
              ? (sectionById.get(thread.sectionId)?.name ?? null)
              : null
          }
          sectionId={thread.sectionId}
          celebrate={settings.celebrate && celebrateIds.has(thread.id)}
          allowHoverCard={settings.hoverCard}
          isActive={thread.id === activeThreadId}
          isEditing={thread.id === editingId}
          isVisible={visibleThreadIds.has(thread.id)}
          actions={actions}
          timeText={timeAgo(activityTime(thread, now), now)}
          onNavigate={onNavigate}
          sections={sections}
          onMarkFamilyRead={onMarkFamilyRead}
          onStartRename={onStartRename}
          onCommitRename={onCommitRename}
          onCancelRename={onCancelRename}
          onUnarchive={onUnarchive}
          providerName={provider?.displayName ?? thread.providerId}
          providerIcon={provider}
          collapse={collapse}
          sdk={sdk}
          modelEpoch={modelEpoch}
          density={density}
          isSelected={selectedIds.has(thread.id)}
          selectedIds={selectedIds.has(thread.id) ? selectedIds : undefined}
          selectionActive={selectedIds.size > 0}
          isKeyboardFocused={keyboardFocusedId === thread.id}
          onToggleSelect={handleToggleSelect}
          dragHandle={dragHandle}
          swipeRight={settings.swipeRight}
          swipeLeft={settings.swipeLeft}
          listFiltersArchived={lifecycle !== "all"}
          hasChildren={(childrenOf.get(thread.id)?.length ?? 0) > 0}
          isShortcutTarget={!hidden}
        />
      );
    },
    [
      projectNameFor,
      sectionById,
      celebrateIds,
      settings.celebrate,
      settings.hoverCard,
      settings.swipeRight,
      settings.swipeLeft,
      lifecycle,
      activeThreadId,
      editingId,
      actions,
      now,
      onNavigate,
      sections,
      onMarkFamilyRead,
      onCommitRename,
      onStartRename,
      onCancelRename,
      onUnarchive,
      providerById,
      primaryHostId,
      shownChildren,
      childrenOf,
      collapseIds,
      countSubtree,
      toggleThreadCollapse,
      sdk,
      modelEpoch,
      density,
      selectedIds,
      keyboardFocusedId,
      handleToggleSelect,
      visibleThreadIds,
    ],
  );
}

export interface GroupMenuAnchor {
  x: number;
  y: number;
  /** Opened on a bot card: offers to hide that bot. */
  botKey?: string;
}

type VisibleBots = ReturnType<typeof useVisibleBots>;

/**
 * The list's groups in order: the needs-you lane, the Crew header and bot
 * cards, pinned, then time/project/section groups (with drag to reorder
 * projects or file threads into sections).
 */
export function RadarGroupList({
  deferredQuery,
  statusFilter,
  shownTotal,
  totalRows,
  grouping,
  needsYouGroup,
  botGroups,
  pinnedGroup,
  groups,
  shownChildren,
  collapseIds,
  collapsedGroupIds,
  setCollapsed,
  renderRow,
  roster,
  attentionPulses,
  needsItems,
  visible,
  settings,
  now,
  onNavigate,
  onGroupMenu,
  projectOrder,
  setProjectOrder,
  rowById,
  sectionById,
  sdk,
  actions,
  selectedIds,
  visibleThreadIds,
  allowMoves,
}: {
  deferredQuery: string;
  statusFilter: string;
  shownTotal: number;
  totalRows: number;
  grouping: Grouping;
  needsYouGroup: ThreadGroup | null;
  botGroups: ThreadGroup[];
  pinnedGroup: ThreadGroup | null;
  groups: ThreadGroup[];
  shownChildren: Map<string, PluginSidebarThread[]>;
  collapseIds: ReadonlySet<string>;
  collapsedGroupIds: ReadonlySet<string>;
  setCollapsed: (update: (previous: Set<string>) => Set<string>) => void;
  renderRow: RenderRow;
  roster: readonly RosterBot[];
  attentionPulses: ReadonlyMap<string, Pulse>;
  needsItems: readonly NeedsItem[] | null;
  visible: VisibleBots;
  settings: ListSettings;
  now: number;
  onNavigate: () => void;
  onGroupMenu: (anchor: GroupMenuAnchor) => void;
  projectOrder: string[];
  setProjectOrder: (order: string[]) => void;
  rowById: Map<string, PluginSidebarThread>;
  sectionById: Map<string, PluginSidebarSection>;
  sdk: PluginBrowserBbSdk;
  actions: RadarThreadActions;
  selectedIds: Set<string>;
  visibleThreadIds: ReadonlySet<string>;
  allowMoves: () => void;
}) {
  const [dragActiveId, setDragActiveId] = useState<string | null>(null);
  const [draggingThreadId, setDraggingThreadId] = useState<string | null>(
    null,
  );
  const draggingThreadIds = useRef<string[]>([]);
  const justDragged = useRef(false);
  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter:
        grouping === "project"
          ? sortableKeyboardCoordinates
          : defaultKeyboardCoordinateGetter,
    }),
  );

  const activeGroup = useMemo(
    () => (dragActiveId ? (groups.find((g) => g.id === dragActiveId) ?? null) : null),
    [groups, dragActiveId],
  );

  const toggleGroup = useCallback((id: string) => {
    if (justDragged.current) return;
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, [setCollapsed]);

  /** File the dragged thread or its selection via BB's own update API. */
  const moveThreadToSection = useCallback(
    (threadId: string, sectionId: string | null, threadIds = [threadId]) => {
      const ids = threadIds.filter((id) => {
        const thread = rowById.get(id);
        return thread && (thread.sectionId ?? null) !== sectionId;
      });
      if (ids.length === 0) return;
      const label = sectionId
        ? (sectionById.get(sectionId)?.name ?? "section")
        : "Unfiled";
      void Promise.allSettled(
        ids.map((id) => sdk.threads.update({ threadId: id, sectionId })),
      ).then((results) =>
        reportBulk(
          results,
          (count) => `Moved ${nThreads(count)} to ${label}`,
          (count) => `Couldn’t move ${nThreads(count)} to ${label}.`,
        ),
      );
    },
    [rowById, sectionById, sdk],
  );

  const handleGroupDragStart = useCallback((event: DragStartEvent) => {
    setDragActiveId(String(event.active.id));
  }, []);

  const handleGroupDragCancel = useCallback(() => {
    setDragActiveId(null);
    justDragged.current = true;
    setTimeout(() => {
      justDragged.current = false;
    }, 50);
  }, []);

  const handleGroupDragEnd = useCallback(
    (event: DragEndEvent) => {
      setDragActiveId(null);
      justDragged.current = true;
      setTimeout(() => {
        justDragged.current = false;
      }, 50);

      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const activeProjId = String(active.id).replace(/^project:/, "");
      const overProjId = String(over.id).replace(/^project:/, "");

      const currentGroupProjIds = groups
        .map((g) => g.projectId)
        .filter((id): id is string => id !== null);

      const existing = new Set(projectOrder);
      const merged = [
        ...projectOrder.filter((id) => currentGroupProjIds.includes(id)),
        ...currentGroupProjIds.filter((id) => !existing.has(id)),
      ];

      const oldIndex = merged.indexOf(activeProjId);
      const newIndex = merged.indexOf(overProjId);

      if (oldIndex !== -1 && newIndex !== -1) {
        const next = arrayMove(merged, oldIndex, newIndex);
        writeStored(PROJECT_ORDER_KEY, JSON.stringify(next));
        setProjectOrder(next);
      }
    },
    [groups, projectOrder, setProjectOrder],
  );

  const handleNewThreadInProject = useCallback(
    (projectId: string) => {
      actions.openNewThread({ projectId, focusPrompt: true });
      onNavigate();
    },
    [actions, onNavigate],
  );

  const renderGroup = useCallback(
    (group: ThreadGroup, isSortable = false, draggable = false) => {
      const isCollapsed = collapsedGroupIds.has(group.id);

      const groupContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
        event.preventDefault();
        onGroupMenu({ x: event.clientX, y: event.clientY });
      };

      const foldContent = (
        <Fold
          collapsed={isCollapsed}
          role="list"
          label={`${group.label} threads`}
        >
          {() =>
            group.roots.length === 0 ? (
              <p className="radar-group-empty">Drop a thread here to file it.</p>
            ) : (
              group.roots.map((root, index) =>
                renderSubtree(
                  root,
                  0,
                  renderRow,
                  shownChildren,
                  group.projectId,
                  collapseIds,
                  index === group.roots.length - 1,
                  draggable,
                  isCollapsed,
                ),
              )
            )
          }
        </Fold>
      );

      if (isSortable) {
        return (
          <SortableGroupSection
            key={group.id}
            group={group}
            isCollapsed={isCollapsed}
            onToggle={() => toggleGroup(group.id)}
            onNewThread={
              group.projectId
                ? () => handleNewThreadInProject(group.projectId!)
                : undefined
            }
            onContextMenu={groupContextMenu}
          >
            {foldContent}
          </SortableGroupSection>
        );
      }

      const plainSection = (
        <section
          key={group.id}
          aria-label={group.label}
          className={cn(
            "radar-group",
            group.projectId && "radar-group-project",
            group.id === "needs-you" && "radar-group-needs-you",
            isCollapsed ? "radar-group-collapsed" : "radar-group-expanded",
          )}
        >
          <GroupHeader
            group={group}
            isCollapsed={isCollapsed}
            onToggle={() => toggleGroup(group.id)}
            onContextMenu={groupContextMenu}
            onNewThread={
              group.projectId
                ? () => handleNewThreadInProject(group.projectId!)
                : undefined
            }
          />
          {foldContent}
        </section>
      );

      return draggable ? (
        <DroppableSectionSection
          key={group.id}
          group={group}
          draggingThreadId={draggingThreadId}
          onDropThread={moveThreadToSection}
        >
          {plainSection}
        </DroppableSectionSection>
      ) : (
        plainSection
      );
    },
    [
      collapsedGroupIds,
      toggleGroup,
      handleNewThreadInProject,
      renderRow,
      shownChildren,
      collapseIds,
      draggingThreadId,
      moveThreadToSection,
      onGroupMenu,
    ],
  );

  return (
    <>
      {deferredQuery.trim() !== "" || statusFilter !== "all" ? (
        <p className="radar-result-count" role="status">
          {shownTotal} of {totalRows} threads
        </p>
      ) : null}
      {needsYouGroup ? renderGroup(needsYouGroup, false) : null}
      {botGroups.length > 0 || visible.hiddenBots.length > 0 ? (
        <div className="radar-crew-header" role="status" onContextMenu={(event) => { event.preventDefault(); onGroupMenu({ x: event.clientX, y: event.clientY }); }}>
          <span className="radar-crew-label">Crew</span>
          <span className="radar-crew-digest">
            {crewDigest(botGroups.map((group) => {
              const root = group.roots[0]!;
              const bot = roster.find((entry) => entry.current === root.id);
              return botState(root, attentionPulses.get(root.id) ?? null, bot?.rollover ?? null, { live: group.live - (isRunningThread(root) ? 1 : 0), needsUser: group.needsUser, failed: group.failed });
            }), needsItems)}
          </span>
          {visible.hiddenBots.map((bot) => (
            <button key={bot.key} type="button" className="radar-crew-action" onClick={() => visible.unhide(bot.key)} aria-label={`Show ${bot.name} again`}>
              Show {shortBotName(bot.name)}
            </button>
          ))}
        </div>
      ) : null}
      {botGroups.map((group) => {
        const root = group.roots[0]!;
        const style = botStyle(roster.find((entry) => entry.current === root.id)?.key ?? root.id, root.displayTitle);
        const isCollapsed = collapsedGroupIds.has(group.id);
        const bot = roster.find((entry) => entry.current === root.id);
        const pulse = attentionPulses.get(root.id) ?? null;
        const kids = shownChildren.get(root.id) ?? [];
        return (
          <section
            key={group.id}
            aria-label={group.label}
            className={cn("radar-group radar-bot-group", isCollapsed ? "radar-group-collapsed" : "radar-group-expanded")}
            onContextMenu={bot ? (event) => { event.preventDefault(); onGroupMenu({ x: event.clientX, y: event.clientY, botKey: bot.key }); } : undefined}
          >
            <RadarBotCard
              thread={root}
              name={bot?.name ?? root.displayTitle}
              botKey={bot?.key ?? root.id}
              hue={style.hue}
              motion={settings.motion}
              state={botState(root, pulse, bot?.rollover ?? null, { live: group.live - (isRunningThread(root) ? 1 : 0), needsUser: group.needsUser, failed: group.failed })}
              pulse={pulse}
              group={group}
              isCollapsed={isCollapsed}
              hasChildren={kids.length > 0}
              timeText={timeAgo(activityTime(root, now), now)}
              onToggle={() => toggleGroup(group.id)}
              onNavigate={() => { if (bot) requestBotAttention(bot.current, !!(bot.unseenAttention || bot.actionableNeeds)); onNavigate(); }}
            />
            {kids.length > 0 ? (
              <Fold collapsed={isCollapsed} role="list" label={`${group.label} threads`}>
                {() =>
                  kids.map((child, index) =>
                    renderSubtree(child, 1, renderRow, shownChildren, null, collapseIds, index === kids.length - 1, false, isCollapsed),
                  )
                }
              </Fold>
            ) : null}
          </section>
        );
      })}
      {pinnedGroup ? renderGroup(pinnedGroup, false) : null}
      {grouping === "section" ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={(event) => {
            const id = event.active.data.current?.threadId;
            setDraggingThreadId(typeof id === "string" ? id : null);
            draggingThreadIds.current = typeof id === "string"
              ? selectedIds.has(id)
                ? [...selectedIds].filter((selected) => visibleThreadIds.has(selected))
                : [id]
              : [];
          }}
          onDragEnd={(event) => {
            const threadId = event.active.data.current?.threadId;
            const target = event.over?.data.current;
            const ids = draggingThreadIds.current;
            draggingThreadIds.current = [];
            setDraggingThreadId(null);
            if (typeof threadId !== "string") return;
            if (!target || typeof target !== "object") return;
            const sectionId = (target as { sectionId?: string | null })
              .sectionId;
            // A drop is a deliberate move: show it despite the hover.
            allowMoves();
            moveThreadToSection(threadId, sectionId ?? null, ids.length ? ids : [threadId]);
          }}
          onDragCancel={() => {
            draggingThreadIds.current = [];
            setDraggingThreadId(null);
          }}
        >
          {groups.map((group) => renderGroup(group, false, true))}
          <DragOverlay dropAnimation={null}>
            {draggingThreadId ? (
              <div className="radar-thread-drag-preview">
                <Icon name="DragDropVertical" aria-hidden="true" />
                <span>
                  {
                    rowById.get(draggingThreadId)?.displayTitle ??
                    "Thread"
                  }
                </span>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      ) : grouping === "project" ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={handleGroupDragStart}
          onDragEnd={handleGroupDragEnd}
          onDragCancel={handleGroupDragCancel}
        >
          <SortableContext
            items={groups.map((group) => group.id)}
            strategy={verticalListSortingStrategy}
          >
            {groups.map((group) => renderGroup(group, true))}
          </SortableContext>
          <DragOverlay>
            {activeGroup ? (
              <div className="radar-group-drag-preview">
                <span className="radar-group-grip" aria-hidden="true">
                  <Icon name="DragDropVertical" />
                </span>
                <Icon
                  name={
                    collapsedGroupIds.has(activeGroup.id)
                      ? "Folder"
                      : "FolderOpen"
                  }
                  aria-hidden="true"
                  className="radar-group-drag-icon"
                />
                <span className="radar-group-label">{activeGroup.label}</span>
                {activeGroup.unread > 0 ? (
                  <span className="radar-group-unread" aria-hidden="true">
                    {activeGroup.unread}
                    <span className="radar-group-unread-word"> unread</span>
                    <span className="radar-group-sep"> · </span>
                  </span>
                ) : null}
                <span className="radar-group-count">{activeGroup.total}</span>
                <span className="radar-group-new-thread-preview" aria-hidden="true">
                  <Icon name="MessageSquarePlus" />
                </span>
              </div>
            ) : null}
          </DragOverlay>
        </DndContext>
      ) : (
        groups.map((group) => renderGroup(group, false))
      )}
    </>
  );
}

/** Right-click on a group header, the Crew header or a bot card. */
export function GroupMenu({
  anchor,
  roster,
  visible,
  hasProjectOrder,
  onExpandAll,
  onCollapseAll,
  onResetProjectOrder,
  onClose,
}: {
  anchor: GroupMenuAnchor;
  roster: readonly RosterBot[];
  visible: VisibleBots;
  hasProjectOrder: boolean;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  onResetProjectOrder: () => void;
  onClose: () => void;
}) {
  return (
    <RadarMenu
      x={anchor.x}
      y={anchor.y}
      items={[
        ...(anchor.botKey
          ? [{
              kind: "item" as const,
              id: `hide-bot:${anchor.botKey}`,
              label: `Hide ${roster.find((bot) => bot.key === anchor.botKey)?.name ?? "bot"}`,
              icon: "EyeOff",
              // Attention overrides hiding, so Hide would change nothing until the ask or failure is handled.
              ...(visible.isProtected(anchor.botKey)
                ? { disabled: true, title: "Handle its open question or unread failure before hiding it." }
                : {}),
            }]
          : []),
        ...visible.hiddenBots.map((bot) => ({
          kind: "item" as const,
          id: `show-bot:${bot.key}`,
          label: `Show ${bot.name}`,
        })),
        ...(anchor.botKey || visible.hiddenBots.length > 0 ? [{ kind: "separator" as const }] : []),
        {
          kind: "item",
          id: "expand-all-groups",
          label: "Expand all folders",
          icon: "Expand",
        },
        {
          kind: "item",
          id: "collapse-all-groups",
          label: "Collapse all folders",
          icon: "Collapse",
        },
        ...(hasProjectOrder
          ? [
              { kind: "separator" as const },
              {
                kind: "item" as const,
                id: "reset-project-order",
                label: "Reset project order",
                icon: "ArrowReloadHorizontal",
              },
            ]
          : []),
      ]}
      onSelect={(id) => {
        onClose();
        if (id.startsWith("hide-bot:")) {
          visible.hide(id.slice("hide-bot:".length));
        } else if (id.startsWith("show-bot:")) {
          visible.unhide(id.slice("show-bot:".length));
        } else if (id === "expand-all-groups") {
          onExpandAll();
        } else if (id === "collapse-all-groups") {
          onCollapseAll();
        } else if (id === "reset-project-order") {
          try {
            localStorage.removeItem(PROJECT_ORDER_KEY);
          } catch {
            // Ignore storage failure.
          }
          onResetProjectOrder();
          toast.success("Project order reset to default");
        }
      }}
      onClose={onClose}
    />
  );
}


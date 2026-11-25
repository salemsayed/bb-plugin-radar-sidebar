import type { ActivityCoverage } from "./botScope";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  defaultKeyboardCoordinateGetter,
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
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { RadarThreadRow } from "./RadarThreadRow";
import type { RadarThreadActions } from "./threadActions";
import { botActivity, botActivityText, botRailState } from "./botScope";
import { RadarBotCard, RadarMissingBotCard } from "./RadarBotCard";
import { botState, botStyle, crewDigest, shortBotName, type Pulse, type RosterBot } from "./bots";
import type { NeedsItem } from "@/lib/needs";
import { NeedsYouLane } from "./NeedsYouList";
import type { useVisibleBots } from "./botVisibility";
import { activityTime, effectiveIndicator, isRunningThread, timeAgo } from "./time";
import { GroupHeader, SortableGroupSection } from "./RadarGroupHeader";
import type { SubtreeCounts, ThreadGroup } from "./useThreadGroups";
import {
  PROJECT_ORDER_KEY,
  writeStored,
  type Grouping,
  type ListSettings,
  type LifecycleFilter,
} from "./useListSettings";
import { nThreads, reportBulk } from "./listFeedback";
import {
  DroppableSectionSection,
  Fold,
  renderSubtree,
  summarizeCrewActivity,
  type GroupMenuAnchor,
  type RenderRow,
  type RowDragHandle,
} from "./groupHelpers";

export {
  Fold,
  renderSubtree,
  useGroupFolds,
  type GroupMenuAnchor,
  type RenderRow,
  type RowDragHandle,
} from "./groupHelpers";
export { GroupMenu } from "./GroupMenu";

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
  providerById: Map<
    string,
    ReturnType<typeof experimental_useProviders>["providers"][number]
  >;
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
              hiddenUnread: counts.unread - (thread.isUnread ? 1 : 0),
              hiddenLive: counts.live - Number(isRunningThread(thread)) > 0,
              hiddenNeedsUser:
                counts.needsUser -
                  Number(thread.indicator === "waiting-for-input") >
                0,
              hiddenFailed:
                counts.failed -
                  Number(
                    effectiveIndicator(thread) === "unread-error" ||
                      thread.indicator === "queued-failed",
                  ) >
                0,
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
  needsLane,
  botGroups,
  pinnedGroup,
  groups,
  shownChildren,
  collapseIds,
  collapsedGroupIds,
  setCollapsed,
  renderRow,
  roster,
  botThreads,
  activityCoverage,
  missingBots = [],
  attentionPulses,
  needsItems,
  laneItems,
  onUpdateNeed,
  onOpenNeed,
  onReplyToNeed,
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
  /** The folded lane's remembered open state and its toggle. */
  needsLane: { open: boolean; toggle: () => void };
  botGroups: ThreadGroup[];
  pinnedGroup: ThreadGroup | null;
  groups: ThreadGroup[];
  shownChildren: Map<string, PluginSidebarThread[]>;
  collapseIds: ReadonlySet<string>;
  collapsedGroupIds: ReadonlySet<string>;
  setCollapsed: (update: (previous: Set<string>) => Set<string>) => void;
  renderRow: RenderRow;
  roster: readonly RosterBot[];
  botThreads: readonly PluginSidebarThread[];
  activityCoverage?: ActivityCoverage;
  missingBots?: readonly RosterBot[];
  attentionPulses: ReadonlyMap<string, Pulse>;
  /** Every bot's items for the Crew digest. */
  needsItems: readonly NeedsItem[] | null;
  /** The lane's items: a selected bot's own, otherwise everyone's. */
  laneItems: readonly NeedsItem[] | null;
  onUpdateNeed: (
    id: string,
    action: "done" | "snooze" | "reopen",
    until?: string,
  ) => Promise<void>;
  onOpenNeed: (threadId: string) => void;
  onReplyToNeed: (threadId: string, text: string) => void;
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
  const [draggingThreadId, setDraggingThreadId] = useState<string | null>(null);
  const draggingThreadIds = useRef<string[]>([]);
  const justDragged = useRef(false);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
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

  const toggleGroup = useCallback(
    (id: string) => {
      if (justDragged.current) return;
      setCollapsed((previous) => {
        const next = new Set(previous);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    [setCollapsed],
  );

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
        <Fold collapsed={isCollapsed} role="list" label={`${group.label} threads`}>
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

  const lane = settings.needsYouLane ? (
    <NeedsYouLane
      items={laneItems ?? []}
      roster={roster}
      now={now}
      open={needsLane.open}
      onToggle={needsLane.toggle}
      onUpdate={onUpdateNeed}
      onOpen={onOpenNeed}
      onReply={onReplyToNeed}
      waitingCount={needsYouGroup?.roots.length ?? 0}
      waiting={
        needsYouGroup ? (
          <div role="list" aria-label="Needs you threads">
            {needsYouGroup.roots.map((root, index) =>
              renderSubtree(
                root,
                0,
                renderRow,
                shownChildren,
                needsYouGroup.projectId,
                collapseIds,
                index === needsYouGroup.roots.length - 1,
                false,
                false,
              ),
            )}
          </div>
        ) : null
      }
    />
  ) : null;

  const crewBots = settings.botsDeck && !settings.botRail ? roster : [];
  const crewSummary = summarizeCrewActivity(
    crewBots.map((bot) =>
      botActivity(
        botThreads,
        bot,
        attentionPulses.get(bot.current) ?? null,
        activityCoverage,
      ),
    ),
  );

  return (
    <>
      {deferredQuery.trim() !== "" || statusFilter !== "all" ? (
        <p className="radar-result-count" role="status">
          {shownTotal} of {totalRows} threads
        </p>
      ) : null}
      {lane}
      {crewBots.length > 0 ? (
        <div
          className="radar-crew-header"
          role="status"
          onContextMenu={(event) => {
            event.preventDefault();
            onGroupMenu({ x: event.clientX, y: event.clientY });
          }}
        >
          <span className="radar-crew-label">Crew</span>
          <span className="radar-crew-digest">
            {crewDigest(
              crewBots.map((bot) =>
                botRailState(
                  botThreads,
                  bot,
                  attentionPulses.get(bot.current) ?? null,
                  activityCoverage,
                ),
              ),
              needsItems,
            )}
            {crewSummary ? ` · ${botActivityText(crewSummary)}` : null}
          </span>
          {visible.hiddenBots.map((bot) => (
            <button
              key={bot.key}
              type="button"
              className="radar-crew-action"
              onClick={() => visible.unhide(bot.key)}
              aria-label={`Show ${bot.name} again`}
            >
              Show {shortBotName(bot.name)}
            </button>
          ))}
        </div>
      ) : null}
      {missingBots.map((bot) => (
        <RadarMissingBotCard
          key={bot.key}
          bot={bot}
          activity={botActivity(
            botThreads,
            bot,
            attentionPulses.get(bot.current) ?? null,
            activityCoverage,
          )}
          onNavigate={onNavigate}
        />
      ))}
      {botGroups.map((group) => {
        const root = group.roots[0]!;
        const bot = roster.find((entry) => entry.current === root.id);
        const style = botStyle(bot?.key ?? root.id, root.displayTitle);
        const isCollapsed = collapsedGroupIds.has(group.id);
        const pulse = attentionPulses.get(root.id) ?? null;
        const kids = shownChildren.get(root.id) ?? [];
        return (
          <section
            key={group.id}
            aria-label={group.label}
            className={cn(
              "radar-group radar-bot-group",
              isCollapsed ? "radar-group-collapsed" : "radar-group-expanded",
            )}
            onContextMenu={
              bot
                ? (event) => {
                    event.preventDefault();
                    onGroupMenu({
                      x: event.clientX,
                      y: event.clientY,
                      botKey: bot.key,
                    });
                  }
                : undefined
            }
          >
            <RadarBotCard
              thread={root}
              name={bot?.name ?? root.displayTitle}
              botKey={bot?.key ?? root.id}
              hue={style.hue}
              motion={settings.motion}
              activity={
                bot
                  ? botActivity(botThreads, bot, pulse, activityCoverage)
                  : undefined
              }
              rolloverBlocked={bot?.rolloverBlocked}
              state={
                bot
                  ? botRailState(botThreads, bot, pulse, activityCoverage)
                  : botState(root, pulse, null, {
                      live: group.live - (isRunningThread(root) ? 1 : 0),
                      needsUser: group.needsUser,
                      failed: group.failed,
                    })
              }
              pulse={pulse}
              group={group}
              isCollapsed={isCollapsed}
              hasChildren={kids.length > 0}
              timeText={timeAgo(activityTime(root, now), now)}
              onToggle={() => toggleGroup(group.id)}
              onNavigate={onNavigate}
            />
            {kids.length > 0 ? (
              <Fold
                collapsed={isCollapsed}
                role="list"
                label={`${group.label} threads`}
              >
                {() =>
                  kids.map((child, index) =>
                    renderSubtree(
                      child,
                      1,
                      renderRow,
                      shownChildren,
                      null,
                      collapseIds,
                      index === kids.length - 1,
                      false,
                      isCollapsed,
                    ),
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
            draggingThreadIds.current =
              typeof id === "string"
                ? selectedIds.has(id)
                  ? [...selectedIds].filter((selected) =>
                      visibleThreadIds.has(selected),
                    )
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
            const sectionId = (target as { sectionId?: string | null }).sectionId;
            allowMoves();
            moveThreadToSection(
              threadId,
              sectionId ?? null,
              ids.length ? ids : [threadId],
            );
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
                  {rowById.get(draggingThreadId)?.displayTitle ?? "Thread"}
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
                <span
                  className="radar-group-new-thread-preview"
                  aria-hidden="true"
                >
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

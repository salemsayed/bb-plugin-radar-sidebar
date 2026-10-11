import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  experimental_useProviders,
  experimental_useSidebarThreads,
  useSdk,
  type PluginSidebarThread,
  type PluginThreadListProps,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { preloadExtendedIcons } from "@/components/ui/icon";
import { requestBotAttention } from "@/lib/botAttention";
import { useRadarThreadActions } from "./threadActions";
import { askPulse, shortBotName } from "./bots";
import { botCoordinatorIds, botScopeIds, rosterRefreshKey } from "./botScope";
import { needsKeyOf, useCrewJudgements, useNeedsYou } from "./useCrewData";
import { crewCard } from "./CrewWorkspace";
import { publishCrewSignal } from "./crewSignal";
import { useBotRoster } from "./useBotRoster";
import { askingBotKeys, useHiddenBotKeys, useVisibleBots } from "./botVisibility";
import { useThreadPulses } from "./useThreadPulses";
import { useArrivals } from "./useArrivals";
import { useFrozenOrder, useOrderFreeze } from "./useFrozenOrder";
import { useValidatedRailScope } from "./railScope";
import { useThreadGroups, type ThreadGroup } from "./useThreadGroups";
import {
  PROJECT_ORDER_KEY,
  readStringArray,
  useDensity,
  useListSettings,
  useListView,
  useWorkingOpen,
} from "./useListSettings";
import { useListKeyboard } from "./useListKeyboard";
import {
  GroupMenu,
  RadarGroupList,
  useGroupFolds,
  useRowRenderer,
  type GroupMenuAnchor,
} from "./RadarGroupList";
import { RadarListHeader } from "./RadarListHeader";
import { RadarWorkingDrawer } from "./RadarWorkingDrawer";
import {
  RadarArchivedPager,
  RadarListEmpty,
  RadarListError,
  RadarListLoading,
} from "./RadarListStates";
import { RadarBulkBar } from "./RadarBulkBar";
import { problem } from "./listFeedback";

export type { StatusFilter } from "./useListSettings";
export type { RowDragHandle } from "./RadarGroupList";

void preloadExtendedIcons().catch(() => undefined);

/**
 * The thread list: composes the host's thread data, bots and settings into
 * the header, the grouped rows, the Working drawer and the bulk dock.
 */
export function RadarThreadList({
  activeThreadId,
  isCompactViewport,
  onNavigate,
}: PluginThreadListProps) {
  const view = useListView();
  const { query, setQuery, lifecycle, grouping, statusFilter, switchPending } = view;
  const settings = useListSettings();
  const { density, selectDensity } = useDensity(settings.defaultDensity);
  const [projectOrder, setProjectOrder] = useState<string[]>(() =>
    readStringArray(PROJECT_ORDER_KEY),
  );
  const [groupMenu, setGroupMenu] = useState<GroupMenuAnchor | null>(null);
  const [workingOpen, setWorkingOpen] = useWorkingOpen();
  // Typing stays responsive: the heavy list derivation trails the input.
  const deferredQuery = useDeferredValue(query);
  // Filtering forces everything open so matches never hide inside folds.
  const isFiltering = deferredQuery.trim() !== "" || statusFilter !== "all";
  const [editingId, setEditingId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // Bumped to revalidate per-thread model info (cheap, cached reads).
  const [modelEpoch, setModelEpoch] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    const onFocus = () => setModelEpoch((epoch) => epoch + 1);
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  const lifecyclesParam = useMemo(
    () => ({
      experimental_lifecycles:
        lifecycle === "all"
          ? (["active", "archived"] as const)
          : ([lifecycle] as const),
    }),
    [lifecycle],
  );
  const {
    status,
    threads: allThreads,
    projects,
    sections,
    experimental_archived,
  } = experimental_useSidebarThreads(lifecyclesParam);
  const botRail = settings.botRail;
  // Shortcuts and deck share the list; only one bot control is shown.
  const deck = settings.botsDeck && !botRail;
  const roster = useBotRoster(settings.botsDeck || botRail, rosterRefreshKey(allThreads));
  const needs = useNeedsYou(settings.botsDeck || botRail);
  const railScope = useValidatedRailScope(roster, botRail);
  // Deck cards read the full roster's coordinators from the unfiltered list,
  // so a hidden bot's open ask can still protect it from hiding.
  const coordinatorRows = useMemo(
    () => deck || botRail ? allThreads.filter((thread) => roster.some((bot) => bot.current === thread.id)) : [],
    [allThreads, roster, deck, botRail, railScope],
  );
  const pulses = useThreadPulses(coordinatorRows, deck || botRail);
  const judgements = useCrewJudgements(coordinatorRows, needsKeyOf(needs.items));
  // The deck, the rail and Crew share the one ask record (askPulse): a judged
  // plain-language ask lights Decision and a Done one does not.
  const attentionPulses = useMemo(() => {
    const result = new Map(pulses);
    for (const thread of coordinatorRows) {
      const pulse = askPulse(thread, pulses.get(thread.id) ?? null, judgements.get(thread.id));
      if (pulse) result.set(thread.id, pulse);
      else result.delete(thread.id);
    }
    return result;
  }, [pulses, judgements, coordinatorRows]);
  const hiddenKeys = useHiddenBotKeys();
  // Unknown saved-ask data must not hide something that might need Salem.
  const asking = useMemo(
    () => deck || botRail ? askingBotKeys(roster, coordinatorRows, pulses, judgements, needs.items, hiddenKeys) : new Set<string>(),
    [deck, botRail, roster, coordinatorRows, pulses, judgements, needs.items, hiddenKeys],
  );
  // Hidden bots keep their families tucked away and keep their Needs items; only the deck tile goes.
  const visible = useVisibleBots(roster, allThreads, asking);
  // The Crew rail icon's count and dot: saved asks plus pending approvals, and whether any bot works or failed.
  useEffect(() => {
    // Without a roster (bot views off or the bot plugin absent) the icon shows nothing rather than a stale count.
    if (!roster.length) { publishCrewSignal({ needs: 0, working: false, failed: false }); return; }
    const now = Date.now();
    const cards = roster.map(bot => crewCard(bot, allThreads, null, needs.items, null, now));
    const blocked = cards.reduce((count, card) => count + (card.coordinator?.hasPendingInteraction || card.coordinator?.indicator === "waiting-for-input" ? 1 : 0)
      + card.workers.filter(worker => worker.state === "needs-you").length, 0);
    publishCrewSignal({ needs: (needs.items ?? []).filter(item => item.state !== "snoozed").length + blocked,
      unread: roster.reduce((count, bot) => count + (bot.unseenAttention ?? 0), 0),
      working: cards.some(card => card.state === "working"), failed: cards.some(card => card.state === "failed") });
  }, [roster, allThreads, needs.items]);
  const scopedBot = roster.find(bot => bot.key === railScope) ?? null;
  const scopeName = scopedBot?.name ?? "Bot";
  const threads = useMemo(() => {
    if (roster.length === 0) return allThreads;
    if (!botRail) {
      // Deck: a hidden bot's whole family leaves the list, so its coordinator
      // does not come back as a pinned row with its workers nested under it.
      if (!deck || visible.hiddenBots.length === 0) return allThreads;
      const tucked = new Set(visible.hiddenBots.flatMap(bot => [...botScopeIds(allThreads, bot)]));
      return allThreads.filter(thread => !tucked.has(thread.id));
    }
    if (scopedBot) {
      const ids = botScopeIds(allThreads, scopedBot);
      const coordinators = botCoordinatorIds(scopedBot);
      return allThreads.filter(thread => ids.has(thread.id) && !coordinators.has(thread.id));
    }
    const tucked = new Set(roster.flatMap(bot => [...botScopeIds(allThreads, bot)]));
    return allThreads.filter(thread => !tucked.has(thread.id));
  }, [allThreads, scopedBot, botRail, deck, roster, visible.hiddenBots]);
  const actions = useRadarThreadActions();
  const sdk = useSdk();
  const { providers } = experimental_useProviders();
  const providerById = useMemo(
    () => new Map(providers.map((provider) => [provider.id, provider])),
    [providers],
  );

  // The host most threads run on is treated as home: its name is omitted
  // from rows, so only threads running somewhere unusual get labeled.
  const primaryHostId = useMemo(() => {
    const counts = new Map<string, number>();
    for (const thread of threads) {
      if (thread.isHidden || !thread.host) continue;
      counts.set(thread.host.id, (counts.get(thread.host.id) ?? 0) + 1);
    }
    let best: string | null = null;
    let bestCount = 0;
    for (const [id, count] of counts) {
      if (count > bestCount) {
        best = id;
        bestCount = count;
      }
    }
    return best;
  }, [threads]);

  const celebrateIds = useArrivals(threads);

  const botThreadIds = useMemo(() => deck ? visible.bots.map((bot) => bot.current) : [], [visible.bots, deck]);

  const {
    allRows,
    rowById,
    childrenOf,
    statusCounts,
    shownChildren: latestChildren,
    countSubtree,
    pinnedGroup: latestPinned,
    botGroups: latestBots,
    needsYouGroup: latestNeedsYou,
    workingGroup: latestWorking,
    workingCount,
    groups: latestGroups,
    regroup,
    shownTotal,
    projectNameFor,
    sectionById,
  } = useThreadGroups({
    threads,
    query: deferredQuery,
    statusFilter,
    grouping,
    projectOrder,
    projects,
    sections,
    now,
    nestByOwner: settings.nestByOwner,
    hideEmptySections: settings.hideEmptySections,
    botThreadIds,
    needsYouLane: settings.needsYouLane,
    // A bot's view is for watching its workers, so they stay in the list.
    hideWorking: settings.hideWorking && !scopedBot,
    activeThreadId,
  });

  // Rows never move under the pointer or a finger: while the list is hovered,
  // touched or scrolling, it keeps its order (with live data) and appends new
  // rows to their group; the new order lands once the pointer is gone.
  const orderFreeze = useOrderFreeze();
  const latestLayout = useMemo(() => ({
    regions: [
      latestNeedsYou ? [latestNeedsYou] : [],
      latestBots,
      latestPinned ? [latestPinned] : [],
      latestGroups,
      latestWorking ? [latestWorking] : [],
    ],
    children: latestChildren,
  }), [latestNeedsYou, latestBots, latestPinned, latestGroups, latestWorking, latestChildren]);
  const shownLayout = useFrozenOrder(latestLayout, orderFreeze.frozen, regroup, JSON.stringify([
    grouping, deferredQuery, statusFilter, lifecycle, railScope, projectOrder,
    settings.needsYouLane, settings.hideWorking, settings.nestByOwner, settings.hideEmptySections,
  ]));
  const [needsYouRegion, botGroups, pinnedRegion, groups, workingRegion] = shownLayout.regions as [
    ThreadGroup[], ThreadGroup[], ThreadGroup[], ThreadGroup[], ThreadGroup[],
  ];
  const needsYouGroup = needsYouRegion[0] ?? null;
  const pinnedGroup = pinnedRegion[0] ?? null;
  const workingGroup = workingRegion[0] ?? null;
  const shownChildren = shownLayout.children;

  const folds = useGroupFolds({ isFiltering, needsYouGroup, botGroups, pinnedGroup, groups });
  const { collapseIds, collapsedGroupIds, toggleThreadCollapse } = folds;

  const keyboard = useListKeyboard({
    rootRef,
    searchInputRef,
    query,
    setQuery,
    needsYouGroup,
    botGroups,
    pinnedGroup,
    groups,
    workingGroup,
    workingOpen,
    collapsedGroupIds,
    collapseIds,
    shownChildren,
    rowById,
    toggleThreadCollapse,
    actions,
    sdk,
    onNavigate,
  });
  const { selectedIds, visibleThreadIds } = keyboard;

  const markFamilyRead = useCallback(
    async (thread: PluginSidebarThread) => {
      // Whole tree: walk up to the root, then mark root + descendants.
      let root = thread;
      const ancestors = new Set<string>([thread.id]);
      while (
        root.parentThreadId &&
        rowById.has(root.parentThreadId) &&
        !ancestors.has(root.parentThreadId)
      ) {
        ancestors.add(root.parentThreadId);
        root = rowById.get(root.parentThreadId)!;
      }
      const ids = [root.id];
      const seen = new Set<string>(ids);
      const walk = (id: string, depth: number) => {
        if (depth > 25) return;
        for (const child of childrenOf.get(id) ?? []) {
          if (seen.has(child.id)) continue;
          seen.add(child.id);
          ids.push(child.id);
          walk(child.id, depth + 1);
        }
      };
      walk(root.id, 0);
      const results = await Promise.allSettled(
        ids.map((id) => sdk.threads.markRead({ threadId: id })),
      );
      const failed = results.filter(
        (result) => result.status === "rejected",
      ).length;
      if (failed > 0) {
        toast.error(
          `Couldn't mark ${failed} thread${failed === 1 ? "" : "s"} read.`,
        );
      }
    },
    [rowById, childrenOf, sdk],
  );

  const markFamilyReadRef = useRef(markFamilyRead);
  markFamilyReadRef.current = markFamilyRead;
  const requestMarkFamilyRead = useCallback(
    (thread: PluginSidebarThread) => markFamilyReadRef.current(thread),
    [],
  );

  const commitRename = useCallback(
    async (thread: PluginSidebarThread, title: string) => {
      setEditingId(null);
      const next = title.trim();
      if (next === "" || next === (thread.title ?? "")) return;
      try {
        await actions.rename(thread.id, next);
      } catch (cause) {
        toast.error(problem(cause));
      }
    },
    [actions],
  );

  const startRename = useCallback(
    (target: PluginSidebarThread) => setEditingId(target.id),
    [],
  );
  const cancelRename = useCallback(() => setEditingId(null), []);

  const unarchive = useCallback(
    (thread: PluginSidebarThread) => {
      sdk.threads.unarchive({ threadId: thread.id }).catch((cause: unknown) => {
        toast.error(problem(cause));
      });
    },
    [sdk],
  );

  const renderRow = useRowRenderer({
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
    onMarkFamilyRead: requestMarkFamilyRead,
    onStartRename: startRename,
    onCommitRename: commitRename,
    onCancelRename: cancelRename,
    onUnarchive: unarchive,
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
    keyboardFocusedId: keyboard.keyboardFocusedId,
    handleToggleSelect: keyboard.handleToggleSelect,
    visibleThreadIds,
  });

  const openScopedBot = () => {
    if (!scopedBot) return;
    requestBotAttention(scopedBot.current, !!(scopedBot.unseenAttention || scopedBot.actionableNeeds));
    actions.open(scopedBot.current);
    onNavigate();
  };

  return (
    <div
      ref={rootRef}
      className={cn(
        "radar-list",
        (density === "compact" || isCompactViewport) && "radar-density-compact",
        isCompactViewport && "radar-list-compact",
        settings.wrapTitles && "radar-title-wrap",
      )}
      data-radar-motion={settings.motion ? "on" : "off"}
      {...orderFreeze.handlers}
      data-radar-swipe={
        settings.swipeRight !== "none" || settings.swipeLeft !== "none"
          ? "on"
          : "off"
      }
    >
      <RadarListHeader
        view={view}
        searchInputRef={searchInputRef}
        statusCounts={statusCounts}
        pinnedCount={allRows.filter((thread) => thread.isPinned).length}
        isCompactViewport={isCompactViewport}
        density={density}
        onSelectDensity={selectDensity}
        areAllGroupsCollapsed={folds.areAllGroupsCollapsed}
        onToggleAllGroups={folds.toggleAllGroups}
        botRail={botRail}
        bots={visible.bots}
        allThreads={allThreads}
        attentionPulses={attentionPulses}
        railScope={railScope}
        scopedBot={scopedBot}
        scopeName={scopeName}
        activeThreadId={activeThreadId}
        motion={settings.motion}
        actions={actions}
        onNavigate={onNavigate}
      />

      <div
        className={cn(
          "radar-list-body",
          switchPending && "radar-list-switching",
        )}
        aria-busy={switchPending || undefined}
        onScroll={orderFreeze.onScroll}
      >
        {status === "loading" ? (
          <RadarListLoading />
        ) : status === "error" ? (
          <RadarListError />
        ) : shownTotal === 0 && (grouping !== "section" || sections.length === 0) ? (
          <RadarListEmpty
            query={deferredQuery}
            statusFilter={statusFilter}
            scopedBotName={scopedBot ? shortBotName(scopedBot.name) : null}
            onOpenScopedBot={openScopedBot}
          />
        ) : (
          <RadarGroupList
            deferredQuery={deferredQuery}
            statusFilter={statusFilter}
            shownTotal={shownTotal}
            totalRows={allRows.length}
            grouping={grouping}
            needsYouGroup={needsYouGroup}
            botGroups={botGroups}
            pinnedGroup={pinnedGroup}
            groups={groups}
            shownChildren={shownChildren}
            collapseIds={collapseIds}
            collapsedGroupIds={collapsedGroupIds}
            setCollapsed={folds.setCollapsed}
            renderRow={renderRow}
            roster={roster}
            attentionPulses={attentionPulses}
            needsItems={needs.items}
            visible={visible}
            settings={settings}
            now={now}
            onNavigate={onNavigate}
            onGroupMenu={setGroupMenu}
            projectOrder={projectOrder}
            setProjectOrder={setProjectOrder}
            rowById={rowById}
            sectionById={sectionById}
            sdk={sdk}
            actions={actions}
            selectedIds={selectedIds}
            visibleThreadIds={visibleThreadIds}
            allowMoves={orderFreeze.allowMoves}
          />
        )}
        {status === "ready" && experimental_archived?.hasNextPage ? (
          <RadarArchivedPager archived={experimental_archived} />
        ) : null}
      </div>

      <RadarWorkingDrawer
        workingGroup={workingGroup}
        workingCount={workingCount}
        open={workingOpen}
        onToggle={() => setWorkingOpen((open) => !open)}
        renderRow={renderRow}
        shownChildren={shownChildren}
        collapseIds={collapseIds}
        isCompactViewport={isCompactViewport}
        now={now}
        projectNameFor={projectNameFor}
        rowById={rowById}
        onOpenThread={(threadId) => {
          actions.open(threadId);
          onNavigate();
        }}
      />

      {groupMenu ? (
        <GroupMenu
          anchor={groupMenu}
          roster={roster}
          visible={visible}
          hasProjectOrder={projectOrder.length > 0}
          onExpandAll={folds.expandAllGroups}
          onCollapseAll={folds.collapseAllGroups}
          onResetProjectOrder={() => setProjectOrder([])}
          onClose={() => setGroupMenu(null)}
        />
      ) : null}

      {selectedIds.size > 0 ? (
        <RadarBulkBar
          count={selectedIds.size}
          onClear={keyboard.clearSelection}
          onArchive={keyboard.handleBulkArchive}
          onPin={keyboard.handleBulkPin}
          onMarkRead={keyboard.handleBulkMarkRead}
        />
      ) : null}
    </div>
  );
}

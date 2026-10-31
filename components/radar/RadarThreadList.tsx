import { hasUnresolvedActivity } from "./botScope";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
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
import { useRadarThreadActions } from "./threadActions";
import { askPulse, shortBotName } from "./bots";
import { botCoordinatorIds, botScopeIds, rosterRefreshKey } from "./botScope";
import { needsKeyOf, useCrewJudgements, useNeedsYou } from "./useCrewData";
import { NeedsYouLane } from "./NeedsYouList";
import { useReplyPrefill } from "./useReplyPrefill";
import { useBotRoster } from "./useBotRoster";
import { askingBotKeys, useHiddenBotKeys, useVisibleBots } from "./botVisibility";
import { useThreadPulses } from "./useThreadPulses";
import { mergeHiddenThreads, mergeActivityThreads, useThreadCensus } from "./hiddenThreads";
import { useArrivals } from "./useArrivals";
import { useFrozenOrder, useOrderFreeze } from "./useFrozenOrder";
import { useValidatedRailScope } from "./railScope";
import { useThreadGroups, type ThreadGroup } from "./useThreadGroups";
import {
  PROJECT_ORDER_KEY,
  readStringArray,
  useListSettings,
  useListView,
  useNeedsLaneOpen,
  useShowHidden,
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
import { ListModeSwitch, useListMode } from "./ListModeSwitch";
import { BotsView } from "./BotsView";
import { BotDeskMenu, BotDeskMenuProvider } from "./BotDeskMenu";
import { useBotTasks } from "./useBotTasks";
import { needRows } from "@/lib/botTasks";

export type { StatusFilter } from "./useListSettings";
export type { RowDragHandle } from "./RadarGroupList";

void preloadExtendedIcons().catch(() => undefined);

/**
 * The sidebar list. With the botsSwitch setting off it is exactly the thread
 * list. On, a Bots | Threads switch sits on top: Bots reads each bot's tasks,
 * Threads is the thread list with every thread in it. Switching never
 * navigates, so the open thread stays open.
 */
export function RadarThreadList(props: PluginThreadListProps) {
  const { botsSwitch } = useListSettings();
  if (!botsSwitch) return <RadarThreadsList {...props} />;
  return <RadarSwitchedList {...props} />;
}

function RadarSwitchedList(props: PluginThreadListProps) {
  const { activeThreadId, isCompactViewport, onNavigate: hostOnNavigate } = props;
  const [mode, setMode] = useListMode();
  const tasks = useBotTasks(true);
  const sidebar = experimental_useSidebarThreads();
  const unreadChats = useMemo(() => new Set(sidebar.threads.filter(thread => thread.isUnread).map(thread => thread.id)), [sidebar.threads]);
  const actions = useRadarThreadActions();
  const navigation = useRef(hostOnNavigate);
  useLayoutEffect(() => { navigation.current = hostOnNavigate; }, [hostOnNavigate]);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const needsCount = null;
  const unreadBots = mode === "bots" ? 0 : (tasks.data?.bots ?? []).filter(bot => bot.coordinatorThreadId !== activeThreadId && unreadChats.has(bot.coordinatorThreadId)).length;
  const openThread = useCallback((threadId: string) => {
    actions.open(threadId);
    navigation.current();
  }, [actions]);
  // "Show threads" unmounts the pressed button, so focus lands on the Threads segment.
  const threadsSegment = useRef<HTMLButtonElement>(null);
  const showThreads = useCallback(() => {
    setMode("threads");
    threadsSegment.current?.focus();
  }, [setMode]);
  // A typed filter survives a trip to Bots and back.
  const threadsQuery = useRef("");
  const keepQuery = useCallback((query: string) => { threadsQuery.current = query; }, []);
  return (
    <div className={cn("radar-list-shell", isCompactViewport && "radar-list-compact")} data-radar-mode={mode}>
      <ListModeSwitch mode={mode} onChange={setMode} needsCount={needsCount} unreadBots={unreadBots} threadsRef={threadsSegment} />
      {mode === "threads" ? (
        <RadarThreadsList {...props} everyThread initialQuery={threadsQuery.current} onQueryChange={keepQuery} />
      ) : (
        <div className={cn("radar-list", "radar-bots-list", isCompactViewport && "radar-list-compact")}>
          <div className="radar-list-body">
            <BotsPane state={tasks} activeThreadId={activeThreadId} isCompactViewport={isCompactViewport}
              now={now} onOpen={openThread} onShowThreads={showThreads} unreadChats={unreadChats} />
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * The Bots view with answers and desk menus wired: an ask's answer opens its thread with the answer typed in,
 * nothing sent.
 * The prefill watches the on-screen composers, so it lives here, under the Bots switch, rather than at the
 * list root, where every composer change would re-render the Threads list too.
 */
function BotsPane(props: Omit<ComponentProps<typeof BotsView>, "onReply" | "deskMenu">) {
  const reply = useReplyPrefill(props.onOpen);
  // Each desk wears bb's thread menu for its bot's coordinator: long-press, right-click or its "⋯".
  return <BotDeskMenuProvider><BotsView {...props} onReply={reply} deskMenu={BotDeskMenu} /></BotDeskMenuProvider>;
}

/**
 * The thread list: composes the host's thread data, bots and settings into
 * the header, the grouped rows, the Working drawer and the bulk dock.
 */
function RadarThreadsList({
  activeThreadId,
  isCompactViewport,
  onNavigate: hostOnNavigate,
  everyThread = false,
  initialQuery,
  onQueryChange,
}: PluginThreadListProps & { everyThread?: boolean; initialQuery?: string; onQueryChange?: (query: string) => void }) {
  // Route changes replace the host's callbacks. Rows need the current action,
  // but only the old/new active rows need new presentation props.
  const navigation = useRef(hostOnNavigate);
  useLayoutEffect(() => { navigation.current = hostOnNavigate; }, [hostOnNavigate]);
  const onNavigate = useCallback(() => navigation.current(), []);
  const view = useListView(initialQuery, onQueryChange);
  const { query, setQuery, lifecycle, statusFilter, switchPending } = view;
  const settings = useListSettings();
  const { density, grouping } = settings;
  const [projectOrder, setProjectOrder] = useState<string[]>(() =>
    readStringArray(PROJECT_ORDER_KEY),
  );
  const [groupMenu, setGroupMenu] = useState<GroupMenuAnchor | null>(null);
  const [workingOpen, setWorkingOpen] = useWorkingOpen();
  const [needsLaneOpen, setNeedsLaneOpen] = useNeedsLaneOpen();
  const [showHidden, setShowHidden] = useShowHidden();
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
          : (["active"] as const),
    }),
    [lifecycle],
  );
  const {
    status,
    threads: feedThreads,
    projects,
    sections,
    experimental_archived,
  } = experimental_useSidebarThreads(lifecyclesParam);
  const botRail = settings.botRail;
  // Shortcuts and deck share the list; only one bot control is shown.
  const deck = settings.botsDeck && !botRail;
  const tuckBots = settings.botsPage || everyThread;
  const roster = useBotRoster(settings.botsDeck || botRail || tuckBots, rosterRefreshKey(feedThreads));
  // Activity discovery is independent of row visibility. Hidden rows join the
  // displayed list only when requested; bot summaries always use the census.
  const hiddenProjectIds = useMemo(
    () => [...projects.map(project => project.id), ...roster.flatMap(bot => [bot.projectId, ...bot.projects])],
    [projects, roster],
  );
  // The roster still excludes bot families on the Bots page, but no bot
  // activity is displayed here. Only visible bot controls or hidden rows need
  // the independent project census.
  const census = useThreadCensus(showHidden || ((deck || botRail) && roster.length > 0), hiddenProjectIds, now);
  const hiddenRows = useMemo(() => [...census.rows, ...census.staleRows], [census.rows, census.staleRows]);
  const activityThreads = useMemo(() => mergeActivityThreads(feedThreads, census.rows), [feedThreads, census.rows]);
  const activityCoverage = useMemo(() => {
    const staleThreads = mergeActivityThreads([], census.staleRows);
    const known = new Set(activityThreads.map(thread => thread.id));
    const topology = [...activityThreads, ...staleThreads.filter(thread => !known.has(thread.id))];
    return { complete: census.complete && !hasUnresolvedActivity(topology, roster), staleThreads };
  }, [census.complete, census.staleRows, activityThreads, roster]);
  const allThreads = useMemo(
    () => showHidden ? mergeHiddenThreads(feedThreads, hiddenRows) : feedThreads,
    [showHidden, feedThreads, hiddenRows],
  );
  // Saved asks and alerts are rows in the Needs-you lane, so the lane alone is reason to load them.
  const needs = useNeedsYou(!settings.botsPage && (settings.botsDeck || botRail || settings.needsYouLane));
  const railScope = useValidatedRailScope(roster, botRail);
  // Deck cards read the full roster's coordinators from the unfiltered list,
  // so a hidden bot's open ask can still protect it from hiding.
  const coordinatorRows = useMemo(
    () => deck || botRail ? feedThreads.filter((thread) => roster.some((bot) => bot.current === thread.id)) : [],
    [feedThreads, roster, deck, botRail, railScope],
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
  // Bot state reads the feed: the hidden-workers option changes rows, not how a bot looks.
  const visible = useVisibleBots(roster, activityThreads, asking);
  const scopedBot = roster.find(bot => bot.key === railScope) ?? null;
  // Selecting a bot reveals the records that explain its saved-attention badge.
  // Only a scope change opens it; subsequent polling respects manual collapse.
  useEffect(() => {
    if (railScope && roster.some(bot => bot.key === railScope && ((bot.unseenAttention ?? 0) > 0 || (bot.actionableNeeds ?? 0) > 0))) setNeedsLaneOpen(true);
  }, [railScope, setNeedsLaneOpen]);

  const scopeName = scopedBot?.name ?? "Bot";
  const missingBots = deck ? visible.bots.filter(bot => bot.rolloverBlocked && !feedThreads.some(thread => thread.id === bot.current)) : [];
  const threads = useMemo(() => {
    if (roster.length === 0) return allThreads;
    if (settings.botsPage || (tuckBots && !scopedBot)) {
      // Bots live on the Bots page: their whole families leave the list.
      const tucked = new Set(roster.flatMap(bot => [...botScopeIds(allThreads, bot)]));
      return allThreads.filter(thread => !tucked.has(thread.id));
    }
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
  }, [allThreads, scopedBot, botRail, deck, roster, visible.hiddenBots, settings.botsPage, tuckBots]);
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
    showHidden,
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
    showHidden,
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
  // Every view folds the whole lane to one row with one remembered open
  // state. Keyboard travel skips a folded lane.
  const needsLane = useMemo(() => ({
    open: needsLaneOpen,
    toggle: () => setNeedsLaneOpen(value => !value),
  }), [needsLaneOpen, setNeedsLaneOpen]);
  // A bot's view shows that bot's items, matched by key so a rollover's new
  // coordinator or a bot without waiting threads changes nothing.
  const laneItems = useMemo(
    () => scopedBot && needs.items ? needs.items.filter(item => item.bot === scopedBot.key) : needs.items,
    [scopedBot, needs.items],
  );
  const keyboardGroupIds = useMemo(
    () => needsYouGroup && !needsLane.open ? new Set([...collapsedGroupIds, needsYouGroup.id]) : collapsedGroupIds,
    [needsYouGroup, needsLane.open, collapsedGroupIds],
  );

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
    collapsedGroupIds: keyboardGroupIds,
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
    actions.open(scopedBot.current);
    onNavigate();
  };
  // A Needs row opens its source thread; a recommendation also seeds that thread's reply.
  const openNeed = useCallback((threadId: string) => { actions.open(threadId); onNavigate(); }, [actions, onNavigate]);
  const replyToNeed = useReplyPrefill(openNeed);

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
        pinnedCount={allRows.filter((thread) => thread.isPinned && !thread.isHidden).length}
        isCompactViewport={isCompactViewport}
        grouping={grouping}
        areAllGroupsCollapsed={folds.areAllGroupsCollapsed}
        onToggleAllGroups={folds.toggleAllGroups}
        botRail={botRail}
        bots={visible.bots}
        allThreads={activityThreads}
        activityCoverage={activityCoverage}
        attentionPulses={attentionPulses}
        railScope={railScope}
        scopedBot={scopedBot}
        scopeName={scopeName}
        activeThreadId={activeThreadId}
        motion={settings.motion}
        actions={actions}
        onNavigate={onNavigate}
        showHidden={showHidden}
        onToggleShowHidden={() => setShowHidden((value) => !value)}
      />

      <div
        className={cn(
          "radar-list-body",
          switchPending && "radar-list-switching",
        )}
        aria-busy={switchPending || undefined}
        onScroll={orderFreeze.onScroll}
      >
        {settings.needsYouLane && needs.status === "unavailable" ? <p role="status" className="radar-needs-error">Saved attention unavailable. Retrying automatically.</p> : null}
        {status === "loading" ? (
          <RadarListLoading />
        ) : status === "error" ? (
          <RadarListError />
        ) : shownTotal === 0 && !(deck && roster.length > 0) && missingBots.length === 0 && (grouping !== "section" || sections.length === 0) ? (
          <>
            {/* A bot with no worker threads can still have asks waiting on Salem. */}
            {settings.needsYouLane ? (
              <NeedsYouLane
                items={laneItems ?? []}
                waitingCount={0}
                open={needsLane.open}
                onToggle={needsLane.toggle}
                roster={roster}
                now={now}
                onUpdate={needs.update}
                onOpen={openNeed}
                onReply={replyToNeed}
              />
            ) : null}
            <RadarListEmpty
              query={deferredQuery}
              statusFilter={statusFilter}
              scopedBotName={scopedBot ? shortBotName(scopedBot.name) : null}
              onOpenScopedBot={openScopedBot}
            />
          </>
        ) : (
          <RadarGroupList
            deferredQuery={deferredQuery}
            statusFilter={statusFilter}
            shownTotal={shownTotal}
            totalRows={allRows.length}
            grouping={grouping}
            needsYouGroup={needsYouGroup}
            needsLane={needsLane}
            botGroups={botGroups}
            pinnedGroup={pinnedGroup}
            groups={groups}
            shownChildren={shownChildren}
            collapseIds={collapseIds}
            collapsedGroupIds={collapsedGroupIds}
            setCollapsed={folds.setCollapsed}
            renderRow={renderRow}
            roster={roster}
            botThreads={activityThreads}
            activityCoverage={activityCoverage}
            missingBots={missingBots}
            attentionPulses={attentionPulses}
            needsItems={needs.items}
            laneItems={laneItems}
            onUpdateNeed={needs.update}
            onOpenNeed={openNeed}
            onReplyToNeed={replyToNeed}
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

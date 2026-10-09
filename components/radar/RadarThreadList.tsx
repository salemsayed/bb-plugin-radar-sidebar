import {
  Fragment,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
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
import {
  experimental_useProviders,
  experimental_useSidebarThreadActions,
  experimental_useSidebarThreads,
  useSdk,
  useSettings,
  type PluginSidebarThread,
  type PluginThreadListProps,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  DEFAULT_SWIPE_LEFT,
  DEFAULT_SWIPE_RIGHT,
  swipeActionFromSetting,
} from "@/lib/swipe";
import { preloadExtendedIcons } from "@/components/ui/icon";
import { RadarThreadRow } from "./RadarThreadRow";
import { RadarBotSwitcher } from "./RadarBotSwitcher";
import { RadarBotCard } from "./RadarBotCard";
import { BotFace } from "./BotFace";
import { askPulse, botState, botStyle, crewDigest, shortBotName } from "./bots";
import { botCoordinatorIds, botScopeIds, rosterRefreshKey } from "./botScope";
import { RadarCrewView } from "./RadarCrewView";
import { useCrewJudgements, useNeedsYou } from "./useCrewData";
import { useBotRoster } from "./useBotRoster";
import { askingBotKeys, useHiddenBotKeys, useVisibleBots } from "./botVisibility";
import { useThreadPulses } from "./useThreadPulses";
import { activityTime, isLiveThread, isRunningThread, timeAgo } from "./time";
import {
  GroupHeader,
  SortableGroupSection,
} from "./RadarGroupHeader";
import { RadarMenu, type RadarMenuItem } from "./RadarMenu";
import { useArrivals } from "./useArrivals";
import { CREW_SCOPE, setRailScope, useValidatedRailScope } from "./railScope";
import {
  useThreadGroups,
  type ThreadGroup,
} from "./useThreadGroups";
import { RadarSmartViews } from "./RadarSmartViews";
import { RadarViewOptions, RadarViewSection } from "./RadarViewOptions";
import { RadarWorkingPeek } from "./RadarWorkingPeek";
import { RadarNewSection } from "./RadarNewSection";

void preloadExtendedIcons().catch(() => undefined);

type LifecycleFilter = "active" | "archived" | "all";
type Grouping = "time" | "project" | "section";
export type StatusFilter = "all" | "live" | "waiting" | "unread" | "pinned";

const STATUS_LABELS: Record<StatusFilter, string> = {
  all: "Any status",
  live: "Live",
  waiting: "Waiting",
  unread: "Unread",
  pinned: "Pinned",
};
const LIFECYCLE_LABELS: Record<LifecycleFilter, string> = {
  active: "Active",
  archived: "Archived",
  all: "Archived too",
};

/** Row drag affordance handed to a thread row's grip handle. */
export interface RowDragHandle {
  attributes: ReturnType<typeof useDraggable>["attributes"];
  listeners: ReturnType<typeof useDraggable>["listeners"];
  isDragging: boolean;
}
type DensityMode = "comfortable" | "compact";

const LIFECYCLE_KEY = "radar-sidebar:lifecycles:v1";
const GROUPING_KEY = "radar-sidebar:grouping:v1";
const COLLAPSED_KEY = "radar-sidebar:collapsed:v1";
const COLLAPSED_THREADS_KEY = "radar-sidebar:collapsed-threads:v1";
const PROJECT_ORDER_KEY = "radar-sidebar:project-order:v1";
const STATUS_FILTER_KEY = "radar-sidebar:status-filter:v1";
const DENSITY_KEY = "radar-sidebar:density:v1";
const LAST_DEFAULT_DENSITY_KEY = "radar-sidebar:last-default-density:v1";
const LAST_TWO_LINE_TITLES_KEY = "radar-sidebar:last-two-line-titles:v1";
const WORKING_OPEN_KEY = "radar-sidebar:working-open:v1";

const EMPTY_ID_SET: ReadonlySet<string> = new Set();


function readStored<T extends string>(
  key: string,
  fallback: T,
  allowed: readonly T[],
): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw && (allowed as readonly string[]).includes(raw)) return raw as T;
  } catch {
    // Private browsing or unavailable storage: fall through to the default.
  }
  return fallback;
}

function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Ignore: the preference simply won't persist.
  }
}

/** Plugin settings, with the shipped defaults applied while they load. The two
 * that set row height fall back to the value this client last saw instead, so
 * a reload paints rows at their final size without holding the list back.
 * Swipe actions stay off until the settings arrive. */
function useSidebarSettings() {
  const { values } = useSettings();
  const flag = (key: string, fallback: boolean): boolean =>
    typeof values?.[key] === "boolean" ? (values[key] as boolean) : fallback;
  const [lastSeen] = useState(() => ({
    defaultDensity: readStored<DensityMode>(
      LAST_DEFAULT_DENSITY_KEY,
      "comfortable",
      ["comfortable", "compact"],
    ),
    wrapTitles: readStored(LAST_TWO_LINE_TITLES_KEY, "off", ["off", "on"]) === "on",
  }));
  const loaded = values !== undefined;
  const defaultDensity: DensityMode = loaded
    ? values.defaultDensity === "compact" ? "compact" : "comfortable"
    : lastSeen.defaultDensity;
  const wrapTitles = loaded ? flag("twoLineTitles", false) : lastSeen.wrapTitles;
  // Swipes act on threads, so they wait for the saved choice rather than
  // running on the defaults for someone who turned them off.
  const swipeOn = loaded && flag("swipeActions", true);
  useEffect(() => {
    if (!loaded) return;
    writeStored(LAST_DEFAULT_DENSITY_KEY, defaultDensity);
    writeStored(LAST_TWO_LINE_TITLES_KEY, wrapTitles ? "on" : "off");
  }, [loaded, defaultDensity, wrapTitles]);
  return {
    botRail: flag("botRail", false),
    botsDeck: flag("botsDeck", true),
    needsYouLane: flag("needsYouLane", true),
    nestByOwner: flag("nestByOwner", true),
    hideEmptySections: flag("hideEmptySections", false),
    hideWorking: flag("hideWorking", false),
    hoverCard: flag("hoverCard", true),
    celebrate: flag("celebrate", true),
    motion: flag("motion", true),
    loudUnread: flag("loudUnread", true),
    adaptiveCollapse: flag("adaptiveCollapse", true),
    defaultDensity,
    wrapTitles,
    swipeRight: swipeOn
      ? swipeActionFromSetting(values?.swipeRight, DEFAULT_SWIPE_RIGHT)
      : "none",
    swipeLeft: swipeOn
      ? swipeActionFromSetting(values?.swipeLeft, DEFAULT_SWIPE_LEFT)
      : "none",
  };
}

function readStringArray(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((entry): entry is string => typeof entry === "string");
    }
  } catch {
    // Corrupt value: start fresh.
  }
  return [];
}

/** One line per outcome so a partly-failed bulk action never reads as success. */
function reportBulk(
  results: readonly PromiseSettledResult<unknown>[],
  success: (count: number) => string,
  failure: (count: number) => string,
): void {
  const failed = results.filter((result) => result.status === "rejected").length;
  const succeeded = results.length - failed;
  if (failed > 0) toast.error(failure(failed));
  if (succeeded > 0) toast.success(success(succeeded));
}

const nThreads = (count: number) => `${count} thread${count === 1 ? "" : "s"}`;

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

/** Outlasts the `.radar-fold` collapse transition (280ms in app.css). */
const FOLD_UNMOUNT_MS = 320;

/**
 * A collapsible group or family body. Its rows stay mounted only while open
 * and through the closing animation, so a folded group costs nothing: no
 * rows, no per-row host subscriptions, no pull-request lookups. Opening
 * mounts them in the same commit the grid starts growing, so it animates.
 */
function Fold({
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

function renderSubtree(
  thread: PluginSidebarThread,
  depth: number,
  renderRow: (
    thread: PluginSidebarThread,
    depth: number,
    groupProjectId: string | null,
    isLastChild: boolean,
    dragHandle: RowDragHandle | null,
    hidden: boolean,
  ) => ReactNode,
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

const problem = (cause: unknown) =>
  cause instanceof Error ? cause.message : String(cause);

export function RadarThreadList({
  activeThreadId,
  isCompactViewport,
  onNavigate,
}: PluginThreadListProps) {
  const [query, setQuery] = useState("");
  const [lifecycle, setLifecycle] = useState<LifecycleFilter>(() =>
    readStored(LIFECYCLE_KEY, "active", ["active", "archived", "all"]),
  );
  const [grouping, setGrouping] = useState<Grouping>(() =>
    readStored(GROUPING_KEY, "time", ["time", "project", "section"]),
  );
  const [activeView, setActiveView] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(() =>
    readStored(STATUS_FILTER_KEY, "all", ["all", "live", "waiting", "unread"]),
  );
  const settings = useSidebarSettings();
  /**
   * Density is stored as an override: "auto" (or nothing) follows the server
   * `defaultDensity`, an explicit value wins. Toggling back onto the server
   * default clears the override, so the setting becomes authoritative again
   * instead of being locked out forever by one stray click.
   */
  const [densityOverride, setDensityOverride] = useState<
    DensityMode | "auto"
  >(() => readStored(DENSITY_KEY, "auto", ["auto", "comfortable", "compact"]));
  const density: DensityMode =
    densityOverride === "auto" ? settings.defaultDensity : densityOverride;
  const selectDensity = (next: DensityMode) => {
    const stored = next === settings.defaultDensity ? "auto" : next;
    setDensityOverride(stored);
    writeStored(DENSITY_KEY, stored);
  };
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [keyboardFocusedId, setKeyboardFocusedId] = useState<string | null>(null);
  const lastSelectedIdRef = useRef<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(
    () => new Set(readStringArray(COLLAPSED_KEY)),
  );
  const [projectOrder, setProjectOrder] = useState<string[]>(() =>
    readStringArray(PROJECT_ORDER_KEY),
  );
  const [dragActiveId, setDragActiveId] = useState<string | null>(null);
  const [draggingThreadId, setDraggingThreadId] = useState<string | null>(
    null,
  );
  const draggingThreadIds = useRef<string[]>([]);
  const [groupMenu, setGroupMenu] = useState<{
    x: number;
    y: number;
    /** Opened on a bot card: offers to hide that bot. */
    botKey?: string;
  } | null>(null);
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
  // Regrouping remounts every row: run it as a transition so the click
  // itself never freezes, with a subtle dim while the swap lands.
  const [switchPending, startSwitch] = useTransition();
  const [collapsedThreads, setCollapsedThreads] = useState<Set<string>>(
    () => new Set(readStringArray(COLLAPSED_THREADS_KEY)),
  );
  // Fold state persists from an effect, not from inside the state updaters.
  useEffect(() => {
    writeStored(COLLAPSED_KEY, JSON.stringify([...collapsed]));
  }, [collapsed]);
  useEffect(() => {
    writeStored(COLLAPSED_THREADS_KEY, JSON.stringify([...collapsedThreads]));
  }, [collapsedThreads]);
  // Hovering the Working header peeks into its threads (pointer only).
  const [workingPeek, setWorkingPeek] = useState<DOMRect | null>(null);
  const peekTimer = useRef<number | null>(null);
  const clearPeekTimer = () => {
    if (peekTimer.current !== null) window.clearTimeout(peekTimer.current);
    peekTimer.current = null;
  };
  const schedulePeek = (next: () => DOMRect | null, delay: number) => {
    clearPeekTimer();
    peekTimer.current = window.setTimeout(() => {
      peekTimer.current = null;
      setWorkingPeek(next());
    }, delay);
  };
  useEffect(() => clearPeekTimer, []);
  // The Working drawer starts folded: out of sight is the point.
  const [workingOpen, setWorkingOpen] = useState(
    () => readStored(WORKING_OPEN_KEY, "closed", ["closed", "open"]) === "open",
  );
  useEffect(() => {
    writeStored(WORKING_OPEN_KEY, workingOpen ? "open" : "closed");
  }, [workingOpen]);
  // Typing stays responsive: the heavy list derivation trails the input.
  const deferredQuery = useDeferredValue(query);
  // Filtering forces everything open so matches never hide inside folds.
  const isFiltering = deferredQuery.trim() !== "" || statusFilter !== "all";
  const collapseIds: ReadonlySet<string> =
    isFiltering ? EMPTY_ID_SET : collapsedThreads;
  const collapsedGroupIds: ReadonlySet<string> =
    isFiltering ? EMPTY_ID_SET : collapsed;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    threadId: string;
  } | null>(null);
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
    () => deck || (botRail && railScope !== CREW_SCOPE) ? allThreads.filter((thread) => roster.some((bot) => bot.current === thread.id)) : [],
    [allThreads, roster, deck, botRail, railScope],
  );
  const pulses = useThreadPulses(coordinatorRows, deck || (botRail && railScope !== CREW_SCOPE));
  const judgements = useCrewJudgements(coordinatorRows);
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
  const scopedBot = roster.find(bot => bot.key === railScope) ?? null;
  // The crew overview replaces the thread list; it reads its own data.
  const crewView = railScope === CREW_SCOPE;
  const scopeName = crewView ? "Crew" : scopedBot?.name ?? "Bot";
  const threads = useMemo(() => {
    if (roster.length === 0) return allThreads;
    if (!botRail) {
      // Deck: a hidden bot's whole family leaves the list, so its coordinator
      // does not come back as a pinned row with its workers nested under it.
      if (!deck || visible.hiddenBots.length === 0) return allThreads;
      const tucked = new Set(visible.hiddenBots.flatMap(bot => [...botScopeIds(allThreads, bot)]));
      return allThreads.filter(thread => !tucked.has(thread.id));
    }
    if (crewView) return [];
    if (scopedBot) {
      const ids = botScopeIds(allThreads, scopedBot);
      const coordinators = botCoordinatorIds(scopedBot);
      return allThreads.filter(thread => ids.has(thread.id) && !coordinators.has(thread.id));
    }
    const tucked = new Set(roster.flatMap(bot => [...botScopeIds(allThreads, bot)]));
    return allThreads.filter(thread => !tucked.has(thread.id));
  }, [allThreads, scopedBot, crewView, botRail, deck, roster, visible.hiddenBots]);
  const actions = experimental_useSidebarThreadActions();
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
    shownChildren,
    countSubtree,
    pinnedGroup,
    botGroups,
    needsYouGroup,
    workingGroup,
    workingCount,
    groups,
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
  }, []);

  const allGroupIds = useMemo(
    () => [
      ...(needsYouGroup ? [needsYouGroup.id] : []),
      ...botGroups.map((g) => g.id),
      ...(pinnedGroup ? [pinnedGroup.id] : []),
      ...groups.map((g) => g.id),
    ],
    [needsYouGroup, botGroups, pinnedGroup, groups],
  );

  // Every running thread in the drawer, nested replies included, matching
  // the count on its header.
  const workingLive = useMemo(() => {
    const live: PluginSidebarThread[] = [];
    const walk = (thread: PluginSidebarThread, depth: number) => {
      if (isLiveThread(thread)) live.push(thread);
      if (depth > 25) return;
      for (const child of shownChildren.get(thread.id) ?? []) walk(child, depth + 1);
    };
    for (const root of workingGroup?.roots ?? []) walk(root, 0);
    return live;
  }, [workingGroup, shownChildren]);

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
  }, [allGroupIds]);

  const expandAllGroups = useCallback(() => {
    setCollapsed(new Set<string>());
  }, []);

  const collapseAllGroups = useCallback(() => {
    setCollapsed(new Set(allGroupIds));
  }, [allGroupIds]);

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
    [groups, projectOrder],
  );

  const toggleThreadCollapse = useCallback((id: string) => {
    setCollapsedThreads((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleNewThreadInProject = useCallback(
    (projectId: string) => {
      actions.openNewThread({ projectId, focusPrompt: true });
      onNavigate();
    },
    [actions, onNavigate],
  );

  const visibleFlattenedThreadIds = useMemo(() => {
    const list: string[] = [];
    const walk = (threadList: PluginSidebarThread[], depth = 0) => {
      for (const t of threadList) {
        list.push(t.id);
        if (depth <= 25 && !collapseIds.has(t.id)) {
          const kids = shownChildren.get(t.id);
          if (kids && kids.length > 0) {
            walk(kids, depth + 1);
          }
        }
      }
    };
    if (needsYouGroup && !collapsedGroupIds.has(needsYouGroup.id)) {
      walk(needsYouGroup.roots);
    }
    for (const group of botGroups) {
      // The card stands in for the coordinator's own row; only its workers are rows.
      if (!collapsedGroupIds.has(group.id)) walk(shownChildren.get(group.roots[0]!.id) ?? [], 1);
    }
    if (pinnedGroup && !collapsedGroupIds.has(pinnedGroup.id)) {
      walk(pinnedGroup.roots);
    }
    for (const group of groups) {
      if (!collapsedGroupIds.has(group.id)) {
        walk(group.roots);
      }
    }
    if (workingGroup && workingOpen) walk(workingGroup.roots);
    return list;
  }, [needsYouGroup, botGroups, pinnedGroup, groups, workingGroup, workingOpen, collapsedGroupIds, collapseIds, shownChildren]);
  const visibleThreadIds = useMemo(
    () => new Set(visibleFlattenedThreadIds),
    [visibleFlattenedThreadIds],
  );
  // Every host snapshot rebuilds the flattened order. Rows read it through a
  // ref so their select handler stays stable and the memo keeps them still.
  const visibleOrderRef = useRef(visibleFlattenedThreadIds);
  visibleOrderRef.current = visibleFlattenedThreadIds;

  const handleToggleSelect = useCallback(
    (event: { shiftKey: boolean }, threadId: string) => {
      const order = visibleOrderRef.current;
      if (event.shiftKey && lastSelectedIdRef.current) {
        const fromIdx = order.indexOf(lastSelectedIdRef.current);
        const toIdx = order.indexOf(threadId);
        if (fromIdx !== -1 && toIdx !== -1) {
          const [start, end] = fromIdx < toIdx ? [fromIdx, toIdx] : [toIdx, fromIdx];
          const range = order.slice(start, end + 1);
          setSelectedIds((prev) => new Set([...prev, ...range]));
          lastSelectedIdRef.current = threadId;
          return;
        }
      }
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(threadId)) next.delete(threadId);
        else next.add(threadId);
        return next;
      });
      lastSelectedIdRef.current = threadId;
    },
    [],
  );

  // Selection only ever covers rows the list still shows: a filter or
  // lifecycle change must not leave invisible threads armed for bulk actions.
  useEffect(() => {
    setSelectedIds((previous) => {
      if (previous.size === 0) return previous;
      const next = new Set([...previous].filter((id) => visibleThreadIds.has(id)));
      return next.size === previous.size ? previous : next;
    });
    if (lastSelectedIdRef.current && !visibleThreadIds.has(lastSelectedIdRef.current)) {
      lastSelectedIdRef.current = null;
    }
  }, [visibleThreadIds]);

  useEffect(() => {
    const hiddenKeyboardId = keyboardFocusedId && !visibleThreadIds.has(keyboardFocusedId)
      ? keyboardFocusedId : null;
    if (hiddenKeyboardId) setKeyboardFocusedId(null);
    const focusedRow = document.activeElement instanceof HTMLElement
      ? document.activeElement.closest<HTMLElement>("[data-sidebar-thread-id]") : null;
    const focusedRowId = focusedRow && rootRef.current?.contains(focusedRow)
      ? focusedRow.getAttribute("data-sidebar-thread-id") : null;
    const hiddenFocusId = focusedRowId && !visibleThreadIds.has(focusedRowId)
      ? focusedRowId
      : document.activeElement === document.body ? hiddenKeyboardId : null;
    if (!hiddenFocusId) return;
    // A closing fold keeps its rows mounted while it animates. Move focus out
    // of hidden rows, preserving focus on any visible control the user
    // clicked to fold them.
    let parentId = rowById.get(hiddenFocusId)?.parentThreadId;
    const visited = new Set<string>();
    while (parentId && !visited.has(parentId)) {
      visited.add(parentId);
      if (visibleThreadIds.has(parentId)) break;
      parentId = rowById.get(parentId)?.parentThreadId;
    }
    const parent = parentId && visibleThreadIds.has(parentId)
      ? rootRef.current?.querySelector<HTMLElement>(`[data-sidebar-thread-id="${parentId}"]`)
      : null;
    const groupControl = focusedRow?.closest("section")?.querySelector<HTMLElement>(".radar-group-toggle");
    (parent || groupControl || searchInputRef.current)?.focus({ preventScroll: true });
  }, [keyboardFocusedId, visibleThreadIds, rowById]);

  const handleBulkArchive = useCallback(() => {
    for (const id of selectedIds) {
      if (visibleThreadIds.has(id)) actions.archive(id);
    }
    setSelectedIds(new Set());
  }, [selectedIds, actions, visibleThreadIds]);

  const handleBulkPin = useCallback(async () => {
    const ids = [...selectedIds];
    const pin = !ids.every((id) => rowById.get(id)?.isPinned);
    setSelectedIds(new Set());
    const results = await Promise.allSettled(
      ids.map((id) => actions.setPinned(id, pin)),
    );
    reportBulk(
      results,
      (count) => `${pin ? "Pinned" : "Unpinned"} ${nThreads(count)}`,
      (count) => `Couldn’t ${pin ? "pin" : "unpin"} ${nThreads(count)}.`,
    );
  }, [selectedIds, rowById, actions]);

  const handleBulkMarkRead = useCallback(async () => {
    const ids = [...selectedIds];
    setSelectedIds(new Set());
    const results = await Promise.allSettled(
      ids.map((id) => sdk.threads.markRead({ threadId: id })),
    );
    reportBulk(
      results,
      (count) => `Marked ${nThreads(count)} read`,
      (count) => `Couldn’t mark ${nThreads(count)} read.`,
    );
  }, [selectedIds, sdk]);

  useEffect(() => {
    const focusRow = (id: string) => {
      const row = rootRef.current?.querySelector<HTMLElement>(
        `[data-sidebar-thread-id="${id}"]`,
      );
      // Keep the actual keyboard target in sync with the visual highlight.
      row?.focus({ preventScroll: true });
      row?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      setKeyboardFocusedId(id);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      // Another handler (a host menu, dialog or select) already owns this key.
      if (event.defaultPrevented) return;
      const target = event.target instanceof HTMLElement ? event.target : null;

      if (target !== null && target === searchInputRef.current) {
        if (event.key === "Escape") {
          event.preventDefault();
          if (query) {
            setQuery("");
          } else {
            searchInputRef.current?.blur();
          }
        } else if (event.key === "ArrowDown") {
          if (visibleFlattenedThreadIds.length > 0) {
            event.preventDefault();
            focusRow(visibleFlattenedThreadIds[0]);
          }
        } else if (event.key === "Enter") {
          if (visibleFlattenedThreadIds.length > 0) {
            event.preventDefault();
            actions.open(visibleFlattenedThreadIds[0]);
            onNavigate();
          }
        }
        return;
      }

      // Shortcuts are bare keys, so they stay out of anywhere the app owns the
      // keyboard: editable fields, open dialogs and menus, and controls
      // outside this list. Plain page chrome is fair game.
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const inList = target !== null && rootRef.current?.contains(target) === true;
      if (target !== null) {
        if (
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable ||
          target.closest("[role='textbox'], [role='combobox']") !== null
        ) {
          return;
        }
        if (!inList) {
          const overlay =
            "[role='dialog'], [role='alertdialog'], [role='menu'], [role='listbox'], [aria-modal='true']";
          const control =
            "a, button, summary, [role='button'], [role='menuitem'], [role='tab'], [role='option'], [role='checkbox'], [role='switch']";
          if (target.closest(overlay) !== null || target.closest(control) !== null) {
            return;
          }
        }
      }
      // A focused link or button keeps its native Enter/Space behaviour.
      const onControl =
        target?.closest("a, button, [role='button'], [role='menuitem']") != null;
      // The row under focus wins over the last arrow-key position.
      const rowTarget = target?.closest<HTMLElement>("[data-sidebar-thread-id]");
      const candidateId =
        rowTarget?.getAttribute("data-sidebar-thread-id") ?? keyboardFocusedId;
      const focusedId =
        candidateId && visibleThreadIds.has(candidateId) ? candidateId : null;

      if (event.key === "/") {
        event.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
        return;
      }

      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        if (event.shiftKey || visibleFlattenedThreadIds.length === 0) return;
        event.preventDefault();
        const last = visibleFlattenedThreadIds.length - 1;
        const currentIdx = focusedId
          ? visibleFlattenedThreadIds.indexOf(focusedId)
          : -1;
        const nextIdx =
          event.key === "ArrowDown"
            ? currentIdx === -1 || currentIdx >= last
              ? 0
              : currentIdx + 1
            : currentIdx <= 0
              ? last
              : currentIdx - 1;
        focusRow(visibleFlattenedThreadIds[nextIdx]);
        return;
      }

      if (event.key === "Enter") {
        if (onControl || !focusedId) return;
        event.preventDefault();
        actions.open(focusedId);
        onNavigate();
        return;
      }

      if (
        event.key === " " ||
        event.key === "ArrowRight" ||
        event.key === "ArrowLeft"
      ) {
        // Space folds a focused row link; nested buttons keep native behaviour.
        if (event.key === " " && onControl && target !== rowTarget) return;
        if (focusedId && (shownChildren.get(focusedId)?.length ?? 0) > 0) {
          event.preventDefault();
          toggleThreadCollapse(focusedId);
        }
        return;
      }

      if (event.key === "x" || event.key === "X") {
        if (focusedId) {
          event.preventDefault();
          handleToggleSelect(event, focusedId);
        }
        return;
      }

      if (event.key === "e" || event.key === "E") {
        if (selectedIds.size > 0) {
          event.preventDefault();
          handleBulkArchive();
        } else if (focusedId) {
          event.preventDefault();
          actions.archive(focusedId);
        }
        return;
      }

      if (event.key === "p" || event.key === "P") {
        if (selectedIds.size > 0) {
          event.preventDefault();
          void handleBulkPin();
        } else if (focusedId) {
          const t = rowById.get(focusedId);
          if (t) {
            event.preventDefault();
            actions.setPinned(t.id, !t.isPinned).then(
              () => {
                toast.success(t.isPinned ? "Unpinned thread" : "Pinned thread");
              },
              (cause: unknown) => {
                toast.error(problem(cause));
              },
            );
          }
        }
        return;
      }

      if (event.key === "Escape") {
        if (selectedIds.size > 0) {
          event.preventDefault();
          setSelectedIds(new Set());
        } else if (keyboardFocusedId) {
          event.preventDefault();
          if (document.activeElement === rowTarget) rowTarget?.blur();
          setKeyboardFocusedId(null);
        } else if (query) {
          event.preventDefault();
          setQuery("");
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    query,
    visibleFlattenedThreadIds,
    visibleThreadIds,
    keyboardFocusedId,
    selectedIds,
    shownChildren,
    toggleThreadCollapse,
    handleToggleSelect,
    actions,
    onNavigate,
    handleBulkArchive,
    handleBulkPin,
    rowById,
  ]);

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

  const openMenu = useCallback(
    (clientX: number, clientY: number, thread: PluginSidebarThread) => {
      setEditingId(null);
      setMenu({ x: clientX, y: clientY, threadId: thread.id });
    },
    [],
  );

  const menuThread = menu
    ? (threads.find((thread) => thread.id === menu.threadId) ?? null)
    : null;

  const menuItems = useMemo<RadarMenuItem[]>(() => {
    if (!menuThread) return [];
    const items: RadarMenuItem[] = [
      { kind: "item", id: "open-split", label: "Open in split", icon: "Columns2" },
      {
        kind: "item",
        id: "pin",
        label: menuThread.isPinned ? "Unpin" : "Pin",
        icon: menuThread.isPinned ? "PinOff" : "Pin",
        checked: menuThread.isPinned,
      },
      {
        kind: "item",
        id: "read",
        label: menuThread.isUnread ? "Mark as read" : "Mark as unread",
        icon: menuThread.isUnread ? "MailOpen" : "Mail",
      },
      ...(menuThread.parentThreadId !== null ||
      (childrenOf.get(menuThread.id)?.length ?? 0) > 0
        ? [
            {
              kind: "item",
              id: "family-read",
              label: "Mark family read",
              icon: "MailOpen",
            } as RadarMenuItem,
          ]
        : []),
      { kind: "item", id: "rename", label: "Rename…", icon: "Edit" },
      { kind: "separator" },
      { kind: "header", label: "Move to section" },
      ...sections.map(
        (section): RadarMenuItem => ({
          kind: "item",
          id: `section:${section.id}`,
          label: section.name,
          icon: "Folder",
          checked: menuThread.sectionId === section.id,
        }),
      ),
      ...(menuThread.sectionId
        ? [
            {
              kind: "item",
              id: "section-none",
              label: "No section",
              icon: "Folder",
            } as RadarMenuItem,
          ]
        : []),
      { kind: "separator" },
      ...(menuThread.isArchived
        ? [
            {
              kind: "item",
              id: "unarchive",
              label: "Unarchive",
              icon: "ArchiveRestore",
            } as RadarMenuItem,
          ]
        : [
            {
              kind: "item",
              id: "archive",
              label: "Archive",
              icon: "Archive",
            } as RadarMenuItem,
          ]),
      { kind: "item", id: "copy-link", label: "Copy link", icon: "Copy" },
      {
        kind: "item",
        id: "delete",
        label: "Delete…",
        icon: "Trash2",
        danger: true,
      },
    ];
    return items;
  }, [menuThread, sections, childrenOf]);

  const handleMenuSelect = useCallback(
    async (id: string) => {
      const thread = menuThread;
      setMenu(null);
      if (!thread) return;
      try {
        if (id === "open-split") {
          actions.open(thread.id, { split: true });
          onNavigate();
        } else if (id === "pin") {
          await actions.setPinned(thread.id, !thread.isPinned);
        } else if (id === "read") {
          await actions.setRead(thread.id, thread.isUnread);
        } else if (id === "family-read") {
          await markFamilyRead(thread);
        } else if (id === "rename") {
          setEditingId(thread.id);
        } else if (id === "archive") {
          actions.archive(thread.id);
        } else if (id === "unarchive") {
          await sdk.threads.unarchive({ threadId: thread.id });
        } else if (id === "copy-link") {
          await navigator.clipboard.writeText(
            `${window.location.origin}${thread.href}`,
          );
          toast.success("Link copied");
        } else if (id === "delete") {
          actions.requestDelete(thread.id);
        } else if (id === "section-none") {
          await sdk.threads.update({ threadId: thread.id, sectionId: null });
        } else if (id.startsWith("section:")) {
          await sdk.threads.update({
            threadId: thread.id,
            sectionId: id.slice("section:".length),
          });
        }
      } catch (cause) {
        toast.error(problem(cause));
      }
    },
    [menuThread, actions, sdk, onNavigate, markFamilyRead],
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

  const renderRow = useCallback(
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
          adaptiveCollapse={settings.adaptiveCollapse}
          isActive={thread.id === activeThreadId}
          isEditing={thread.id === editingId}
          isVisible={visibleThreadIds.has(thread.id)}
          actions={actions}
          timeText={timeAgo(activityTime(thread, now), now)}
          onNavigate={onNavigate}
          onOpenMenu={openMenu}
          onStartRename={startRename}
          onCommitRename={commitRename}
          onCancelRename={cancelRename}
          onUnarchive={unarchive}
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
      settings.adaptiveCollapse,
      settings.swipeRight,
      settings.swipeLeft,
      lifecycle,
      activeThreadId,
      editingId,
      actions,
      now,
      onNavigate,
      openMenu,
      commitRename,
      startRename,
      cancelRename,
      unarchive,
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

  const renderGroup = useCallback(
    (group: ThreadGroup, isSortable = false, draggable = false) => {
      const isCollapsed = collapsedGroupIds.has(group.id);

      const groupContextMenu = (event: React.MouseEvent<HTMLDivElement>) => {
        event.preventDefault();
        setGroupMenu({ x: event.clientX, y: event.clientY });
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
      projectOrder.length,
      draggingThreadId,
      moveThreadToSection,
    ],
  );

  const selectLifecycle = (next: LifecycleFilter) => {
    if (next === lifecycle) return;
    writeStored(LIFECYCLE_KEY, next);
    startSwitch(() => setLifecycle(next));
  };
  const selectGrouping = (next: Grouping) => {
    if (next === grouping) return;
    writeStored(GROUPING_KEY, next);
    startSwitch(() => setGrouping(next));
  };
  const selectStatus = (next: StatusFilter) => {
    setActiveView(null);
    setStatusFilter(next);
    writeStored(STATUS_FILTER_KEY, next);
  };
  /** Tapping the chosen status again goes back to every status. */
  const toggleStatus = (next: StatusFilter) =>
    selectStatus(statusFilter === next ? "all" : next);
  const selectView = (view: {
    id: string;
    name: string;
    query: string;
    statusFilter: StatusFilter;
    lifecycle: LifecycleFilter;
  }) => {
    setActiveView({ id: view.id, name: view.name });
    startSwitch(() => {
      setQuery(view.query);
      setStatusFilter(view.statusFilter);
      setLifecycle(view.lifecycle);
    });
    // "pinned" only exists as a view; a reload starts unfiltered.
    writeStored(
      STATUS_FILTER_KEY,
      view.statusFilter === "pinned" ? "all" : view.statusFilter,
    );
    writeStored(LIFECYCLE_KEY, view.lifecycle);
  };
  const clearView = () => {
    setActiveView(null);
    startSwitch(() => {
      setQuery("");
      setStatusFilter("all");
      setLifecycle("active");
    });
    writeStored(STATUS_FILTER_KEY, "all");
    writeStored(LIFECYCLE_KEY, "active");
  };

  // A bot's pill has two halves: its name opens the coordinator (the list
  // only holds workers), and the X goes back to every thread.
  const scopePill = scopedBot ? (
    <span className="radar-scope-pill">
      <button
        type="button"
        className="radar-scope-open"
        aria-label={`Open ${scopedBot.name}`}
        aria-current={activeThreadId === scopedBot.current ? "page" : undefined}
        title={`Open ${scopedBot.name}`}
        onClick={() => {
          actions.open(scopedBot.current);
          onNavigate();
        }}
      >
        <span aria-hidden="true"><BotFace botKey={scopedBot.key} name={scopedBot.name} size={16} /></span>
        <span>{shortBotName(scopedBot.name)}</span>
      </button>
      <button
        type="button"
        className="radar-scope-clear"
        aria-label={`Clear bot filter: ${scopedBot.name}`}
        title="Show all threads"
        onClick={() => setRailScope(null)}
      >
        <Icon name="X" aria-hidden="true" />
      </button>
    </span>
  ) : railScope ? (
    <button
      type="button"
      className="radar-active-filter"
      aria-label={`Clear bot filter: ${scopeName}`}
      title="Show all threads"
      onClick={() => setRailScope(null)}
    >
      <span>{scopeName}</span>
      <Icon name="X" aria-hidden="true" />
    </button>
  ) : null;

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
      data-radar-loud-unread={settings.loudUnread ? "on" : "off"}
      data-radar-swipe={
        settings.swipeRight !== "none" || settings.swipeLeft !== "none"
          ? "on"
          : "off"
      }
    >
      <div className="radar-list-header">
        {botRail ? <RadarBotSwitcher bots={visible.bots} threads={allThreads} pulses={attentionPulses}
          scope={railScope} activeThreadId={activeThreadId} compact={isCompactViewport}
          motion={settings.motion} loudUnread={settings.loudUnread}
          onClear={() => setRailScope(null)}
          onSelect={bot => { setRailScope(bot.key); actions.open(bot.current); onNavigate(); }}
          onNavigate={onNavigate} /> : null}
        {crewView ? (
          <div className="radar-search-row">
            {scopePill}
          </div>
        ) : (<>
        <div className="radar-search-row">
          <div className="radar-search">
            <Icon
              name="Search"
              aria-hidden="true"
              className="radar-search-icon"
            />
            <Input
              ref={searchInputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter threads…"
              aria-label="Filter threads"
              role="searchbox"
              className="radar-search-input"
            />
            {query !== "" ? (
              <button
                type="button"
                aria-label="Clear filter"
                title="Clear filter"
                className="radar-search-clear"
                onClick={() => setQuery("")}
              >
                <Icon name="X" aria-hidden="true" />
              </button>
            ) : (
              <kbd className="radar-search-shortcut" title="Press / to focus search">
                /
              </kbd>
            )}
          </div>
          <RadarViewOptions>
            <RadarViewSection label="Status">
              <div
                role="radiogroup"
                aria-label="Status filter"
                className="radar-status-chips"
              >
                <button
                  type="button"
                  role="radio"
                  aria-checked={statusFilter === "all"}
                  className={cn(
                    "radar-chip",
                    statusFilter === "all" && "radar-chip-active",
                  )}
                  onClick={() => selectStatus("all")}
                >
                  Any
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={statusFilter === "live"}
                  className={cn(
                    "radar-chip",
                    "radar-chip-iconic",
                    statusFilter === "live" && "radar-chip-active",
                  )}
                  aria-label="Live"
                  onClick={() => toggleStatus("live")}
                  title="Filter live / active threads"
                >
                  <span
                    className={cn(
                      "radar-chip-indicator radar-tone-running",
                      statusCounts.live > 0 && "radar-icon-pulse",
                    )}
                  >
                    <Icon name="Zap" aria-hidden="true" />
                  </span>
                  <span className="radar-chip-label">Live</span>
                  {statusCounts.live > 0 ? (
                    <span className="radar-chip-count">{statusCounts.live}</span>
                  ) : null}
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={statusFilter === "waiting"}
                  className={cn(
                    "radar-chip",
                    "radar-chip-iconic",
                    statusFilter === "waiting" && "radar-chip-active",
                  )}
                  aria-label="Waiting"
                  onClick={() => toggleStatus("waiting")}
                  title="Filter threads waiting for input or confirmation"
                >
                  <span
                    className={cn(
                      "radar-dot radar-dot-attention",
                      statusCounts.waiting > 0 && "radar-dot-pulse",
                    )}
                  />
                  <span className="radar-chip-label">Waiting</span>
                  {statusCounts.waiting > 0 ? (
                    <span className="radar-chip-count">{statusCounts.waiting}</span>
                  ) : null}
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={statusFilter === "unread"}
                  className={cn(
                    "radar-chip",
                    "radar-chip-iconic",
                    statusFilter === "unread" && "radar-chip-active",
                  )}
                  aria-label="Unread"
                  onClick={() => toggleStatus("unread")}
                  title="Filter unread threads"
                >
                  <span className="radar-unread" />
                  <span className="radar-chip-label">Unread</span>
                  {statusCounts.unread > 0 ? (
                    <span className="radar-chip-count">{statusCounts.unread}</span>
                  ) : null}
                </button>
              </div>
              <RadarSmartViews
                activeViewId={activeView?.id ?? null}
                currentQuery={query}
                currentStatusFilter={statusFilter}
                currentLifecycle={lifecycle}
                counts={{
                  pinned: allRows.filter((thread) => thread.isPinned).length,
                  live: statusCounts.live,
                  waiting: statusCounts.waiting,
                  unread: statusCounts.unread,
                }}
                onSelectView={selectView}
                onClearView={clearView}
              />
            </RadarViewSection>
            <RadarViewSection label="Threads">
              <div
                role="group"
                aria-label="Thread lifecycle"
                className="radar-segmented"
              >
                {(
                  [
                    ["active", "Active"],
                    ["archived", "Archived"],
                    ["all", "All"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={lifecycle === value}
                    className={cn(
                      "radar-segmented-button",
                      lifecycle === value && "radar-segmented-button-active",
                    )}
                    onClick={() => selectLifecycle(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </RadarViewSection>
            <RadarViewSection label="Group by">
              <div role="group" aria-label="Grouping" className="radar-segmented">
                {(
                  [
                    ["time", "Time", "Group by time", "Group by time"],
                    ["project", "Project", "Group by project", "Group by project"],
                    [
                      "section",
                      "Section",
                      "Group by section (drag threads between them)",
                      "Group by section — drag a thread onto a header to file it",
                    ],
                  ] as const
                ).map(([value, label, ariaLabel, title]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={grouping === value}
                    aria-label={ariaLabel}
                    title={title}
                    className={cn(
                      "radar-segmented-button",
                      grouping === value && "radar-segmented-button-active",
                    )}
                    onClick={() => selectGrouping(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </RadarViewSection>
            <RadarViewSection label="Layout">
              {/* Touch viewports are always compact, so density has no say there. */}
              {isCompactViewport ? null : (
                <div role="group" aria-label="Row density" className="radar-segmented">
                  {(
                    [
                      ["comfortable", "Comfortable", "Comfortable view"],
                      ["compact", "Compact", "Compact view"],
                    ] as const
                  ).map(([value, label, ariaLabel]) => (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={density === value}
                      aria-label={ariaLabel}
                      className={cn(
                        "radar-segmented-button",
                        density === value && "radar-segmented-button-active",
                      )}
                      onClick={() => selectDensity(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
              <button
                type="button"
                aria-label={
                  areAllGroupsCollapsed
                    ? "Expand all folders"
                    : "Collapse all folders"
                }
                className="radar-view-action"
                onClick={toggleAllGroups}
              >
                <Icon
                  name={areAllGroupsCollapsed ? "Expand" : "Collapse"}
                  aria-hidden="true"
                />
                <span>{areAllGroupsCollapsed ? "Expand all" : "Collapse all"}</span>
              </button>
            </RadarViewSection>
          </RadarViewOptions>
        </div>

        {scopePill || activeView !== null || statusFilter !== "all" || lifecycle !== "active" ? (
          <div role="group" aria-label="Active filters" className="radar-active-filters">
            {scopePill}
            {activeView !== null || statusFilter !== "all" ? (
              <button
                type="button"
                className="radar-active-filter"
                aria-label={`Clear ${activeView?.name ?? STATUS_LABELS[statusFilter]} filter`}
                title="Clear this filter"
                onClick={() => (activeView ? clearView() : selectStatus("all"))}
              >
                <span>{activeView?.name ?? STATUS_LABELS[statusFilter]}</span>
                <Icon name="X" aria-hidden="true" />
              </button>
            ) : null}
            {lifecycle !== "active" ? (
              <button
                type="button"
                className="radar-active-filter"
                aria-label={`Clear ${LIFECYCLE_LABELS[lifecycle]} filter`}
                title="Back to active threads"
                onClick={() => selectLifecycle("active")}
              >
                <span>{LIFECYCLE_LABELS[lifecycle]}</span>
                <Icon name="X" aria-hidden="true" />
              </button>
            ) : null}
          </div>
        ) : null}
        {grouping === "section" ? <RadarNewSection /> : null}
        </>)}
      </div>

      <div
        className={cn(
          "radar-list-body",
          switchPending && "radar-list-switching",
        )}
        aria-busy={switchPending || undefined}
      >
        {crewView ? (
          <RadarCrewView roster={roster} now={now} onNavigate={onNavigate} needs={needs} />
        ) : status === "loading" ? (
          <div className="radar-state" role="status" aria-label="Loading threads">
            {Array.from({ length: 8 }, (_, index) => (
              // eslint-disable-next-line react/no-array-index-key
              <div key={index} className="radar-skeleton" aria-hidden="true">
                <span className="radar-skeleton-title" />
                <span className="radar-skeleton-subtitle" />
              </div>
            ))}
          </div>
        ) : status === "error" ? (
          <div className="radar-state" role="alert">
            <div className="radar-empty">
              <Icon name="AlertCircle" aria-hidden="true" />
              <p>Couldn’t load threads.</p>
              <p className="radar-empty-hint">
                Check your connection — the list refreshes automatically.
              </p>
            </div>
          </div>
        ) : shownTotal === 0 && (grouping !== "section" || sections.length === 0) ? (
          <div className="radar-state" role="status">
            <div className="radar-empty">
              <Icon name="MessageSquare" aria-hidden="true" />
              {deferredQuery.trim() === "" ? (
                statusFilter !== "all" ? (
                  <>
                    <p>
                      No{" "}
                      {statusFilter === "live"
                        ? "live"
                        : statusFilter === "waiting"
                          ? "waiting"
                          : statusFilter === "pinned"
                            ? "pinned"
                            : "unread"}{" "}
                      threads.
                    </p>
                    <p className="radar-empty-hint">
                      Clear the filter under the search, or pick another status.
                    </p>
                  </>
                ) : (
                  <>
                    <p>{scopedBot ? "No worker threads." : "No threads yet."}</p>
                    {scopedBot ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          actions.open(scopedBot.current);
                          onNavigate();
                        }}
                      >
                        Open {shortBotName(scopedBot.name)}
                      </Button>
                    ) : (
                      <p className="radar-empty-hint">Start one with + above.</p>
                    )}
                  </>
                )
              ) : (
                <>
                  <p>No threads match “{deferredQuery.trim()}”.</p>
                  <p className="radar-empty-hint">
                    Try fewer words or a different filter.
                  </p>
                </>
              )}
            </div>
          </div>
        ) : (
          <>
            {deferredQuery.trim() !== "" || statusFilter !== "all" ? (
              <p className="radar-result-count" role="status">
                {shownTotal} of {allRows.length} threads
              </p>
            ) : null}
            {needsYouGroup ? renderGroup(needsYouGroup, false) : null}
            {botGroups.length > 0 || visible.hiddenBots.length > 0 ? (
              <div className="radar-crew-header" role="status" onContextMenu={(event) => { event.preventDefault(); setGroupMenu({ x: event.clientX, y: event.clientY }); }}>
                <span className="radar-crew-label">Crew</span>
                <span className="radar-crew-digest">
                  {crewDigest(botGroups.map((group) => {
                    const root = group.roots[0]!;
                    const bot = roster.find((entry) => entry.current === root.id);
                    return botState(root, attentionPulses.get(root.id) ?? null, bot?.rollover ?? null, { live: group.live - (isRunningThread(root) ? 1 : 0), needsUser: group.needsUser, failed: group.failed });
                  }), needs.items)}
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
                  onContextMenu={bot ? (event) => { event.preventDefault(); setGroupMenu({ x: event.clientX, y: event.clientY, botKey: bot.key }); } : undefined}
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
                    onNavigate={onNavigate}
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
                          <span className="radar-unread" />
                          {activeGroup.unread}
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
        )}
        {!crewView && status === "ready" && experimental_archived?.hasNextPage ? (
          <div className="radar-more">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={experimental_archived.isFetchingNextPage}
              onClick={() => {
                experimental_archived.fetchNextPage().catch(() => {
                  toast.error("Couldn’t load more threads.");
                });
              }}
            >
              {experimental_archived.isFetchingNextPage
                ? "Loading…"
                : experimental_archived.isFetchNextPageError
                  ? "Retry loading more"
                  : "Show more"}
            </Button>
          </div>
        ) : null}
      </div>

      {workingGroup ? (
        <section
          aria-label={workingGroup.label}
          className={cn(
            "radar-group radar-working-drawer",
            workingOpen ? "radar-group-expanded" : "radar-group-collapsed",
          )}
        >
          <div
            onPointerEnter={(event) => {
              if (event.pointerType !== "mouse" || isCompactViewport) return;
              const header = event.currentTarget;
              schedulePeek(() => header.getBoundingClientRect(), 350);
            }}
            onPointerLeave={() => schedulePeek(() => null, 180)}
          >
            <GroupHeader
              group={{ ...workingGroup, total: workingCount, unread: 0 }}
              isCollapsed={!workingOpen}
              onToggle={() => setWorkingOpen((open) => !open)}
              onContextMenu={(event) => event.preventDefault()}
            />
          </div>
          <Fold collapsed={!workingOpen} role="list" label={`${workingGroup.label} threads`}>
            {() =>
              workingGroup.roots.map((root, index) =>
                renderSubtree(
                  root,
                  0,
                  renderRow,
                  shownChildren,
                  null,
                  collapseIds,
                  index === workingGroup.roots.length - 1,
                  false,
                  !workingOpen,
                ),
              )
            }
          </Fold>
        </section>
      ) : null}

      {workingPeek && workingGroup && !isCompactViewport
        ? createPortal(
            <RadarWorkingPeek
              threads={workingLive}
              anchor={workingPeek}
              now={now}
              projectName={projectNameFor}
              parentTitle={(thread) => {
                const parent = rowById.get(thread.parentThreadId ?? thread.lifecycleOwnerThreadId ?? "");
                return parent ? parent.displayTitle || parent.title || null : null;
              }}
              onOpen={(threadId) => {
                clearPeekTimer();
                setWorkingPeek(null);
                actions.open(threadId);
                onNavigate();
              }}
              onPointerEnter={clearPeekTimer}
              onPointerLeave={() => schedulePeek(() => null, 180)}
            />,
            document.body,
          )
        : null}

      {groupMenu ? (
        <RadarMenu
          x={groupMenu.x}
          y={groupMenu.y}
          items={[
            ...(groupMenu.botKey
              ? [{
                  kind: "item" as const,
                  id: `hide-bot:${groupMenu.botKey}`,
                  label: `Hide ${roster.find((bot) => bot.key === groupMenu.botKey)?.name ?? "bot"}`,
                  icon: "EyeOff",
                  // Attention overrides hiding, so Hide would change nothing until the ask or failure is handled.
                  ...(visible.isProtected(groupMenu.botKey)
                    ? { disabled: true, title: "Handle its open question or unread failure before hiding it." }
                    : {}),
                }]
              : []),
            ...visible.hiddenBots.map((bot) => ({
              kind: "item" as const,
              id: `show-bot:${bot.key}`,
              label: `Show ${bot.name}`,
            })),
            ...(groupMenu.botKey || visible.hiddenBots.length > 0 ? [{ kind: "separator" as const }] : []),
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
            ...(projectOrder.length > 0
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
            setGroupMenu(null);
            if (id.startsWith("hide-bot:")) {
              visible.hide(id.slice("hide-bot:".length));
            } else if (id.startsWith("show-bot:")) {
              visible.unhide(id.slice("show-bot:".length));
            } else if (id === "expand-all-groups") {
              expandAllGroups();
            } else if (id === "collapse-all-groups") {
              collapseAllGroups();
            } else if (id === "reset-project-order") {
              try {
                localStorage.removeItem(PROJECT_ORDER_KEY);
              } catch {
                // Ignore storage failure.
              }
              setProjectOrder([]);
              toast.success("Project order reset to default");
            }
          }}
          onClose={() => setGroupMenu(null)}
        />
      ) : null}

      {menu && menuThread ? (
        <RadarMenu
          x={menu.x}
          y={menu.y}
          items={menuItems}
          onSelect={handleMenuSelect}
          onClose={() => setMenu(null)}
        />
      ) : null}

      {selectedIds.size > 0 ? (
        <div className="radar-bulk-bar" role="toolbar" aria-label="Bulk actions">
          <div className="radar-bulk-summary">
            <span className="radar-bulk-count">
              {selectedIds.size} selected
            </span>
            <button
              type="button"
              className="radar-bulk-clear"
              title="Deselect all (Esc)"
              aria-label="Deselect all"
              onClick={() => setSelectedIds(new Set())}
            >
              <Icon name="X" aria-hidden="true" />
            </button>
          </div>
          <div className="radar-bulk-actions">
            <button
              type="button"
              className="radar-bulk-btn"
              title="Archive selected (E)"
              onClick={handleBulkArchive}
            >
              <Icon name="Archive" aria-hidden="true" />
              <span>Archive</span>
            </button>
            <button
              type="button"
              className="radar-bulk-btn"
              title="Pin / Unpin selected (P)"
              onClick={handleBulkPin}
            >
              <Icon name="Pin" aria-hidden="true" />
              <span>Pin</span>
            </button>
            <button
              type="button"
              className="radar-bulk-btn"
              title="Mark selected as read"
              onClick={handleBulkMarkRead}
            >
              <Icon name="MailOpen" aria-hidden="true" />
              <span>Read</span>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

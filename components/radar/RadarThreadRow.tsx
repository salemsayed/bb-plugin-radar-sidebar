import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  ThreadTitle,
  experimental_Icon as HostIcon,
  experimental_ProviderIcon as ProviderIcon,
  experimental_useSidebarThreadPullRequest,
  experimental_useSidebarThreadSplit,
  useBbNavigate,
  useSidebarThreadDraft,
  useSidebarThreadRowStatus,
  useSidebarThreadShortcut,
  type PluginBrowserBbSdk,
  type PluginSidebarThread,
  experimental_useThreadActions,
  experimental_ThreadActionsMenu as ThreadActionsMenu,
  experimental_ThreadActionsContextMenu as ThreadActionsContextMenu,
  experimental_THREAD_ACTION_GROUPS,
  type PluginSidebarSection,
  type PluginThreadActionsInlineItem,
} from "@get-bb/plugin-sdk/app";
import { createPortal } from "react-dom";
import { runThreadAction, threadActionTarget, type RadarThreadActions } from "./threadActions";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { isLiveThread } from "./time";
import {
  formatReasoningLevel,
  useModelDisplayName,
  useThreadExecution,
} from "./useThreadExecution";
import { RadarHoverCard, type ContextUsage } from "./RadarHoverCard";
import { useRowSwipe } from "./useRowSwipe";
import { useRowViewport } from "./useRowViewport";
import {
  swipeActionView,
  type SwipeActionId,
  type SwipeActionView,
} from "@/lib/swipe";

/** Family folding for threads with shown children (null for leaves). */
export interface RowCollapse {
  collapsed: boolean;
  hiddenTotal: number;
  hiddenUnread: number;
  hiddenLive: boolean;
  hiddenNeedsUser: boolean;
  hiddenFailed: boolean;
  hiddenKids: { id: string; title: string; dot: string | null }[];
  onToggle: () => void;
}

/** Loudest hidden state first: failed, needs-you, then live. */
function hiddenRollupDotClass(collapse: RowCollapse): string | null {
  if (collapse.hiddenFailed) return "radar-dot-error";
  if (collapse.hiddenNeedsUser) return "radar-dot-attention";
  if (collapse.hiddenLive) return "radar-dot-running radar-dot-pulse";
  return null;
}

function foldedKidsText(collapse: RowCollapse): string {
  const names = collapse.hiddenKids.map((kid) => kid.title).join(", ");
  const overflow = collapse.hiddenTotal - collapse.hiddenKids.length;
  return `Hidden replies: ${names}${overflow > 0 ? `, +${overflow} more` : ""}`;
}

function hiddenSummary(collapse: RowCollapse): string {
  const parts = [
    `${collapse.hiddenTotal} hidden`,
    collapse.hiddenUnread > 0 ? `${collapse.hiddenUnread} unread` : null,
  ].filter((part): part is string => !!part);
  return parts.join(", ");
}

/** Minimal provider record for the agent icon (extra fields ignored). */
export interface RowProviderIcon {
  id: string;
  logoUrl?: string | null;
  icon?: { glyph: string } | string | null;
}

/**
 * Map the host-resolved indicator to a status visual. Unknown → none.
 * Working (runtime) is a spinner; background activity pulses; finished but
 * unseen is a small static muted dot — never the same as working.
 */
type StatusVisual =
  | { kind: "spinner" }
  | { kind: "dot"; className: string }
  | { kind: "icon"; name: string; className: string }
  | null;

function statusVisualFor(indicator: string): StatusVisual {
  switch (indicator) {
    case "runtime":
      return { kind: "spinner" };
    case "background-agent":
      return {
        kind: "icon",
        name: "Bot",
        className: "radar-tone-success radar-icon-pulse",
      };
    case "background-command":
      return {
        kind: "icon",
        name: "Terminal",
        className: "radar-tone-success radar-icon-pulse",
      };
    case "workflow":
      return {
        kind: "icon",
        name: "Workflow",
        className: "radar-tone-success radar-icon-pulse",
      };
    case "goal":
      return {
        kind: "icon",
        name: "Target",
        className: "radar-tone-success radar-icon-pulse",
      };
    case "plan-mode":
      return {
        kind: "icon",
        name: "ListTodo",
        className: "radar-tone-success radar-icon-pulse",
      };
    case "working-draft":
      return { kind: "dot", className: "radar-dot-running radar-dot-pulse" };
    case "waiting-for-input":
    case "queued-waiting":
      return { kind: "dot", className: "radar-dot-attention" };
    case "unread-error":
    case "queued-failed":
      return { kind: "icon", name: "CircleX", className: "radar-tone-error" };
    case "unread-success":
      return { kind: "icon", name: "CircleCheck", className: "radar-tone-success" };
    case "draft":
    case "none":
    default:
      return null;
  }
}

/** Human label for a pull request: attention first, then bare state. */
function prLabel(state: string, attention: string): string {
  switch (attention) {
    case "ready_to_merge":
      return "Ready to merge";
    case "changes_requested":
      return "Changes requested";
    case "checks_failed":
      return "Checks failed";
    case "checks_pending":
      return "Checks pending";
    case "conflicts":
      return "Conflicts";
    case "blocked":
      return "Blocked";
    case "review_requested":
      return "Review requested";
    case "merged":
      return "Merged";
    case "draft":
      return "Draft";
    case "closed":
      return "Closed";
    case "none":
    default:
      break;
  }
  switch (state) {
    case "open":
      return "Open";
    case "draft":
      return "Draft";
    case "merged":
      return "Merged";
    case "closed":
      return "Closed";
    default:
      return state;
  }
}

function prToneClass(attention: string): string {
  switch (attention) {
    case "checks_failed":
    case "conflicts":
      return "radar-tone-error";
    case "changes_requested":
    case "blocked":
      return "radar-tone-warning";
    case "review_requested":
    case "checks_pending":
      return "radar-tone-info";
    case "ready_to_merge":
    case "merged":
      return "radar-tone-success";
    default:
      return "radar-tone-muted";
  }
}

function prBadgeClass(state: string, attention: string): string {
  if (state === "merged" || attention === "merged") return "radar-pr-merged";
  if (state === "closed" || attention === "closed") return "radar-pr-closed";
  if (state === "draft" || attention === "draft") return "radar-pr-draft";
  return "radar-pr-open";
}

function prIconName(state: string, attention: string): string {
  if (state === "merged" || attention === "merged") return "GitMerge";
  if (state === "closed" || attention === "closed") return "GitPullRequestClosed";
  if (state === "draft" || attention === "draft") return "GitPullRequestDraft";
  return "GitPullRequest";
}

/** Tiny explicit word for the status slot. Unknown indicators get none. */
function statusWordFor(
  indicator: string,
): { text: string; tone: string } | null {
  switch (indicator) {
    case "runtime":
    case "working-draft":
      return { text: "Working", tone: "radar-tone-success" };
    case "background-agent":
      return { text: "Agent", tone: "radar-tone-success" };
    case "background-command":
      return { text: "Command", tone: "radar-tone-success" };
    case "workflow":
      return { text: "Workflow", tone: "radar-tone-success" };
    case "goal":
      return { text: "Goal", tone: "radar-tone-success" };
    case "plan-mode":
      return { text: "Plan", tone: "radar-tone-success" };
    case "waiting-for-input":
      return { text: "Needs you", tone: "radar-tone-warning" };
    case "queued-waiting":
      return { text: "Queued", tone: "radar-tone-warning" };
    case "unread-error":
    case "queued-failed":
      return { text: "Failed", tone: "radar-tone-error" };
    case "unread-success":
      return { text: "Done", tone: "radar-tone-success" };
    default:
      return null;
  }
}

/** Stable hue per project id, so chips keep identity across renames. */
export function projectHue(projectId: string): number {
  let hash = 0;
  for (let i = 0; i < projectId.length; i += 1) {
    hash = (hash * 31 + projectId.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % 360;
}

let hoverCapable: boolean | null = null;

/** Hover previews need a real hover-capable pointer (never touch). */
function canHoverPreview(): boolean {
  if (hoverCapable === null) {
    hoverCapable =
      typeof window !== "undefined" &&
      window.matchMedia("(hover: hover)").matches;
  }
  return hoverCapable;
}

function rowStatusToneClass(tone: string | undefined): string {
  switch (tone) {
    case "running":
      return "radar-tone-running";
    case "success":
      return "radar-tone-success";
    case "error":
      return "radar-tone-error";
    default:
      return "radar-tone-muted";
  }
}

function RadarThreadRowImpl({
  thread,
  depth,
  isLastChild,
  projectName,
  sectionName,
  sectionId,
  celebrate,
  allowHoverCard = true,
  adaptiveCollapse = true,
  isActive,
  isEditing,
  isVisible = true,
  actions,
  timeText,
  onNavigate,
  sections,
  onMarkFamilyRead,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onUnarchive,
  providerName,
  providerIcon,
  projectTag,
  projectColorHue,
  collapse,
  primaryHostId,
  sdk,
  modelEpoch,
  density = "comfortable",
  isSelected = false,
  selectionActive = false,
  selectedIds,
  isKeyboardFocused = false,
  onToggleSelect,
  dragHandle,
  swipeRight = "none",
  swipeLeft = "none",
  listFiltersArchived = true,
  hasChildren = false,
  isShortcutTarget,
}: {
  thread: PluginSidebarThread;
  depth: number;
  isLastChild: boolean;
  projectName: string;
  sectionName: string | null;
  sectionId: string | null;
  celebrate: boolean;
  /** Plugin settings: gate the peek card and the quiet-row fold. */
  allowHoverCard?: boolean;
  adaptiveCollapse?: boolean;
  isActive: boolean;
  isEditing: boolean;
  /** False inside a folded group or ancestor; suspend requests and gestures. */
  isVisible?: boolean;
  actions: RadarThreadActions;
  /** Relative activity time, e.g. "5m ago". A string rather than the clock,
   * so the minute tick re-renders only rows whose label actually moved. */
  timeText: string;
  onNavigate: () => void;
  sections: readonly PluginSidebarSection[];
  onMarkFamilyRead: (thread: PluginSidebarThread) => Promise<void>;
  onStartRename: (thread: PluginSidebarThread) => void;
  onCommitRename: (thread: PluginSidebarThread, title: string) => void;
  onCancelRename: () => void;
  onUnarchive: (thread: PluginSidebarThread) => void;
  providerName: string;
  providerIcon: RowProviderIcon | null;
  /** Project chip text, or null when redundant with the group header. */
  projectTag: string | null;
  /** Optional custom hue for the project chip (overrides default stable hash). */
  projectColorHue?: number | null;
  collapse: RowCollapse | null;
  primaryHostId: string | null;
  sdk: PluginBrowserBbSdk;
  modelEpoch: number;
  density?: "comfortable" | "compact";
  isSelected?: boolean;
  selectionActive?: boolean;
  selectedIds?: Set<string>;
  isKeyboardFocused?: boolean;
  onToggleSelect?: (event: React.MouseEvent, threadId: string) => void;
  /** Grip affordance for drag-to-section (section grouping only). */
  dragHandle?: import("./RadarThreadList").RowDragHandle | null;
  /** Touch swipe actions per direction; "none" leaves that side inert. */
  swipeRight?: SwipeActionId;
  swipeLeft?: SwipeActionId;
  /** False on the All tab, where archiving leaves the row in place. */
  listFiltersArchived?: boolean;
  /** Whether the thread has any replies, shown or filtered out: archiving it
   *  then asks the host to confirm. */
  hasChildren?: boolean;
  /**
   * False while a folded family or group hides the row. bb numbers jump
   * shortcuts over every marked row in DOM order, and a closing fold keeps
   * its rows mounted until its animation ends.
   */
  isShortcutTarget: boolean;
}) {
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const activateMore = useRef<(() => void) | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [moreEnabled, setMoreEnabled] = useState(false);
  const requestedMore = useRef(false);
  const [renameValue, setRenameValue] = useState("");
  const [copiedBranch, setCopiedBranch] = useState(false);
  const copiedTimer = useRef<number | null>(null);
  const cancelledRef = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const touchPointer = useRef(false);
  const [rowElement, setRowElement] = useState<HTMLDivElement | null>(null);
  const hoverTimer = useRef<number | null>(null);
  const hoverCardTimer = useRef<number | null>(null);
  const isHoveringCard = useRef(false);
  const [hoverCard, setHoverCard] = useState<{
    anchor: { top: number; bottom: number; left: number; right: number };
  } | null>(null);

  const viewport = useRowViewport(rowRef,
    isEditing || isKeyboardFocused || menuOpen || hoverCard !== null || !!dragHandle?.isDragging ||
      rowRef.current?.hasAttribute("data-swipe-phase") === true,
    JSON.stringify([density, adaptiveCollapse, thread.isUnread, thread.indicator, collapse?.collapsed,
      thread.displayTitle, thread.environment?.branchName, depth, sectionName, projectTag]),
    setRowElement,
  );

  const { hasUnsubmittedDraft } = useSidebarThreadDraft(thread.id);
  const rowStatus = useSidebarThreadRowStatus(thread.id);
  const shortcut = useSidebarThreadShortcut(thread.id);
  const { pullRequest } = experimental_useSidebarThreadPullRequest(thread.id);
  const navigate = useBbNavigate();
  const { splitProps, layout: splitLayout } =
    experimental_useSidebarThreadSplit(thread.id);

  const actionTarget = threadActionTarget(thread);
  const requestRename = () => onStartRename(thread);
  const registeredActions = experimental_useThreadActions(actionTarget, { requestRename,
    keys: viewport.renderContents ? undefined : ["bb--core/archive", "bb--core/delete"],
  });
  useLayoutEffect(() => actions.register(thread.id, registeredActions), [actions, thread.id, registeredActions]);
  const inlineActions = useMemo<PluginThreadActionsInlineItem[]>(() => [
    ...(hasChildren || thread.parentThreadId ? [{
      key: "radar-sidebar/family-read", group: experimental_THREAD_ACTION_GROUPS.organize,
      action: { label: "Mark family read", icon: "MailOpen", run: () => onMarkFamilyRead(thread) },
    } satisfies PluginThreadActionsInlineItem] : []),
    ...(registeredActions.some(entry => entry.key === "thread-list/move") ? [] : [{
      key: "radar-sidebar/move", group: experimental_THREAD_ACTION_GROUPS.organize,
      action: { label: "Move to section", icon: "Folder", choices: { heading: "Move to section", items: [
        ...sections.map(section => ({ id: section.id, label: section.name, selected: section.id === thread.sectionId })),
        { id: "none", label: "No section", selected: thread.sectionId === null },
      ] }, run: async ({ value }) => { if (value) await sdk.threads.update({ threadId: thread.id, sectionId: value === "none" ? null : value }); } },
    } satisfies PluginThreadActionsInlineItem]),
  ], [hasChildren, thread, sections, sdk, registeredActions, onMarkFamilyRead]);

  useLayoutEffect(() => {
    if (!moreEnabled || !requestedMore.current) return;
    requestedMore.current = false;
    activateMore.current?.();
  }, [moreEnabled]);

  const fetchThreadContext = useCallback(
    async (targetThreadId: string): Promise<ContextUsage | null> => {
      try {
        const res = await sdk.threads.context({ threadId: targetThreadId });
        const usage = res?.usage;
        if (!usage) return null;
        return {
          usedTokens: usage.usedTokens,
          modelContextWindow: usage.modelContextWindow,
          estimated: usage.estimated,
          autoCompactAtTokens: usage.snapshot?.autoCompactAtTokens ?? null,
          categories:
            usage.snapshot?.categories.map((category) => ({
              id: category.id,
              label: category.label,
              kind: category.kind,
              tokens: category.tokens,
              entries: category.entries.map((entry) => ({
                id: entry.id,
                label: entry.label,
                tokens: entry.tokens,
              })),
            })) ?? [],
        };
      } catch {
        // A thread that never ran a turn has no usage: the card shows that.
        return null;
      }
    },
    [sdk],
  );

  const closeHoverCard = useCallback((force = false) => {
    if (hoverTimer.current !== null) {
      clearTimeout(hoverTimer.current);
      hoverTimer.current = null;
    }
    if (hoverCardTimer.current !== null) {
      clearTimeout(hoverCardTimer.current);
      hoverCardTimer.current = null;
    }
    if (force) {
      setHoverCard(null);
      return;
    }
    hoverCardTimer.current = window.setTimeout(() => {
      if (!isHoveringCard.current) {
        setHoverCard(null);
      }
    }, 220);
  }, []);

  useEffect(() => {
    return () => {
      if (copiedTimer.current !== null) {
        clearTimeout(copiedTimer.current);
        copiedTimer.current = null;
      }
      if (hoverTimer.current !== null) {
        clearTimeout(hoverTimer.current);
        hoverTimer.current = null;
      }
      if (hoverCardTimer.current !== null) {
        clearTimeout(hoverCardTimer.current);
        hoverCardTimer.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!isVisible) closeHoverCard(true);
  }, [isVisible, closeHoverCard]);

  const hoverOpen = hoverCard !== null;
  useEffect(() => {
    if (!hoverOpen) return;
    const close = () => {
      if (!isHoveringCard.current) {
        setHoverCard(null);
      }
    };
    document.addEventListener("scroll", close, true);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("scroll", close, true);
      window.removeEventListener("blur", close);
    };
  }, [hoverOpen]);

  const scheduleHoverCard = () => {
    if (!allowHoverCard || !isVisible) return;
    if (!canHoverPreview()) return;
    if (hoverTimer.current !== null || hoverCard) return;
    hoverTimer.current = window.setTimeout(() => {
      hoverTimer.current = null;
      const rect = rowRef.current?.getBoundingClientRect();
      if (!rect) return;
      // The card places and clamps itself once it knows its own size.
      setHoverCard({
        anchor: {
          top: rect.top,
          bottom: rect.bottom,
          left: rect.left,
          right: rect.right,
        },
      });
    }, 380);
  };

  // Seed the input when editing starts only: an auto-generated title arriving
  // mid-edit must not overwrite what the user is typing.
  const titleRef = useRef(thread.title);
  titleRef.current = thread.title;
  useEffect(() => {
    if (isEditing) {
      cancelledRef.current = false;
      setRenameValue(titleRef.current ?? "");
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [isEditing]);

  const swipeState = {
    isUnread: thread.isUnread,
    isPinned: thread.isPinned,
    isArchived: thread.isArchived,
  };
  const rightSwipe = swipeActionView(
    swipeRight,
    swipeState,
    listFiltersArchived,
    hasChildren,
  );
  const leftSwipe = swipeActionView(
    swipeLeft,
    swipeState,
    listFiltersArchived,
    hasChildren,
  );
  const togglePin = () => {
    actions.setPinned(thread.id, !thread.isPinned).catch(() => {
      toast.error("Couldn’t update pin");
    });
  };
  const toggleArchive = () => {
    if (thread.isArchived) onUnarchive(thread);
    else runThreadAction(registeredActions, "bb--core/archive");
  };
  const openInSplit = () => {
    actions.open(thread.id, { split: true });
    onNavigate();
  };
  const runSwipeAction = (action: SwipeActionView) => {
    closeHoverCard(true);
    switch (action.id) {
      case "read":
        actions.setRead(thread.id, thread.isUnread).catch(() => {
          toast.error("Couldn’t update read state");
        });
        break;
      case "pin":
        togglePin();
        break;
      case "archive":
        toggleArchive();
        break;
      case "split":
        openInSplit();
        break;
      case "rename":
        onStartRename(thread);
        break;
      case "menu":
        activateMore.current?.();
        break;
      case "delete":
        runThreadAction(registeredActions, "bb--core/delete");
        break;
    }
  };
  const swipeReveal = useRowSwipe({
    rowRef,
    rowElement,
    enabled: isVisible && viewport.renderContents && !isEditing && !selectionActive && !!(rightSwipe || leftSwipe),
    right: rightSwipe,
    left: leftSwipe,
    restoreKey: `${thread.isArchived}`,
    onStart: () => { setMoreEnabled(true); closeHoverCard(true); },
    onCommit: runSwipeAction,
  });

  const visual: StatusVisual = statusVisualFor(thread.indicator);
  // Action states get the full wash+bar+pulse treatment whether read or not:
  // they stay loud until resolved. Plain unread (FYI-done) keeps the green
  // wash only while unseen.
  const needsUser = thread.indicator === "waiting-for-input";
  const failed =
    thread.indicator === "unread-error" ||
    thread.indicator === "queued-failed";
  // Motion is reserved for rows that need action — FYI-done stays static.
  const actionPulseClass =
    thread.indicator === "waiting-for-input" ||
    thread.indicator === "queued-waiting"
      ? "radar-row-pulse-amber"
      : thread.indicator === "unread-error" ||
          thread.indicator === "queued-failed"
        ? "radar-row-pulse-red"
        : null;
  const foldedSummary =
    collapse?.collapsed && collapse.hiddenTotal > 0
      ? foldedKidsText(collapse)
      : null;
  const rowLabel = [
    thread.displayTitle,
    thread.indicatorLabel ?? null,
    thread.isPinned ? "pinned" : null,
    foldedSummary,
  ]
    .filter((part): part is string => !!part)
    .join(" — ");
  const statusWord = statusWordFor(thread.indicator);
  const prNeedsAttention =
    !!pullRequest &&
    !["none", "merged", "closed", "draft"].includes(pullRequest.attention);
  // Quiet rows collapse to title + time; anything worth a glance keeps the
  // full row. Unknown indicators default to full (never hide the unknown).
  const collapsed =
    adaptiveCollapse &&
    !isEditing &&
    !thread.isUnread &&
    thread.indicator === "none" &&
    !hasUnsubmittedDraft &&
    !rowStatus &&
    !prNeedsAttention;

  // Model + thinking only while the thread is in flight. The options
  // endpoint resolves *defaults*, so it reports a model for any thread at
  // all; showing it on an idle one reads as fabricated.
  const showExecution = isLiveThread(thread);
  const execution = useThreadExecution(
    thread.id,
    sdk,
    modelEpoch,
    showExecution,
    thread.latestAttentionAt,
    isVisible && viewport.renderContents,
  );
  const modelName = useModelDisplayName(
    thread.providerId,
    execution?.model ?? null,
    sdk,
    isVisible && viewport.renderContents,
  );

  const handleNavigate = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || selectionActive) {
      event.preventDefault();
      event.stopPropagation();
      onToggleSelect?.(event, thread.id);
      return;
    }
    onNavigate();
  };

  const handlePointerDown = (event: React.PointerEvent<HTMLAnchorElement>) => {
    touchPointer.current = event.pointerType === "touch";
    splitProps.onPointerDown?.(event);
  };
  const handleMouseDown = (event: React.MouseEvent<HTMLElement>) => {
    // A touch tap emits compatibility mouse events after touchend. Native
    // focus in between can scroll the drawer or replace a deferred link,
    // leaving mouseup/click on its container. Keep the tap's target in place;
    // mouse and keyboard focus retain their normal behavior.
    if (touchPointer.current && event.button === 0) event.preventDefault();
  };

  if (!viewport.renderContents) {
    return <div ref={viewport.ref}
      className={cn("radar-row radar-row-placeholder", density === "compact" && "radar-row-compact",
        depth === 0 && "radar-row-root", depth === 1 && "radar-row-child", depth > 1 && "radar-row-deep",
        depth > 0 && isLastChild && "radar-row-last", isActive && "radar-row-active", isSelected && "radar-row-selected")}
      data-has-branch={depth === 0 && !!thread.environment?.branchName || undefined}
      style={viewport.height === undefined ? undefined : { height: viewport.height }}
      onFocusCapture={viewport.onFocusCapture} onBlurCapture={viewport.onBlurCapture}>
      <a href={thread.href} data-sidebar-thread-id={thread.id}
        data-sidebar-thread-shortcut-target={isShortcutTarget ? "" : undefined}
        aria-label={rowLabel} aria-current={isActive ? "true" : undefined}
        aria-keyshortcuts={shortcut?.ariaKeyshortcuts} {...splitProps}
        onPointerDown={handlePointerDown} onMouseDown={handleMouseDown}
        className="radar-row-main" onClick={handleNavigate}>
      </a>
    </div>;
  }

  const branch = thread.environment?.branchName ?? null;
  const hostName = thread.host?.name ?? null;
  const hasBranchLine = depth === 0 && !!branch;
  // The home host is noise on the row (it stays in the tooltip); branches
  // and away-from-home hosts are always shown.
  const showHost =
    hostName && (!primaryHostId || thread.host?.id !== primaryHostId);
  // Branches live on their own third line; line two keeps everything else.
  const where = showHost ? hostName : null;
  // The project lives on the title line as a chip; time does too so
  // neither truncates away. Children inherit context: model • thinking.
  const contextSegments: ReactNode[] =
    depth === 0
      ? [
          ...(sectionName && sectionId
            ? [
                <span
                  key="section"
                  className="radar-section-chip"
                  style={{ "--radar-section-hue": projectHue(`section:${sectionId}`) } as CSSProperties}
                  title={sectionName}
                >
                  {sectionName}
                </span>,
              ]
            : []),
          ...(where ? [<span key="where">{where}</span>] : []),
        ]
      : [];
  // The provider icon identifies the provider, so its name isn't echoed in
  // the subtitle — except when no icon is available, or in the tooltip.
  const needsProviderText = !providerIcon;
  const thinking =
    execution && execution.reasoningLevel !== "none"
      ? formatReasoningLevel(execution.reasoningLevel)
      : null;
  const fullSubtitle = [
    providerName,
    execution ? modelName : null,
    thinking ? `Thinking: ${thinking}` : null,
    sectionName,
    projectName,
    branch,
    hostName,
    timeText,
  ]
    .filter((part): part is string => !!part)
    .join(" • ");
  const subtitleSegments: ReactNode[] = [];
  if (needsProviderText && execution) {
    subtitleSegments.push(<span key="provider">{providerName}</span>);
  }
  if (execution && showExecution) {
    subtitleSegments.push(
      <span key="model">
        <span className="radar-model-chip" title={modelName ?? undefined}>
          <Icon name="Bot" aria-hidden="true" />
          {modelName}
        </span>{" "}
        {thinking ? (
          <span
            className="radar-model-chip radar-thinking-chip"
            title={`Thinking: ${thinking}`}
          >
            <Icon name="Brain" aria-hidden="true" />
            {thinking}
          </span>
        ) : null}
      </span>,
    );
  }
  subtitleSegments.push(...contextSegments);
  const subtitleNode = (
    <span className="radar-row-subtitle" title={fullSubtitle}>
      {showExecution && execution === undefined ? (
        <>
          {needsProviderText ? <>{providerName} • </> : null}
          <span className="radar-model-loading" aria-hidden="true" />
          {contextSegments.length > 0 ? (
            <>
              {" • "}
              {contextSegments.map((segment, index) => (
                // eslint-disable-next-line react/no-array-index-key
                <span key={index}>
                  {index > 0 ? " • " : null}
                  {segment}
                </span>
              ))}
            </>
          ) : null}
        </>
      ) : (
        subtitleSegments.map((segment, index) => (
          // eslint-disable-next-line react/no-array-index-key
          <span key={index}>
            {index > 0 ? " • " : null}
            {segment}
          </span>
        ))
      )}
    </span>
  );
  const timeNode = (
    <span className="radar-row-time" title={timeText}>{timeText}</span>
  );
  const isWorktree = thread.environment?.isWorktree === true;
  const handleCopyBranch = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!branch) return;
    void navigator.clipboard.writeText(branch).then(() => {
      setCopiedBranch(true);
      toast.success(`Copied branch: ${branch}`);
      copiedTimer.current = window.setTimeout(
        () => setCopiedBranch(false),
        1600,
      );
    }).catch(() => {
      toast.error("Could not copy branch");
    });
  };

  const branchNode = hasBranchLine ? (
    <span
      className="radar-branch-line"
      title={
        branch && isWorktree ? `${branch} (worktree)` : (branch ?? undefined)
      }
    >
      <button
        type="button"
        tabIndex={-1}
        className={cn(
          "radar-branch-btn",
          copiedBranch && "radar-branch-copied",
        )}
        title={copiedBranch ? "Copied branch to clipboard!" : `Click to copy branch: ${branch}`}
        aria-label={`Copy branch name ${branch}`}
        onClick={handleCopyBranch}
      >
        <Icon
          name={copiedBranch ? "Check" : (isWorktree ? "FolderGit" : "GitBranch")}
          aria-hidden="true"
          className={cn(copiedBranch && "radar-tone-success")}
        />
        <span className="radar-branch-text">{branch}</span>
        {copiedBranch ? (
          <span className="radar-branch-copied-badge">Copied</span>
        ) : null}
      </button>
      {pullRequest ? (
        <button
          type="button"
          tabIndex={-1}
          className={cn(
            "radar-pr-link",
            prBadgeClass(pullRequest.state, pullRequest.attention),
            prToneClass(pullRequest.attention),
          )}
          title={`${pullRequest.title} — open PR #${pullRequest.number} (${prLabel(pullRequest.state, pullRequest.attention)})`}
          aria-label={`Open pull request ${pullRequest.number}: ${pullRequest.title}`}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            navigate.openUrl(pullRequest.url);
          }}
        >
          <Icon name={prIconName(pullRequest.state, pullRequest.attention)} aria-hidden="true" />
          <span>
            #{pullRequest.number} ·{" "}
            {prLabel(pullRequest.state, pullRequest.attention)}
          </span>
        </button>
      ) : null}
    </span>
  ) : null;
  const leadNode = (
    <span
      className="radar-row-lead"
      aria-hidden={selectionActive || isSelected ? undefined : true}
      title={providerIcon ? providerName : undefined}
    >
      {selectionActive || isSelected ? (
        <button
          type="button"
          tabIndex={-1}
          aria-label={isSelected ? "Deselect thread" : "Select thread"}
          className={cn(
            "radar-select-checkbox",
            isSelected && "radar-select-checkbox-checked",
          )}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onToggleSelect?.(event, thread.id);
          }}
        >
          <Icon name={isSelected ? "Check" : "Circle"} aria-hidden="true" />
        </button>
      ) : providerIcon ? (
        <span className="radar-provider-icon">
          <ProviderIcon providerKind="agent" provider={providerIcon} />
        </span>
      ) : null}
    </span>
  );
  const gutterNode = (
    <span
      className="radar-tree-gutter"
      onClick={collapse ? () => collapse.onToggle() : undefined}
      aria-hidden={collapse || dragHandle ? undefined : true}
    >
      {dragHandle ? (
        <button
          type="button"
          className="radar-row-grip"
          aria-label="Drag onto a section header to file this thread"
          title="Drag onto a section header to file this thread"
          onClick={(event) => event.preventDefault()}
          {...dragHandle.attributes}
          {...dragHandle.listeners}
        >
          <Icon name="DragDropVertical" aria-hidden="true" />
        </button>
      ) : collapse ? (
        <button
          type="button"
          className="radar-tree-toggle"
          aria-expanded={!collapse.collapsed}
          aria-label={collapse.collapsed ? "Expand replies" : "Collapse replies"}
          title={collapse.collapsed ? "Expand replies" : "Collapse replies"}
        >
          <Icon
            name={collapse.collapsed ? "ChevronRight" : "ChevronDown"}
            aria-hidden="true"
          />
        </button>
      ) : null}
    </span>
  );
  const familyFolded = !!collapse?.collapsed && collapse.hiddenTotal > 0;
  const faceKids = collapse?.hiddenKids.slice(0, 3) ?? [];
  const faceRemainder =
    (collapse?.hiddenTotal ?? 0) - faceKids.length;
  const kidsNode = collapse && familyFolded ? (
    <span className="radar-kids-line" title={foldedKidsText(collapse)}>
      <span className="radar-face-stack" aria-hidden="true">
        {faceKids.map((kid) => (
          <span key={kid.id} className="radar-face">
            <Icon name="UserRound" aria-hidden="true" />
          </span>
        ))}
      </span>
      {faceRemainder > 0 ? (
        <span className="radar-kids-count">+{faceRemainder}</span>
      ) : null}
    </span>
  ) : null;
  // A folded family always shows its summary, even on quiet rows.
  const extraHidden = collapsed && !kidsNode;
  const statusBadge = visual || statusWord ? (
    <span
      className={cn(
        "radar-row-status-badge",
        celebrate && "radar-celebrate",
      )}
      title={thread.indicatorLabel ?? undefined}
    >
      {visual?.kind === "spinner" ? (
        <span key="spinner" className="radar-spinner radar-tone-success">
          <Icon name="Loading" aria-hidden="true" />
        </span>
      ) : visual?.kind === "icon" ? (
        <span
          key={visual.name}
          className={cn("radar-status-icon", visual.className)}
        >
          <Icon name={visual.name} aria-hidden="true" />
        </span>
      ) : visual ? (
        <span key="dot" className={cn("radar-dot", visual.className)} />
      ) : null}
      {statusWord ? (
        <span
          key={statusWord.text}
          className={cn("radar-status-word", statusWord.tone)}
        >
          {statusWord.text}
        </span>
      ) : null}
    </span>
  ) : null;

  const commit = () => {
    if (cancelledRef.current) return;
    onCommitRename(thread, renameValue);
  };

  if (isEditing) {
    return (
      <div ref={viewport.ref} onFocusCapture={viewport.onFocusCapture} onBlurCapture={viewport.onBlurCapture}
        className={cn("radar-row", isActive && "radar-row-active")}>
        {gutterNode}
        <div className="radar-row-main">
          {leadNode}
          <span className="radar-row-text">
            <input
              ref={inputRef}
              value={renameValue}
              onChange={(event) => setRenameValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commit();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  cancelledRef.current = true;
                  onCancelRename();
                }
              }}
              onBlur={commit}
              aria-label="Rename thread"
              placeholder={thread.displayTitle}
              maxLength={200}
              className="radar-rename"
            />
            {subtitleNode}
            {branchNode}
          </span>
        </div>
      </div>
    );
  }

  return (
    <ThreadActionsContextMenu thread={actionTarget} inline={inlineActions} requestRename={requestRename}
      disabled={!isVisible || selectionActive} dragging={dragHandle?.isDragging ?? false}
      onOpenChange={open => { setMenuOpen(open); if (open) closeHoverCard(true); }}>
    <div
      className={cn(
        "radar-row",
        isActive && "radar-row-active",
        isKeyboardFocused && "radar-row-keyboard-focused",
        isSelected && "radar-row-selected",
        density === "compact" && "radar-row-compact",
        depth === 0 && "radar-row-root",
        depth === 1 && "radar-row-child",
        depth > 1 && "radar-row-deep",
        depth > 0 && isLastChild && "radar-row-last",
        collapse && "radar-row-parent",
        splitLayout && "radar-row-split",
        thread.isUnread && !needsUser && !failed && "radar-row-unread",
        needsUser && "radar-row-needs-user",
        failed && "radar-row-failed",
        actionPulseClass,
        collapsed && "radar-row-collapsed",
      )}
      ref={viewport.ref}
      onFocusCapture={() => { setMoreEnabled(true); viewport.onFocusCapture(); }}
      onBlurCapture={viewport.onBlurCapture}
      draggable={!isEditing}
      onDragStart={(event) => {
        if (isEditing) return;
        closeHoverCard(true);
        const idsToDrag =
          isSelected && selectedIds && selectedIds.size > 0
            ? Array.from(selectedIds)
            : [thread.id];
        event.dataTransfer.setData(
          "application/json",
          JSON.stringify({
            type: "bb-thread-drag",
            threadIds: idsToDrag,
            title: thread.displayTitle,
          }),
        );
        event.dataTransfer.setData("text/plain", thread.id);
        event.dataTransfer.effectAllowed = "move";
      }}
      onPointerEnter={(event) => {
        // iOS sends compatibility hover events before click and can consume
        // the tap if they reveal or replace content. Only a mouse prepares
        // the hover actions; touch opens the existing More trigger directly.
        if (event.pointerType !== "mouse") return;
        event.currentTarget.dataset.radarHover = "mouse";
        setMoreEnabled(true);
        scheduleHoverCard();
      }}
      onPointerLeave={(event) => {
        if (event.pointerType !== "mouse") return;
        delete event.currentTarget.dataset.radarHover;
        closeHoverCard(false);
      }}
    >
      {swipeReveal?.action ? (
        <span
          className={cn(
            "radar-swipe-underlay",
            `radar-swipe-${swipeReveal.action.id}`,
          )}
          data-side={swipeReveal.side}
          aria-hidden="true"
        >
          <span className="radar-swipe-content">
            <Icon name={swipeReveal.action.icon} aria-hidden="true" />
            <span className="radar-swipe-label">{swipeReveal.action.label}</span>
          </span>
        </span>
      ) : null}
      {gutterNode}
      <a
        href={thread.href}
        data-sidebar-thread-shortcut-target={isShortcutTarget ? "" : undefined}
        data-sidebar-thread-id={thread.id}
        aria-label={rowLabel}
        aria-current={isActive ? "true" : undefined}
        aria-keyshortcuts={shortcut?.ariaKeyshortcuts}
        title={thread.displayTitle}
        {...splitProps}
        onPointerDown={handlePointerDown}
        onMouseDown={handleMouseDown}
        onClick={handleNavigate}
        onDoubleClick={(event) => {
          // Double-click the title area renames instead of navigating.
          event.preventDefault();
          onStartRename(thread);
        }}
        className="radar-row-main"
      >
        {leadNode}
        <span className="radar-row-text">
          <span className="radar-row-title">
            <span className="radar-row-title-text">
              {depth > 0 ? (
                <Icon
                  name="UserRound"
                  aria-hidden="true"
                  className="radar-child-glyph"
                />
              ) : null}
              {thread.isPinned ? (
                <span
                  className="radar-pin-marker"
                  title="Pinned"
                  role="img"
                  aria-label="Pinned"
                >
                  <Icon name="Pin" aria-hidden="true" />
                </span>
              ) : null}
              <span className="radar-thread-title">
                <ThreadTitle threadId={thread.id} />
              </span>
            </span>
            {(() => {
              if (!collapse?.collapsed || collapse.hiddenTotal === 0) {
                return null;
              }
              const dot = hiddenRollupDotClass(collapse);
              if (collapse.hiddenUnread === 0 && !dot) return null;
              return (
                <span
                  className={cn(
                    "radar-kids-pill",
                    collapse.hiddenUnread > 0 && "radar-kids-pill-unread",
                  )}
                  title={hiddenSummary(collapse)}
                  aria-label={hiddenSummary(collapse)}
                >
                  {collapse.hiddenUnread > 0 ? (
                    <>
                      <span className="radar-unread" aria-hidden="true" />
                      {collapse.hiddenUnread}
                    </>
                  ) : null}
                  {dot ? (
                    <span
                      className={cn("radar-dot", dot)}
                      aria-hidden="true"
                    />
                  ) : null}
                </span>
              );
            })()}
            <span className="radar-row-meta">
              {projectTag ? (
                <span
                  className="radar-row-project"
                  title={projectTag}
                  style={{
                    "--radar-project-hue":
                      projectColorHue ?? projectHue(thread.projectId),
                  } as CSSProperties}
                >
                  {projectTag}
                </span>
              ) : null}
              {timeNode}
            </span>
          </span>
          <span
            className={cn(
              "radar-row-extra",
              extraHidden && "radar-row-extra-collapsed",
            )}
            aria-hidden={extraHidden || undefined}
          >
            <span className="radar-row-extra-inner">
              {kidsNode ?? subtitleNode}
            </span>
          </span>
          {branchNode}
        </span>
        <span className="radar-row-badges">
          {statusBadge}
          {shortcut ? (
            <kbd className="radar-kbd">{shortcut.label}</kbd>
          ) : null}
          {rowStatus ? (
            <span
              className={cn("radar-badge-icon", rowStatusToneClass(rowStatus.tone))}
              title={rowStatus.label}
              role="img"
              aria-label={rowStatus.label}
            >
              <HostIcon name={rowStatus.icon} aria-hidden="true" />
            </span>
          ) : hasUnsubmittedDraft ? (
            <span
              className="radar-draft-pip"
              title="Unsent draft"
              role="img"
              aria-label="Unsent draft"
            />
          ) : null}
          {thread.isUnread ? (
            <span
              className="radar-unread"
              role="img"
              aria-label="Unread"
              title="Unread"
            />
          ) : null}
        </span>
      </a>
      <span className="radar-row-actions">
        <button
          type="button"
          tabIndex={-1}
          aria-label={thread.isPinned ? "Unpin thread" : "Pin thread"}
          aria-pressed={thread.isPinned}
          title={thread.isPinned ? "Unpin" : "Pin"}
          className={cn(
            "radar-action",
            thread.isPinned && "radar-action-active",
          )}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            togglePin();
          }}
        >
          <Icon name={thread.isPinned ? "PinOff" : "Pin"} aria-hidden="true" />
        </button>
        <button
          type="button"
          tabIndex={-1}
          aria-label="Rename thread"
          title="Rename"
          className="radar-action"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onStartRename(thread);
          }}
        >
          <Icon name="Edit" aria-hidden="true" />
        </button>
        {thread.isArchived ? (
          <button
            type="button"
            tabIndex={-1}
            aria-label="Unarchive thread"
            title="Unarchive"
            className="radar-action"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              toggleArchive();
            }}
          >
            <Icon name="ArchiveRestore" aria-hidden="true" />
          </button>
        ) : (
          <button
            type="button"
            tabIndex={-1}
            aria-label="Archive thread"
            title="Archive"
            className="radar-action"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              toggleArchive();
            }}
          >
            <Icon name="Archive" aria-hidden="true" />
          </button>
        )}
        {moreEnabled ? <ThreadActionsMenu thread={actionTarget} inline={inlineActions} requestRename={requestRename}
          side="right" align="start" sideOffset={8} onOpenChange={open => { setMenuOpen(open); if (open) closeHoverCard(true); }}
          trigger={props => {
            // Compact drawers supply a click handler; desktop menus supply
            // keyboard/pointer handlers. Use one activation so ArrowDown does
            // not leak into the list's navigation when opening a drawer.
            activateMore.current = () => {
              if (props.onClick) menuTriggerRef.current?.click();
              else menuTriggerRef.current?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
            };
            return <button {...props} type="button" tabIndex={-1} aria-label="More actions" title="More actions"
            ref={node => { menuTriggerRef.current = node; if (typeof props.ref === "function") props.ref(node); else if (props.ref) props.ref.current = node; }}
            className={cn(props.className, "radar-action radar-action-more")}
            onClick={event => { props.onClick?.(event); event.stopPropagation(); }}>
            <Icon name="MoreHorizontal" aria-hidden="true" />
          </button>;
          }} /> : <button type="button" tabIndex={-1} aria-label="More actions" title="More actions"
            aria-haspopup="menu" className="radar-action radar-action-more" ref={menuTriggerRef}
            onPointerDown={event => { touchPointer.current = event.pointerType === "touch"; }}
            onMouseDown={handleMouseDown}
            onClick={event => {
              event.preventDefault();
              event.stopPropagation();
              requestedMore.current = true;
              setMoreEnabled(true);
            }}>
            <Icon name="MoreHorizontal" aria-hidden="true" />
          </button>}
      </span>
      {hoverCard
        ? createPortal(
            <RadarHoverCard
              thread={thread}
              anchor={hoverCard.anchor}
              branch={branch}
              isWorktree={isWorktree}
              pullRequest={pullRequest}
              facts={{
                providerName,
                providerIcon,
                modelName,
                thinking,
                projectName,
                sectionName,
                hostName,
                timeText,
                statusWord: statusWord?.text ?? null,
                statusTone: statusWord?.tone ?? null,
                hiddenKids: collapse?.hiddenKids ?? [],
                hiddenTotal: collapse?.hiddenTotal ?? 0,
              }}
              onOpen={() => {
                actions.open(thread.id);
                onNavigate();
                setHoverCard(null);
              }}
              onOpenSplit={() => {
                openInSplit();
                setHoverCard(null);
              }}
              onTogglePin={togglePin}
              onArchive={toggleArchive}
              onMouseEnter={() => {
                isHoveringCard.current = true;
              }}
              onMouseLeave={() => {
                isHoveringCard.current = false;
                closeHoverCard(true);
              }}
              getContext={fetchThreadContext}
            />,
            document.body,
          )
        : null}
    </div>
    </ThreadActionsContextMenu>
  );
}

function sameCollapse(a: RowCollapse | null, b: RowCollapse | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  // `onToggle` is deliberately not compared: it only closes over the row's own
  // id and a stable toggler, so a fresh closure never changes behaviour.
  return (
    a.collapsed === b.collapsed &&
    a.hiddenTotal === b.hiddenTotal &&
    a.hiddenUnread === b.hiddenUnread &&
    a.hiddenLive === b.hiddenLive &&
    a.hiddenNeedsUser === b.hiddenNeedsUser &&
    a.hiddenFailed === b.hiddenFailed &&
    a.hiddenKids.length === b.hiddenKids.length &&
    a.hiddenKids.every((kid, index) => {
      const other = b.hiddenKids[index];
      return (
        kid.id === other.id && kid.title === other.title && kid.dot === other.dot
      );
    })
  );
}

type RowProps = React.ComponentProps<typeof RadarThreadRowImpl>;

/**
 * Rows re-render only when something they show changed. The list rebuilds the
 * `collapse` object every render, so it is compared by value; everything else
 * is compared by identity.
 */
export const RadarThreadRow = memo(RadarThreadRowImpl, (prev, next) => {
  const keys = new Set([
    ...Object.keys(prev),
    ...Object.keys(next),
  ]) as Set<keyof RowProps>;
  for (const key of keys) {
    if (key === "collapse") {
      if (!sameCollapse(prev.collapse, next.collapse)) return false;
    } else if (!Object.is(prev[key], next[key])) {
      return false;
    }
  }
  return true;
});

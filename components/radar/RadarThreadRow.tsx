import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  ThreadTitle,
  experimental_Icon as HostIcon,
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
import { effectiveIndicator, isHeldThread, isLiveThread } from "./time";
import { hiddenChanged } from "./hiddenThreads";
import {
  formatReasoningLevel,
  useModelDisplayName,
  useThreadExecution,
} from "./useThreadExecution";
import { RadarHoverCard, type ContextUsage } from "./RadarHoverCard";
import { useRowPullRequest } from "./pullRequests";
import { useRowSwipe } from "./useRowSwipe";
import { useRowViewport } from "./useRowViewport";
import {
  swipeActionView,
  type SwipeActionId,
  type SwipeActionView,
} from "@/lib/swipe";
import type { RowDragHandle } from "./groupHelpers";
import {
  HELD_LABEL,
  HELD_VISUAL,
  HELD_WORD,
  MENTION,
  RETRIED_LABEL,
  foldedKidsText,
  projectHue,
  rowStatusToneClass,
  sameCollapse,
  statusVisualFor,
  statusWordFor,
  stripLeadingEmoji,
  type RowCollapse,
  type RowProviderIcon,
  type StatusVisual,
} from "./rowViewModel";
import {
  RowBranchLine,
  RowFoldedKids,
  RowGutter,
  RowKidsRollupPill,
  RowLead,
  RowStatusBadge,
  RowSubtitle,
  RowSwipeUnderlay,
} from "./RowParts";

export {
  CHIP_HUE_MAX,
  CHIP_HUE_MIN,
  projectHue,
  stripLeadingEmoji,
  type RowCollapse,
  type RowProviderIcon,
} from "./rowViewModel";

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

function RadarThreadRowImpl({
  thread,
  depth,
  isLastChild,
  projectName,
  sectionName,
  sectionId,
  celebrate,
  allowHoverCard = true,
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
  dragHandle?: RowDragHandle | null;
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

  const { hasUnsubmittedDraft } = useSidebarThreadDraft(thread.id);
  const rowStatus = useSidebarThreadRowStatus(thread.id);
  const shortcut = useSidebarThreadShortcut(thread.id);
  const pullRequest = useRowPullRequest(thread);

  const viewport = useRowViewport(
    rowRef,
    isEditing ||
      isKeyboardFocused ||
      menuOpen ||
      hoverCard !== null ||
      !!dragHandle?.isDragging ||
      rowRef.current?.hasAttribute("data-swipe-phase") === true,
    JSON.stringify([
      density,
      collapse?.collapsed,
      thread.displayTitle,
      thread.environment?.branchName,
      depth,
      sectionName,
      projectTag,
    ]),
    setRowElement,
  );

  const navigate = useBbNavigate();
  const { splitProps, layout: splitLayout } =
    experimental_useSidebarThreadSplit(thread.id);

  const actionTarget = threadActionTarget(thread);
  const requestRename = () => onStartRename(thread);
  const registeredActions = experimental_useThreadActions(actionTarget, {
    requestRename,
    keys: viewport.renderContents
      ? undefined
      : ["bb--core/archive", "bb--core/delete"],
  });
  useLayoutEffect(
    () => actions.register(thread.id, registeredActions),
    [actions, thread.id, registeredActions],
  );
  // Hidden workers (relayed results, routine runs) only show with the view
  // option on; any worker can be tucked away or brought back from its menu.
  const isWorker = !!(thread.parentThreadId || thread.lifecycleOwnerThreadId);
  const inlineActions = useMemo<PluginThreadActionsInlineItem[]>(
    () => [
      ...(thread.isHidden
        ? [
            {
              key: "radar-sidebar/show",
              group: experimental_THREAD_ACTION_GROUPS.organize,
              action: {
                label: "Show thread",
                icon: "Eye",
                run: async () => {
                  await sdk.threads.update({
                    threadId: thread.id,
                    visibility: "visible",
                  });
                  hiddenChanged();
                },
              },
            } satisfies PluginThreadActionsInlineItem,
          ]
        : isWorker
          ? [
              {
                key: "radar-sidebar/hide",
                group: experimental_THREAD_ACTION_GROUPS.organize,
                action: {
                  label: "Hide",
                  icon: "EyeOff",
                  run: async () => {
                    await sdk.threads.update({
                      threadId: thread.id,
                      visibility: "hidden",
                    });
                    hiddenChanged();
                  },
                },
              } satisfies PluginThreadActionsInlineItem,
            ]
          : []),
      ...(hasChildren || thread.parentThreadId
        ? [
            {
              key: "radar-sidebar/family-read",
              group: experimental_THREAD_ACTION_GROUPS.organize,
              action: {
                label: "Mark family read",
                icon: "MailOpen",
                run: () => onMarkFamilyRead(thread),
              },
            } satisfies PluginThreadActionsInlineItem,
          ]
        : []),
      ...(registeredActions.some((entry) => entry.key === "thread-list/move")
        ? []
        : [
            {
              key: "radar-sidebar/move",
              group: experimental_THREAD_ACTION_GROUPS.organize,
              action: {
                label: "Move to section",
                icon: "Folder",
                choices: {
                  heading: "Move to section",
                  items: [
                    ...sections.map((section) => ({
                      id: section.id,
                      label: section.name,
                      selected: section.id === thread.sectionId,
                    })),
                    {
                      id: "none",
                      label: "No section",
                      selected: thread.sectionId === null,
                    },
                  ],
                },
                run: async ({ value }) => {
                  if (value)
                    await sdk.threads.update({
                      threadId: thread.id,
                      sectionId: value === "none" ? null : value,
                    });
                },
              },
            } satisfies PluginThreadActionsInlineItem,
          ]),
    ],
    [hasChildren, isWorker, thread, sections, sdk, registeredActions, onMarkFamilyRead],
  );

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
      if (!isHoveringCard.current) setHoverCard(null);
    }, 220);
  }, []);

  useEffect(() => {
    return () => {
      if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
      if (hoverTimer.current !== null) clearTimeout(hoverTimer.current);
      if (hoverCardTimer.current !== null) clearTimeout(hoverCardTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!isVisible) closeHoverCard(true);
  }, [isVisible, closeHoverCard]);

  const hoverOpen = hoverCard !== null;
  useEffect(() => {
    if (!hoverOpen) return;
    const close = () => {
      if (!isHoveringCard.current) setHoverCard(null);
    };
    document.addEventListener("scroll", close, true);
    window.addEventListener("blur", close);
    return () => {
      document.removeEventListener("scroll", close, true);
      window.removeEventListener("blur", close);
    };
  }, [hoverOpen]);

  const scheduleHoverCard = () => {
    if (!allowHoverCard || !isVisible || !canHoverPreview()) return;
    if (hoverTimer.current !== null || hoverCard) return;
    hoverTimer.current = window.setTimeout(() => {
      hoverTimer.current = null;
      const rect = rowRef.current?.getBoundingClientRect();
      if (!rect) return;
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
    enabled:
      isVisible &&
      viewport.renderContents &&
      !isEditing &&
      !selectionActive &&
      !!(rightSwipe || leftSwipe),
    right: rightSwipe,
    left: leftSwipe,
    restoreKey: `${thread.isArchived}`,
    onStart: () => {
      setMoreEnabled(true);
      closeHoverCard(true);
    },
    onCommit: runSwipeAction,
  });

  const held = thread.indicator === "queued-waiting" && isHeldThread(thread);
  const indicator = effectiveIndicator(thread);
  const statusLabel = held
    ? HELD_LABEL
    : indicator === thread.indicator
      ? (thread.indicatorLabel ?? null)
      : RETRIED_LABEL;
  const visual: StatusVisual = held ? HELD_VISUAL : statusVisualFor(indicator);
  const needsUser = thread.indicator === "waiting-for-input";
  const failed = indicator === "unread-error" || indicator === "queued-failed";
  const actionPulseClass =
    thread.indicator === "waiting-for-input"
      ? "radar-row-pulse-amber"
      : failed
        ? "radar-row-pulse-red"
        : null;
  const foldedSummary =
    collapse?.collapsed && collapse.hiddenTotal > 0
      ? foldedKidsText(collapse)
      : null;
  const rowLabel = [
    thread.displayTitle,
    statusLabel,
    thread.isPinned ? "pinned" : null,
    foldedSummary,
  ]
    .filter((part): part is string => !!part)
    .join(" — ");
  const statusWord = held ? HELD_WORD : statusWordFor(indicator);
  const strippedTitle = stripLeadingEmoji(thread.displayTitle);
  const shownTitle =
    thread.isHidden ||
    (strippedTitle !== thread.displayTitle &&
      !MENTION.test(thread.title ?? thread.titleFallback ?? ""))
      ? strippedTitle
      : null;

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
    if (touchPointer.current && event.button === 0) event.preventDefault();
  };

  if (!viewport.renderContents) {
    return (
      <div
        ref={viewport.ref}
        className={cn(
          "radar-row radar-row-placeholder",
          density === "compact" && "radar-row-compact",
          depth === 0 && "radar-row-root",
          depth === 1 && "radar-row-child",
          depth > 1 && "radar-row-deep",
          depth > 0 && isLastChild && "radar-row-last",
          isActive && "radar-row-active",
          isSelected && "radar-row-selected",
          thread.isHidden && "radar-row-hidden",
        )}
        data-has-branch={(depth === 0 && !!thread.environment?.branchName) || undefined}
        style={viewport.height === undefined ? undefined : { height: viewport.height }}
        onFocusCapture={viewport.onFocusCapture}
        onBlurCapture={viewport.onBlurCapture}
      >
        <a
          href={thread.href}
          data-sidebar-thread-id={thread.id}
          data-sidebar-thread-shortcut-target={isShortcutTarget ? "" : undefined}
          aria-label={rowLabel}
          aria-current={isActive ? "page" : undefined}
          aria-keyshortcuts={shortcut?.ariaKeyshortcuts}
          {...splitProps}
          onPointerDown={handlePointerDown}
          onMouseDown={handleMouseDown}
          className="radar-row-main"
          onClick={handleNavigate}
        />
      </div>
    );
  }

  const branch = thread.environment?.branchName ?? null;
  const hostName = thread.host?.name ?? null;
  const hasBranchLine = depth === 0 && !!branch;
  const showHost =
    hostName && (!primaryHostId || thread.host?.id !== primaryHostId);
  const where = showHost ? hostName : null;
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
  const executionLoaded =
    execution === undefined ? "loading" : execution ? "ready" : "none";

  const subtitleNode = (
    <RowSubtitle
      depth={depth}
      sectionName={sectionName}
      sectionId={sectionId}
      where={where}
      providerName={providerName}
      needsProviderText={needsProviderText}
      showExecution={showExecution}
      executionLoaded={executionLoaded}
      modelName={modelName}
      thinking={thinking}
      fullSubtitle={fullSubtitle}
    />
  );

  const isWorktree = thread.environment?.isWorktree === true;
  const handleCopyBranch = (event: React.MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!branch) return;
    void navigator.clipboard
      .writeText(branch)
      .then(() => {
        setCopiedBranch(true);
        toast.success(`Copied branch: ${branch}`);
        copiedTimer.current = window.setTimeout(() => setCopiedBranch(false), 1600);
      })
      .catch(() => {
        toast.error("Could not copy branch");
      });
  };

  const branchNode =
    hasBranchLine && branch ? (
      <RowBranchLine
        branch={branch}
        isWorktree={isWorktree}
        copiedBranch={copiedBranch}
        pullRequest={pullRequest}
        onCopyBranch={handleCopyBranch}
        onOpenPr={navigate.openUrl}
      />
    ) : null;

  const leadNode = (
    <RowLead
      selectionActive={selectionActive}
      isSelected={isSelected}
      providerIcon={providerIcon}
      providerName={providerName}
      onToggleSelect={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onToggleSelect?.(event, thread.id);
      }}
    />
  );

  const gutterNode = <RowGutter collapse={collapse} dragHandle={dragHandle} />;
  const familyFolded = !!collapse?.collapsed && collapse.hiddenTotal > 0;
  const kidsNode =
    collapse && familyFolded ? <RowFoldedKids collapse={collapse} /> : null;

  const commit = () => {
    if (cancelledRef.current) return;
    onCommitRename(thread, renameValue);
  };

  if (isEditing) {
    return (
      <div
        ref={viewport.ref}
        onFocusCapture={viewport.onFocusCapture}
        onBlurCapture={viewport.onBlurCapture}
        className={cn("radar-row", isActive && "radar-row-active")}
      >
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
    <ThreadActionsContextMenu
      thread={actionTarget}
      inline={inlineActions}
      requestRename={requestRename}
      disabled={!isVisible || selectionActive}
      dragging={dragHandle?.isDragging ?? false}
      onOpenChange={(open) => {
        setMenuOpen(open);
        if (open) closeHoverCard(true);
      }}
    >
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
          thread.isHidden && "radar-row-hidden",
          actionPulseClass,
        )}
        ref={viewport.ref}
        onFocusCapture={() => {
          setMoreEnabled(true);
          viewport.onFocusCapture();
        }}
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
        <RowSwipeUnderlay reveal={swipeReveal} />
        {gutterNode}
        <a
          href={thread.href}
          data-sidebar-thread-shortcut-target={isShortcutTarget ? "" : undefined}
          data-sidebar-thread-id={thread.id}
          aria-label={rowLabel}
          aria-current={isActive ? "page" : undefined}
          aria-keyshortcuts={shortcut?.ariaKeyshortcuts}
          title={thread.displayTitle}
          {...splitProps}
          onPointerDown={handlePointerDown}
          onMouseDown={handleMouseDown}
          onClick={handleNavigate}
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
                  {shownTitle !== null ? (
                    <span>{shownTitle}</span>
                  ) : (
                    <ThreadTitle threadId={thread.id} />
                  )}
                </span>
                {thread.isHidden ? (
                  <span
                    className="radar-hidden-chip"
                    title="Hidden from bb's list"
                  >
                    hidden
                  </span>
                ) : null}
              </span>
              <RowKidsRollupPill collapse={collapse} />
              <span className="radar-row-meta">
                {projectTag ? (
                  <span
                    className="radar-row-project"
                    title={projectTag}
                    style={
                      {
                        "--radar-project-hue":
                          projectColorHue ?? projectHue(thread.projectId),
                      } as CSSProperties
                    }
                  >
                    {projectTag}
                  </span>
                ) : null}
                <span className="radar-row-time" title={timeText}>
                  {timeText}
                </span>
              </span>
            </span>
            <span className="radar-row-extra">
              <span className="radar-row-extra-inner">
                {kidsNode ?? subtitleNode}
              </span>
            </span>
            {branchNode}
          </span>
          <span className="radar-row-badges">
            <RowStatusBadge
              visual={visual}
              statusWord={statusWord}
              statusLabel={statusLabel}
              celebrate={celebrate}
            />
            {shortcut ? <kbd className="radar-kbd">{shortcut.label}</kbd> : null}
            {rowStatus ? (
              <span
                className={cn(
                  "radar-badge-icon",
                  rowStatusToneClass(rowStatus.tone),
                )}
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
            {thread.isUnread && thread.indicator !== "unread-success" ? (
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
          {moreEnabled ? (
            <ThreadActionsMenu
              thread={actionTarget}
              inline={inlineActions}
              requestRename={requestRename}
              side="right"
              align="start"
              sideOffset={8}
              onOpenChange={(open) => {
                setMenuOpen(open);
                if (open) closeHoverCard(true);
              }}
              trigger={(props) => {
                activateMore.current = () => {
                  if (props.onClick) menuTriggerRef.current?.click();
                  else
                    menuTriggerRef.current?.dispatchEvent(
                      new KeyboardEvent("keydown", {
                        key: "ArrowDown",
                        bubbles: true,
                        cancelable: true,
                      }),
                    );
                };
                return (
                  <button
                    {...props}
                    type="button"
                    tabIndex={-1}
                    aria-label="More actions"
                    title="More actions"
                    ref={(node) => {
                      menuTriggerRef.current = node;
                      if (typeof props.ref === "function") props.ref(node);
                      else if (props.ref) props.ref.current = node;
                    }}
                    className={cn(props.className, "radar-action radar-action-more")}
                    onClick={(event) => {
                      props.onClick?.(event);
                      event.stopPropagation();
                    }}
                  >
                    <Icon name="MoreHorizontal" aria-hidden="true" />
                  </button>
                );
              }}
            />
          ) : (
            <button
              type="button"
              tabIndex={-1}
              aria-label="More actions"
              title="More actions"
              aria-haspopup="menu"
              className="radar-action radar-action-more"
              ref={menuTriggerRef}
              onPointerDown={(event) => {
                touchPointer.current = event.pointerType === "touch";
              }}
              onMouseDown={handleMouseDown}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                requestedMore.current = true;
                setMoreEnabled(true);
              }}
            >
              <Icon name="MoreHorizontal" aria-hidden="true" />
            </button>
          )}
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

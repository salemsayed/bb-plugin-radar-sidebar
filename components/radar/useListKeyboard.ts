import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import type {
  PluginBrowserBbSdk,
  PluginSidebarThread,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { RadarThreadActions } from "./threadActions";
import type { ThreadGroup } from "./useThreadGroups";
import { nThreads, problem, reportBulk } from "./listFeedback";

/**
 * Keyboard focus, arrow-key navigation, multi-select and the bulk actions
 * that act on the selection. Navigation walks rows in the order they show,
 * skipping folded groups and families.
 */
export function useListKeyboard({
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
}: {
  rootRef: RefObject<HTMLDivElement | null>;
  searchInputRef: RefObject<HTMLInputElement | null>;
  query: string;
  setQuery: (query: string) => void;
  needsYouGroup: ThreadGroup | null;
  botGroups: ThreadGroup[];
  pinnedGroup: ThreadGroup | null;
  groups: ThreadGroup[];
  workingGroup: ThreadGroup | null;
  workingOpen: boolean;
  collapsedGroupIds: ReadonlySet<string>;
  collapseIds: ReadonlySet<string>;
  shownChildren: Map<string, PluginSidebarThread[]>;
  rowById: Map<string, PluginSidebarThread>;
  toggleThreadCollapse: (id: string) => void;
  actions: RadarThreadActions;
  sdk: PluginBrowserBbSdk;
  onNavigate: () => void;
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [keyboardFocusedId, setKeyboardFocusedId] = useState<string | null>(null);
  const lastSelectedIdRef = useRef<string | null>(null);

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
  }, [keyboardFocusedId, visibleThreadIds, rowById, rootRef, searchInputRef]);

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
    setQuery,
    rootRef,
    searchInputRef,
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

  return {
    selectedIds,
    clearSelection: () => setSelectedIds(new Set()),
    keyboardFocusedId,
    visibleThreadIds,
    handleToggleSelect,
    handleBulkArchive,
    handleBulkPin,
    handleBulkMarkRead,
  };
}

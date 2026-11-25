import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { cn } from "@/lib/utils";
import type { BotActivity } from "./botScope";
import type { ThreadGroup } from "./useThreadGroups";
import {
  COLLAPSED_KEY,
  COLLAPSED_THREADS_KEY,
  usePersistedSet,
} from "./useListSettings";

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

export interface GroupMenuAnchor {
  x: number;
  y: number;
  /** Opened on a bot card: offers to hide that bot. */
  botKey?: string;
}

const EMPTY_ID_SET: ReadonlySet<string> = new Set();

/** Outlasts the `.radar-fold` collapse transition (280ms in styles/groups.css). */
const FOLD_UNMOUNT_MS = 320;

/**
 * A section group that accepts a dragged thread. Highlighting is driven by
 * dnd-kit's `isOver`, so the drop target is unmistakable before release.
 */
export function DroppableSectionSection({
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
export function DraggableThreadRow({
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
  const [collapsedThreads, setCollapsedThreads] = usePersistedSet(
    COLLAPSED_THREADS_KEY,
  );
  const collapseIds: ReadonlySet<string> = isFiltering
    ? EMPTY_ID_SET
    : collapsedThreads;
  const collapsedGroupIds: ReadonlySet<string> = isFiltering
    ? EMPTY_ID_SET
    : collapsed;

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

  const toggleThreadCollapse = useCallback(
    (id: string) => {
      setCollapsedThreads((previous) => {
        const next = new Set(previous);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    [setCollapsedThreads],
  );

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

export function summarizeCrewActivity(
  crewActivity: readonly BotActivity[],
): BotActivity | null {
  if (!crewActivity.length) return null;
  return crewActivity.reduce((sum, next) => ({
    unread: sum.unread || next.unread,
    updates: sum.updates + next.updates,
    workers: sum.workers + next.workers,
    hiddenWorkers: sum.hiddenWorkers + next.hiddenWorkers,
    active: sum.active + next.active,
    questions: sum.questions + next.questions,
    decisions: sum.decisions + next.decisions,
    lastKnownWorkers: (sum.lastKnownWorkers ?? 0) + (next.lastKnownWorkers ?? 0),
    lastKnownActive: (sum.lastKnownActive ?? 0) + (next.lastKnownActive ?? 0),
    lastKnownQuestions:
      (sum.lastKnownQuestions ?? 0) + (next.lastKnownQuestions ?? 0),
    complete: sum.complete !== false && next.complete !== false,
  }));
}

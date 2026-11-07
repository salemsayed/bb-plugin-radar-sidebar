import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { cn } from "@/lib/utils";
import { GroupHeader } from "./RadarGroupHeader";
import { RadarWorkingPeek } from "./RadarWorkingPeek";
import { Fold, renderSubtree, type RenderRow } from "./RadarGroupList";
import { isLiveThread } from "./time";
import type { ThreadGroup } from "./useThreadGroups";

/**
 * Threads with work in flight, folded under the list. Hovering the header
 * (pointer only, never touch) peeks into what each one is doing.
 */
export function RadarWorkingDrawer({
  workingGroup,
  workingCount,
  open,
  onToggle,
  renderRow,
  shownChildren,
  collapseIds,
  isCompactViewport,
  now,
  projectNameFor,
  rowById,
  onOpenThread,
}: {
  workingGroup: ThreadGroup | null;
  workingCount: number;
  open: boolean;
  onToggle: () => void;
  renderRow: RenderRow;
  shownChildren: Map<string, PluginSidebarThread[]>;
  collapseIds: ReadonlySet<string>;
  isCompactViewport: boolean;
  now: number;
  projectNameFor: (thread: PluginSidebarThread) => string;
  rowById: Map<string, PluginSidebarThread>;
  onOpenThread: (threadId: string) => void;
}) {
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

  return (
    <>
      {workingGroup ? (
        <section
          aria-label={workingGroup.label}
          className={cn(
            "radar-group radar-working-drawer",
            open ? "radar-group-expanded" : "radar-group-collapsed",
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
              isCollapsed={!open}
              onToggle={onToggle}
              onContextMenu={(event) => event.preventDefault()}
            />
          </div>
          <Fold collapsed={!open} role="list" label={`${workingGroup.label} threads`}>
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
                  !open,
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
                onOpenThread(threadId);
              }}
              onPointerEnter={clearPeekTimer}
              onPointerLeave={() => schedulePeek(() => null, 180)}
            />,
            document.body,
          )
        : null}
    </>
  );
}

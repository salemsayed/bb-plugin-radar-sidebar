import type { MouseEvent, ReactNode } from "react";
import { CSS } from "@dnd-kit/utilities";
import { useSortable } from "@dnd-kit/sortable";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";

/** The group shape the header needs; kept structural so callers stay loose. */
export interface GroupHeaderData {
  id: string;
  label: string;
  icon: string;
  total: number;
  unread: number;
  live: number;
  needsUser: number;
  failed: number;
  projectId: string | null;
}

/**
 * One glyph rule for every grouping mode. Previously the sortable and plain
 * paths each hard-coded their own, so the Pinned group rendered a folder in
 * project view. Time groups get none: "Today" already says it is a time.
 */
export function groupGlyph(
  group: Pick<GroupHeaderData, "id" | "icon" | "projectId">,
  isCollapsed: boolean,
): string | null {
  if (group.id === "pinned") return "Pin";
  if (group.projectId) return isCollapsed ? "Folder" : "FolderOpen";
  if (group.id.startsWith("time:")) return null;
  return group.icon;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function GroupStatus({ group }: { group: GroupHeaderData }) {
  // Attention takes priority over execution, matching the folded-family dot.
  if (group.failed > 0) {
    return (
      <span
        className="radar-group-status"
        title={plural(group.failed, "failed thread")}
        aria-label={`${group.failed} failed`}
      >
        <span className="radar-dot radar-dot-error" />
      </span>
    );
  }
  if (group.needsUser > 0) {
    return (
      <span
        className="radar-group-status"
        title={plural(group.needsUser, "thread waiting for input")}
        aria-label={`${group.needsUser} waiting for input`}
      >
        <span className="radar-dot radar-dot-attention radar-dot-pulse" />
      </span>
    );
  }
  if (group.live > 0) {
    return (
      <span
        className="radar-group-status radar-spinner radar-tone-running"
        title={plural(group.live, "running thread")}
        aria-label={`${group.live} running`}
      >
        <Icon name="Loading" aria-hidden="true" />
      </span>
    );
  }
  return null;
}

interface HeaderProps {
  group: GroupHeaderData;
  isCollapsed: boolean;
  onToggle: () => void;
  onContextMenu: (event: MouseEvent<HTMLDivElement>) => void;
  onNewThread?: () => void;
  /** Drag-to-reorder affordance; only project grouping supplies these. */
  drag?: {
    attributes: ReturnType<typeof useSortable>["attributes"];
    listeners: ReturnType<typeof useSortable>["listeners"];
  };
}

/** The group header row, shared by the plain and sortable group sections. */
export function GroupHeader({
  group,
  isCollapsed,
  onToggle,
  onContextMenu,
  onNewThread,
  drag,
}: HeaderProps) {
  const counts =
    group.unread > 0
      ? `${group.unread} unread of ${group.total}`
      : plural(group.total, "thread");
  const glyph = groupGlyph(group, isCollapsed);
  return (
    <div
      className={cn(
        "radar-group-header",
        drag && "radar-group-header-sortable",
      )}
      onContextMenu={onContextMenu}
    >
      <button
        type="button"
        className="radar-group-toggle"
        aria-expanded={!isCollapsed}
        aria-label={`${group.label}, ${counts}`}
        title={drag ? `${counts} — drag to reorder` : counts}
        onClick={onToggle}
        {...drag?.attributes}
        {...drag?.listeners}
      >
        {drag ? (
          <span className="radar-group-grip" aria-hidden="true" title="Drag to reorder">
            <Icon name="DragDropVertical" />
          </span>
        ) : null}
        <Icon
          name={isCollapsed ? "ChevronRight" : "ChevronDown"}
          aria-hidden="true"
          className="radar-group-chevron"
        />
        {glyph ? (
          <Icon name={glyph} aria-hidden="true" className="radar-group-icon" />
        ) : null}
        <span className="radar-group-label">{group.label}</span>
        <span className="radar-group-meta">
          <GroupStatus group={group} />
          {group.unread > 0 ? (
            <span className="radar-group-unread" aria-hidden="true">
              <span className="radar-unread" />
              {group.unread}
            </span>
          ) : null}
          <span className="radar-group-count">{group.total}</span>
        </span>
      </button>
      {onNewThread ? (
        <button
          type="button"
          className="radar-group-new-thread"
          aria-label={`Start new thread in ${group.label}`}
          title={`Start new thread in ${group.label}`}
          onClick={(event) => {
            event.stopPropagation();
            onNewThread();
          }}
        >
          <Icon name="MessageSquarePlus" aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

/** A drag-reorderable group section (project grouping). */
export function SortableGroupSection({
  group,
  isCollapsed,
  onToggle,
  onNewThread,
  onContextMenu,
  children,
}: {
  group: GroupHeaderData;
  isCollapsed: boolean;
  onToggle: () => void;
  onNewThread?: () => void;
  onContextMenu: (event: MouseEvent<HTMLDivElement>) => void;
  children: ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: group.id });

  return (
    <section
      ref={setNodeRef}
      aria-label={group.label}
      className={cn(
        "radar-group",
        group.projectId && "radar-group-project",
        isCollapsed ? "radar-group-collapsed" : "radar-group-expanded",
        isDragging && "radar-group-dragging",
      )}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
        opacity: isDragging ? 0.35 : undefined,
        position: "relative",
        zIndex: isDragging ? 10 : undefined,
      }}
    >
      <GroupHeader
        group={group}
        isCollapsed={isCollapsed}
        onToggle={onToggle}
        onContextMenu={onContextMenu}
        onNewThread={onNewThread}
        drag={{ attributes, listeners }}
      />
      {children}
    </section>
  );
}

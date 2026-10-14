import type { RefObject } from "react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { RadarBotSwitcher } from "./RadarBotSwitcher";
import { BotFace } from "./BotFace";
import { shortBotName, type Pulse, type RosterBot } from "./bots";
import { setRailScope } from "./railScope";
import { RadarViewOptions } from "./RadarViewOptions";
import { RadarNewSection } from "./RadarNewSection";
import type { RadarThreadActions } from "./threadActions";
import {
  LIFECYCLE_LABELS,
  STATUS_LABELS,
  type Grouping,
  type ListView,
} from "./useListSettings";

/**
 * The sticky header: bot shortcuts (when on), the filter field, the view
 * options panel (status chips, the Archived and Hidden workers toggles,
 * collapse all) and a removable pill per active filter. Grouping and row
 * density are plugin settings, not panel controls.
 */
export function RadarListHeader({
  view,
  searchInputRef,
  statusCounts,
  pinnedCount,
  isCompactViewport,
  grouping,
  areAllGroupsCollapsed,
  onToggleAllGroups,
  botRail,
  bots,
  allThreads,
  attentionPulses,
  railScope,
  scopedBot,
  scopeName,
  activeThreadId,
  motion,
  actions,
  onNavigate,
  showHidden,
  onToggleShowHidden,
}: {
  view: ListView;
  searchInputRef: RefObject<HTMLInputElement | null>;
  statusCounts: { live: number; waiting: number; unread: number };
  pinnedCount: number;
  isCompactViewport: boolean;
  grouping: Grouping;
  areAllGroupsCollapsed: boolean;
  onToggleAllGroups: () => void;
  botRail: boolean;
  bots: RosterBot[];
  allThreads: readonly PluginSidebarThread[];
  attentionPulses: ReadonlyMap<string, Pulse>;
  railScope: string | null;
  scopedBot: RosterBot | null;
  scopeName: string;
  activeThreadId: string | null;
  motion: boolean;
  actions: RadarThreadActions;
  onNavigate: () => void;
  showHidden: boolean;
  onToggleShowHidden: () => void;
}) {
  const {
    query,
    setQuery,
    lifecycle,
    statusFilter,
    selectLifecycle,
    selectStatus,
    toggleStatus,
  } = view;

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
    <div className="radar-list-header">
      {botRail ? <RadarBotSwitcher bots={bots} threads={allThreads} pulses={attentionPulses}
        scope={railScope} activeThreadId={activeThreadId} compact={isCompactViewport}
        motion={motion}
        onClear={() => setRailScope(null)}
        onSelect={bot => { setRailScope(bot.key); actions.open(bot.current); onNavigate(); }}
        onNavigate={onNavigate} /> : null}
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
            <button
              type="button"
              role="radio"
              aria-checked={statusFilter === "pinned"}
              className={cn(
                "radar-chip",
                "radar-chip-iconic",
                statusFilter === "pinned" && "radar-chip-active",
              )}
              aria-label="Pinned"
              onClick={() => toggleStatus("pinned")}
              title="Filter pinned threads"
            >
              <span className="radar-chip-indicator">
                <Icon name="Pin" aria-hidden="true" />
              </span>
              <span className="radar-chip-label">Pinned</span>
              {pinnedCount > 0 ? (
                <span className="radar-chip-count">{pinnedCount}</span>
              ) : null}
            </button>
          </div>
          <div className="radar-view-row">
            <button
              type="button"
              aria-pressed={lifecycle === "all"}
              title="Include archived threads"
              className={cn("radar-view-action", lifecycle === "all" && "radar-view-action-active")}
              onClick={() => selectLifecycle(lifecycle === "all" ? "active" : "all")}
            >
              <Icon name="Archive" aria-hidden="true" />
              <span>Archived</span>
            </button>
            <button
              type="button"
              aria-pressed={showHidden}
              title="Show worker threads hidden after their result was relayed"
              className={cn("radar-view-action", showHidden && "radar-view-action-active")}
              onClick={onToggleShowHidden}
            >
              <Icon name={showHidden ? "Eye" : "EyeOff"} aria-hidden="true" />
              <span>Hidden workers</span>
            </button>
          </div>
          <div className="radar-view-row">
            <button
              type="button"
              aria-label={
                areAllGroupsCollapsed
                  ? "Expand all folders"
                  : "Collapse all folders"
              }
              className="radar-view-action"
              onClick={onToggleAllGroups}
            >
              <Icon
                name={areAllGroupsCollapsed ? "Expand" : "Collapse"}
                aria-hidden="true"
              />
              <span>{areAllGroupsCollapsed ? "Expand all" : "Collapse all"}</span>
            </button>
          </div>
        </RadarViewOptions>
      </div>

      {scopePill || statusFilter !== "all" || lifecycle !== "active" ? (
        <div role="group" aria-label="Active filters" className="radar-active-filters">
          {scopePill}
          {statusFilter !== "all" ? (
            <button
              type="button"
              className="radar-active-filter"
              aria-label={`Clear ${STATUS_LABELS[statusFilter]} filter`}
              title="Clear this filter"
              onClick={() => selectStatus("all")}
            >
              <span>{STATUS_LABELS[statusFilter]}</span>
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
    </div>
  );
}

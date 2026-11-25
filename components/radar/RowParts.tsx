import type { CSSProperties, MouseEvent, ReactNode } from "react";
import { experimental_ProviderIcon as ProviderIcon } from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import { cn } from "@/lib/utils";
import type { SwipeActionView } from "@/lib/swipe";
import type { RowDragHandle } from "./groupHelpers";
import {
  foldedKidsText,
  hiddenRollupDotClass,
  hiddenSummary,
  prBadgeClass,
  prIconName,
  prLabel,
  prToneClass,
  projectHue,
  type RowCollapse,
  type RowProviderIcon,
  type StatusVisual,
} from "./rowViewModel";

export interface PullRequestSummary {
  number: number;
  title: string;
  url: string;
  state: string;
  attention: string;
}

export function RowStatusBadge({
  visual,
  statusWord,
  statusLabel,
  celebrate,
}: {
  visual: StatusVisual;
  statusWord: { text: string; tone: string } | null;
  statusLabel: string | null;
  celebrate: boolean;
}) {
  if (!visual && !statusWord) return null;
  return (
    <span
      className={cn("radar-row-status-badge", celebrate && "radar-celebrate")}
      title={statusLabel ?? undefined}
    >
      {visual?.kind === "spinner" ? (
        <span key="spinner" className="radar-spinner radar-tone-running">
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
  );
}

export function RowBranchLine({
  branch,
  isWorktree,
  copiedBranch,
  pullRequest,
  onCopyBranch,
  onOpenPr,
}: {
  branch: string;
  isWorktree: boolean;
  copiedBranch: boolean;
  pullRequest: PullRequestSummary | null;
  onCopyBranch: (event: MouseEvent) => void;
  onOpenPr: (url: string) => void;
}) {
  return (
    <span
      className="radar-branch-line"
      title={isWorktree ? `${branch} (worktree)` : branch}
    >
      <button
        type="button"
        tabIndex={-1}
        className={cn("radar-branch-btn", copiedBranch && "radar-branch-copied")}
        title={
          copiedBranch
            ? "Copied branch to clipboard!"
            : `Click to copy branch: ${branch}`
        }
        aria-label={`Copy branch name ${branch}`}
        onClick={onCopyBranch}
      >
        <Icon
          name={copiedBranch ? "Check" : isWorktree ? "FolderGit" : "GitBranch"}
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
            onOpenPr(pullRequest.url);
          }}
        >
          <Icon
            name={prIconName(pullRequest.state, pullRequest.attention)}
            aria-hidden="true"
          />
          <span>
            #{pullRequest.number} · {prLabel(pullRequest.state, pullRequest.attention)}
          </span>
        </button>
      ) : null}
    </span>
  );
}

export function RowLead({
  selectionActive,
  isSelected,
  providerIcon,
  providerName,
  onToggleSelect,
}: {
  selectionActive: boolean;
  isSelected: boolean;
  providerIcon: RowProviderIcon | null;
  providerName: string;
  onToggleSelect: (event: MouseEvent) => void;
}) {
  return (
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
          onClick={onToggleSelect}
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
}

export function RowGutter({
  collapse,
  dragHandle,
}: {
  collapse: RowCollapse | null;
  dragHandle: RowDragHandle | null | undefined;
}) {
  return (
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
}

export function RowFoldedKids({ collapse }: { collapse: RowCollapse }) {
  const faceKids = collapse.hiddenKids.slice(0, 3);
  const faceRemainder = collapse.hiddenTotal - faceKids.length;
  return (
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
  );
}

export function RowKidsRollupPill({ collapse }: { collapse: RowCollapse | null }) {
  if (!collapse?.collapsed || collapse.hiddenTotal === 0) return null;
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
      {dot ? <span className={cn("radar-dot", dot)} aria-hidden="true" /> : null}
    </span>
  );
}

export function RowSubtitle({
  depth,
  sectionName,
  sectionId,
  where,
  providerName,
  needsProviderText,
  showExecution,
  executionLoaded,
  modelName,
  thinking,
  fullSubtitle,
}: {
  depth: number;
  sectionName: string | null;
  sectionId: string | null;
  where: string | null;
  providerName: string;
  needsProviderText: boolean;
  showExecution: boolean;
  executionLoaded: "loading" | "ready" | "none";
  modelName: string | null;
  thinking: string | null;
  fullSubtitle: string;
}) {
  const contextSegments: ReactNode[] =
    depth === 0
      ? [
          ...(sectionName && sectionId
            ? [
                <span
                  key="section"
                  className="radar-section-chip"
                  style={
                    {
                      "--radar-section-hue": projectHue(`section:${sectionId}`),
                    } as CSSProperties
                  }
                  title={sectionName}
                >
                  {sectionName}
                </span>,
              ]
            : []),
          ...(where ? [<span key="where">{where}</span>] : []),
        ]
      : [];

  const subtitleSegments: ReactNode[] = [];
  if (needsProviderText && executionLoaded === "ready") {
    subtitleSegments.push(<span key="provider">{providerName}</span>);
  }
  if (executionLoaded === "ready" && showExecution) {
    subtitleSegments.push(
      <span key="model" className="radar-subtitle-model">
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

  return (
    <span className="radar-row-subtitle" title={fullSubtitle}>
      {showExecution && executionLoaded === "loading" ? (
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
            {index > 0 ? <span className="radar-subtitle-sep"> • </span> : null}
            {segment}
          </span>
        ))
      )}
    </span>
  );
}

export function RowSwipeUnderlay({
  reveal,
}: {
  reveal: { action: SwipeActionView | null; side: "left" | "right" } | null;
}) {
  if (!reveal?.action) return null;
  return (
    <span
      className={cn("radar-swipe-underlay", `radar-swipe-${reveal.action.id}`)}
      data-side={reveal.side}
      aria-hidden="true"
    >
      <span className="radar-swipe-content">
        <Icon name={reveal.action.icon} aria-hidden="true" />
        <span className="radar-swipe-label">{reveal.action.label}</span>
      </span>
    </span>
  );
}

/**
 * Pure view-model helpers for RadarThreadRow: status visual/pill classification,
 * PR badge formatting, project chip hue, folded-family rollup, and memo equality.
 */

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

/** Minimal provider record for the agent icon (extra fields ignored). */
export interface RowProviderIcon {
  id: string;
  logoUrl?: string | null;
  icon?: { glyph: string } | string | null;
}

/**
 * Map the host-resolved indicator to a status visual. Unknown -> none.
 * One color per meaning: blue is running (a spinner, or one pulsing icon for
 * background work), green is done, amber needs you, red failed, and muted is
 * queued. Only running visuals move.
 */
export type StatusVisual =
  | { kind: "spinner" }
  | { kind: "dot"; className: string }
  | { kind: "icon"; name: string; className: string }
  | null;

export const HELD_LABEL = "Message held until you send it";
/** A failed thread that a retry is running again: bb still says "unread-error" until it is read. */
export const RETRIED_LABEL = "Working again after a failure";
export const HELD_VISUAL: StatusVisual = {
  kind: "icon",
  name: "Pause",
  className: "radar-tone-muted",
};
export const HELD_WORD = { text: "Held", tone: "radar-tone-muted" } as const;

/** Chip hues avoid red through amber, which mean Failed and Needs you. */
export const CHIP_HUE_MIN = 75;
export const CHIP_HUE_MAX = 325;

// A raw title with mentions needs bb's ThreadTitle to draw its chips.
export const MENTION = /@(?:project|section|thread):/;

// One leading emoji (with any skin tone, variation selector or ZWJ joins)
// and the space after it. Bot threads prefix their state (🟢 ✅ ❌ ⏳); the
// row already shows state in colour, so the prefix only crowds the title.
const LEADING_EMOJI =
  /^(?:\p{Extended_Pictographic}|\p{Emoji_Presentation})[\u{1F3FB}-\u{1F3FF}]?\uFE0F?(?:\u200D(?:\p{Extended_Pictographic}|\p{Emoji_Presentation})[\u{1F3FB}-\u{1F3FF}]?\uFE0F?)*\s*/u;

/** The title without one leading status emoji; unchanged if nothing is left. */
export function stripLeadingEmoji(title: string): string {
  const stripped = title.replace(LEADING_EMOJI, "");
  return stripped.trim() === "" ? title : stripped;
}

/** Stable hue per project id, so chips keep identity across renames. */
export function projectHue(projectId: string): number {
  let hash = 0;
  for (let i = 0; i < projectId.length; i += 1) {
    hash = (hash * 31 + projectId.charCodeAt(i)) | 0;
  }
  return CHIP_HUE_MIN + (Math.abs(hash) % (CHIP_HUE_MAX - CHIP_HUE_MIN));
}

/** Loudest hidden state first: failed, needs-you, then live. */
export function hiddenRollupDotClass(collapse: RowCollapse): string | null {
  if (collapse.hiddenFailed) return "radar-dot-error";
  if (collapse.hiddenNeedsUser) return "radar-dot-attention";
  if (collapse.hiddenLive) return "radar-dot-running radar-dot-pulse";
  return null;
}

export function foldedKidsText(collapse: RowCollapse): string {
  const names = collapse.hiddenKids.map((kid) => kid.title).join(", ");
  const overflow = collapse.hiddenTotal - collapse.hiddenKids.length;
  return `Hidden replies: ${names}${overflow > 0 ? `, +${overflow} more` : ""}`;
}

export function hiddenSummary(collapse: RowCollapse): string {
  const parts = [
    `${collapse.hiddenTotal} hidden`,
    collapse.hiddenUnread > 0 ? `${collapse.hiddenUnread} unread` : null,
  ].filter((part): part is string => !!part);
  return parts.join(", ");
}

export function statusVisualFor(indicator: string): StatusVisual {
  switch (indicator) {
    case "runtime":
      return { kind: "spinner" };
    case "background-agent":
      return {
        kind: "icon",
        name: "Bot",
        className: "radar-tone-running radar-icon-pulse",
      };
    case "background-command":
      return {
        kind: "icon",
        name: "Terminal",
        className: "radar-tone-running radar-icon-pulse",
      };
    case "workflow":
      return {
        kind: "icon",
        name: "Workflow",
        className: "radar-tone-running radar-icon-pulse",
      };
    case "goal":
      return {
        kind: "icon",
        name: "Target",
        className: "radar-tone-running radar-icon-pulse",
      };
    case "plan-mode":
      return {
        kind: "icon",
        name: "ListTodo",
        className: "radar-tone-running radar-icon-pulse",
      };
    case "working-draft":
      return { kind: "dot", className: "radar-dot-running radar-dot-pulse" };
    case "waiting-for-input":
      return { kind: "dot", className: "radar-dot-attention" };
    case "queued-waiting":
      return { kind: "icon", name: "Clock", className: "radar-tone-muted" };
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

/**
 * Simplified, scannable status word for the row pill:
 * Needs you / Failed / Working (unified across active + background work, while
 * the visual icon + tooltip keep exact granularity) / Queued / Done.
 * Idle rows carry no pill.
 */
export function statusWordFor(
  indicator: string,
): { text: string; tone: string } | null {
  switch (indicator) {
    case "waiting-for-input":
      return { text: "Needs you", tone: "radar-tone-warning" };
    case "unread-error":
    case "queued-failed":
      return { text: "Failed", tone: "radar-tone-error" };
    case "runtime":
    case "working-draft":
    case "background-agent":
    case "background-command":
    case "workflow":
    case "goal":
    case "plan-mode":
      return { text: "Working", tone: "radar-tone-running" };
    case "queued-waiting":
      return { text: "Queued", tone: "radar-tone-muted" };
    case "unread-success":
      return { text: "Done", tone: "radar-tone-success" };
    default:
      return null;
  }
}

/** Human label for a pull request: attention first, then bare state. */
export function prLabel(state: string, attention: string): string {
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

export function prToneClass(attention: string): string {
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

export function prBadgeClass(state: string, attention: string): string {
  if (state === "merged" || attention === "merged") return "radar-pr-merged";
  if (state === "closed" || attention === "closed") return "radar-pr-closed";
  if (state === "draft" || attention === "draft") return "radar-pr-draft";
  return "radar-pr-open";
}

export function prIconName(state: string, attention: string): string {
  if (state === "merged" || attention === "merged") return "GitMerge";
  if (state === "closed" || attention === "closed") return "GitPullRequestClosed";
  if (state === "draft" || attention === "draft") return "GitPullRequestDraft";
  return "GitPullRequest";
}

export function rowStatusToneClass(tone: string | undefined): string {
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

export function sameCollapse(a: RowCollapse | null, b: RowCollapse | null): boolean {
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

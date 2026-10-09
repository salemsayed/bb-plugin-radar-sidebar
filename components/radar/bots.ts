import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { z } from "zod";
import { WAITING_THRESHOLD, type CrewJudgement } from "@/lib/crewAsk";
import { openNeeds, type NeedsItem } from "@/lib/needs";
import { isRunningThread } from "./time";

/** What the bb-salem-bots plugin publishes for sidebars: identity only, no thread content. */
export const rosterSchema = z.object({
  bots: z.array(
    z.object({
      key: z.string(),
      name: z.string(),
      current: z.string(),
      coordinatorIds: z.array(z.string()).optional(),
      projectId: z.string(),
      projects: z.array(z.string()),
      hostId: z.string(),
      providerId: z.string(),
      model: z.string(),
      rollover: z.string().nullable(),
    }),
  ),
});
export type RosterBot = z.infer<typeof rosterSchema>["bots"][number];

/** The gist of a coordinator's latest reply: what it was about and whether it asked for a decision. */
export interface Pulse {
  subject: string;
  preview?: string | null;
  decision: string | null;
  quiet: boolean;
  /** Context window used, 0..1, when the provider reports an exact figure. */
  context?: number | null;
  contextUsedTokens?: number | null;
  contextWindowTokens?: number | null;
  contextEstimated?: boolean;
  contextModel?: string | null;
}

function cleanLine(line: string): string {
  return line
    .replace(/^[\s#>*\-•]+/, "")
    .replace(/\*\*|__|`/g, "")
    .trim();
}

/** Protocol lines the coordinator plugin asks for; never what Salem wants to read. */
const PROTOCOL_LINE = /^(?:(?:BOT|PERSONAL)_READY|HANDOFF)_[a-z0-9_]+\b|^SESSION_OK\b/i;
/** The sign-off a coordinator ends a reply with when nothing is needed (bb-salem-bots light policy). */
export const QUIET_LINE = /^nothing to do\.?$/i;

/**
 * Coordinators end relays with exactly "Nothing to do." or "Decision needed: …"
 * (bb-salem-bots light policy). Everything else is treated as prose.
 */
export function parsePulse(text: string | null | undefined): Pulse | null {
  if (!text) return null;
  const lines = text.split(/\r?\n/).map(cleanLine).filter((line) => line && !PROTOCOL_LINE.test(line));
  if (lines.length === 0) return null;
  const decisionLine = [...lines].reverse().find((line) => /^decision needed:/i.test(line)) ?? null;
  const decision = decisionLine ? decisionLine.replace(/^decision needed:\s*/i, "").trim() : null;
  const last = lines[lines.length - 1]!;
  return {
    subject: lines[0]!.slice(0, 160),
    decision: decision ? decision.slice(0, 160) : null,
    quiet: !decision && QUIET_LINE.test(last),
  };
}

/** A longer hover excerpt, without protocol markers or a duplicate decision footer. */
export function pulsePreview(text: string | null | undefined): string | null {
  if (!text) return null;
  const lines = text.split(/\r?\n/).map(cleanLine).filter(line => line && !PROTOCOL_LINE.test(line) && !/^decision needed:/i.test(line));
  const prose = lines.filter(line => !QUIET_LINE.test(line));
  const preview = (prose.length ? prose : lines).join(" ");
  if (!preview) return null;
  return preview.length <= 320 ? preview : `${preview.slice(0, 320).replace(/\s+\S*$/, "")}…`;
}

/** The one thing a coordinator's latest reply asks of Salem, and the Needs You item it is saved as. */
export interface CoordinatorAsk {
  text: string;
  /** Null when the ask is not on the Needs You list (store unavailable, or judged by an older server). */
  itemId: string | null;
}

/**
 * The single ask record for a coordinator: the server's judgement of the reply
 * the sidebar shows (`version` is `latestAttentionAt`), else the reply's own
 * "Decision needed:" line until that judgement arrives. Nothing while the
 * coordinator is running, when the reply asks nothing, or once Salem has closed
 * the saved item for this reply (`dismissed`). The crew bubble, the rail face
 * and the Needs You dedupe all read this, so an ask is shown once.
 */
export function coordinatorAsk(thread: PluginSidebarThread, pulse: Pulse | null, judgement: CrewJudgement | null | undefined): CoordinatorAsk | null {
  if (isRunningThread(thread)) return null;
  const judged = judgement && judgement.threadId === thread.id && judgement.version === thread.latestAttentionAt ? judgement : null;
  if (judged?.dismissed) return null;
  if (judged && (judged.waiting ?? 0) >= WAITING_THRESHOLD) {
    return { text: judged.ask ?? pulse?.decision ?? pulse?.subject ?? "Waiting for your answer", itemId: judged.itemId ?? null };
  }
  if (judged?.waiting !== null && judged?.waiting !== undefined) return null;
  return pulse?.decision ? { text: pulse.decision, itemId: judged?.itemId ?? null } : null;
}

/**
 * The pulse the rail and the deck should read for attention: its `decision` is
 * the single ask record above, so a judged plain-language ask lights the
 * Decision face and a dismissed one does not. A running coordinator's pulse is
 * returned untouched: its state ignores decisions anyway.
 */
export function askPulse(thread: PluginSidebarThread, pulse: Pulse | null, judgement: CrewJudgement | null | undefined): Pulse | null {
  if (isRunningThread(thread)) return pulse;
  const ask = coordinatorAsk(thread, pulse, judgement);
  if (!pulse && !ask) return null;
  return { subject: ask?.text ?? "", quiet: false, ...pulse, decision: ask?.text ?? null };
}

export type BotState = "failed" | "needs-you" | "working" | "queued" | "rollover" | "decision" | "unread" | "idle" | "unavailable";

export const STATE_LABELS: Record<BotState, { text: string; tone: string; icon: string; action: string; description: string }> = {
  failed: { text: "Failed", tone: "radar-tone-error", icon: "AlertCircle", action: "Check failure", description: "A coordinator or worker failed. Open the affected thread to inspect it." },
  "needs-you": { text: "Needs you", tone: "radar-tone-warning", icon: "CircleQuestion", action: "Reply to question", description: "A question or approval is waiting for you, even if you have already read it." },
  working: { text: "Working", tone: "radar-tone-running", icon: "Loading", action: "View live work", description: "The coordinator or a worker has work in progress." },
  queued: { text: "Queued", tone: "radar-tone-info", icon: "Clock", action: "View queued work", description: "A message is queued and waiting to run." },
  rollover: { text: "Handover", tone: "radar-tone-info", icon: "RotateCcw", action: "View handover", description: "The bot is moving to a replacement coordinator." },
  decision: { text: "Decision", tone: "radar-tone-warning", icon: "ListTodo", action: "Review decision", description: "The latest coordinator reply asks for a decision. Reading it does not resolve it." },
  unread: { text: "New reply", tone: "radar-tone-info", icon: "MessageSquare", action: "Read reply", description: "A reply in this bot's family is unread. Open the thread to read it." },
  idle: { text: "Idle", tone: "radar-tone-muted", icon: "CircleCheck", action: "Open coordinator", description: "No visible work or pending input. The bot is ready for a request." },
  unavailable: { text: "Unavailable", tone: "radar-tone-muted", icon: "Unavailable", action: "Open coordinator", description: "The coordinator's state is not available yet. Open it to inspect its status." },
};

/** Attention first, then execution, then what the last reply asked for. */
export function botState(
  thread: PluginSidebarThread | undefined,
  pulse: Pulse | null,
  rollover: string | null,
  family: { live: number; needsUser: number; failed: number } = { live: 0, needsUser: 0, failed: 0 },
): BotState {
  if (!thread) return "unavailable";
  if (thread.indicator === "unread-error" || thread.indicator === "queued-failed" || thread.status === "error" || thread.queuedWork === "failed" || family.failed > 0) return "failed";
  if (thread.hasPendingInteraction || thread.indicator === "waiting-for-input" || family.needsUser > 0) return "needs-you";
  // A decision stays actionable until a new reply, unless the coordinator is already answering it.
  if (pulse?.decision && !isRunningThread(thread)) return "decision";
  if (rollover) return "rollover";
  if (isRunningThread(thread) || family.live > 0) return "working";
  if (thread.queuedWork === "waiting") return "queued";
  if (thread.isUnread) return "unread";
  return "idle";
}

/** A root thread that is blocked on Salem: a question, an approval, or a failure he has not seen. */
export function needsYou(thread: PluginSidebarThread): boolean {
  return (
    thread.hasPendingInteraction ||
    thread.indicator === "waiting-for-input" ||
    thread.indicator === "unread-error" ||
    thread.indicator === "queued-failed"
  );
}

export function shortBotName(name: string): string {
  return name.replace(/\s+Bot$/i, "");
}

/** A mascot and colour per bot, so the deck reads at a glance. Unknown keys get a stable hue from their name. */
export type BotMascot = "personal" | "home" | "bricks" | "work" | "erbareeq";
const KNOWN_STYLE: Record<string, { emoji: string; hue: number; mascot: BotMascot }> = {
  personal: { emoji: "🧭", hue: 212, mascot: "personal" },
  home: { emoji: "🏠", hue: 146, mascot: "home" },
  bricks: { emoji: "🧱", hue: 24, mascot: "bricks" },
  work: { emoji: "💼", hue: 268, mascot: "work" },
  erbareeq: { emoji: "⚡", hue: 44, mascot: "erbareeq" },
};
export interface BotStyle { emoji: string; hue: number; mascot: BotMascot | null }
export function botStyle(key: string, name: string): BotStyle {
  const known = KNOWN_STYLE[key];
  if (known) return known;
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) | 0;
  return { emoji: shortBotName(name).slice(0, 1).toUpperCase(), hue: Math.abs(hash) % 360, mascot: null };
}

/** One line for the crew header: what, across all bots, is waiting on Salem or still moving. */
export function crewDigest(states: readonly BotState[], items: readonly NeedsItem[] | null = null): string {
  const count = (state: BotState) => states.filter((s) => s === state).length;
  const parts: string[] = [];
  const decisions = items === null ? count("decision") + count("needs-you") : openNeeds(items).length + count("needs-you");
  if (count("failed")) parts.push(`${count("failed")} failed`);
  if (decisions) parts.push(`${decisions} waiting on you`);
  if (count("working")) parts.push(`${count("working")} working`);
  if (count("queued")) parts.push(`${count("queued")} queued`);
  if (count("rollover")) parts.push(`${count("rollover")} rolling over`);
  if (count("unread")) parts.push(`${count("unread")} new`);
  if (count("unavailable")) parts.push(`${count("unavailable")} unavailable`);
  return parts.length ? parts.join(" · ") : "All quiet";
}

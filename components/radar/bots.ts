import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { z } from "zod";

/** What the bb-salem-bots plugin publishes for sidebars: identity only, no thread content. */
export const rosterSchema = z.object({
  bots: z.array(
    z.object({
      key: z.string(),
      name: z.string(),
      current: z.string(),
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
  decision: string | null;
  quiet: boolean;
  /** Context window used, 0..1, when the provider reports an exact figure. */
  context?: number | null;
}

function cleanLine(line: string): string {
  return line
    .replace(/^[\s#>*\-•]+/, "")
    .replace(/\*\*|__|`/g, "")
    .trim();
}

/** Protocol lines the coordinator plugin asks for; never what Salem wants to read. */
const PROTOCOL_LINE = /^(?:(?:BOT|PERSONAL)_READY|HANDOFF)_[a-z0-9_]+\b|^SESSION_OK\b/i;

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
    quiet: !decision && /^nothing to do\.?$/i.test(last),
  };
}

export type BotState = "failed" | "needs-you" | "working" | "rollover" | "decision" | "unread" | "idle";

export const STATE_LABELS: Record<BotState, { text: string; tone: string }> = {
  failed: { text: "Failed", tone: "radar-tone-error" },
  "needs-you": { text: "Needs you", tone: "radar-tone-warning" },
  working: { text: "Working", tone: "radar-tone-running" },
  rollover: { text: "Rolling over", tone: "radar-tone-info" },
  decision: { text: "Decision", tone: "radar-tone-warning" },
  unread: { text: "New", tone: "radar-tone-success" },
  idle: { text: "Idle", tone: "radar-tone-muted" },
};

/** Attention first, then execution, then what the last reply asked for. */
export function botState(
  thread: PluginSidebarThread | undefined,
  pulse: Pulse | null,
  rollover: string | null,
  family: { live: number; needsUser: number; failed: number } = { live: 0, needsUser: 0, failed: 0 },
): BotState {
  if (!thread) return "idle";
  if (thread.indicator === "unread-error" || thread.indicator === "queued-failed" || thread.status === "error") return "failed";
  if (thread.hasPendingInteraction || thread.indicator === "waiting-for-input") return "needs-you";
  // A decision Salem has not seen outranks whatever the workers are doing.
  if (thread.isUnread && pulse?.decision) return "decision";
  if (thread.status === "active" || thread.status === "starting" || thread.activity.backgroundAgents > 0 || family.live > 0) return "working";
  if (rollover) return "rollover";
  if (thread.isUnread && !pulse?.quiet) return "unread";
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

/** A face and a colour per bot, so the deck reads at a glance. Unknown keys get a stable hue from their name. */
const KNOWN_STYLE: Record<string, { emoji: string; hue: number }> = {
  personal: { emoji: "🧭", hue: 212 },
  home: { emoji: "🏠", hue: 146 },
  bricks: { emoji: "🧱", hue: 24 },
  work: { emoji: "💼", hue: 268 },
  erbareeq: { emoji: "⚡", hue: 44 },
};
export function botStyle(key: string, name: string): { emoji: string; hue: number } {
  const known = KNOWN_STYLE[key];
  if (known) return known;
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) hash = (hash * 31 + key.charCodeAt(i)) | 0;
  return { emoji: shortBotName(name).slice(0, 1).toUpperCase(), hue: Math.abs(hash) % 360 };
}

/** One line for the crew header: what, across all bots, is waiting on Salem or still moving. */
export function crewDigest(states: readonly BotState[]): string {
  const count = (state: BotState) => states.filter((s) => s === state).length;
  const parts: string[] = [];
  const decisions = count("decision") + count("needs-you");
  if (count("failed")) parts.push(`${count("failed")} failed`);
  if (decisions) parts.push(`${decisions} waiting on you`);
  if (count("working")) parts.push(`${count("working")} working`);
  if (count("rollover")) parts.push(`${count("rollover")} rolling over`);
  if (count("unread")) parts.push(`${count("unread")} new`);
  return parts.length ? parts.join(" · ") : "All quiet";
}

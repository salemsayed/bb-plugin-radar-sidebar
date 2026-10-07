/** Crew overview: one row per bot, saying the one thing that matters about it right now. */

import { z } from "zod";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { WAITING_THRESHOLD, type CrewJudgement } from "@/lib/crewAsk";
import { normalizedNeedsText } from "@/lib/needs";
import { needsYou, type Pulse, type RosterBot } from "./bots";
import { isLiveThread } from "./time";

/** The slice of saelmbot-automations' `automations_overview` the crew view reads. */
export const automationsOverviewSchema = z.object({
  automations: z.array(z.object({
    automation: z.object({
      id: z.string(),
      projectId: z.string(),
      name: z.string(),
      enabled: z.boolean(),
      trigger: z.object({ triggerType: z.string(), cron: z.string().optional() }),
      execution: z.object({
        worker: z.object({ owner: z.object({ bot: z.string().optional() }).nullable().optional() }).nullable().optional(),
      }).nullable().optional(),
      nextRunAt: z.number().nullable().optional(),
      lastRunAt: z.number().nullable().optional(),
      lastRunStatus: z.string().nullable().optional(),
      lastRunThreadId: z.string().nullable().optional(),
      lastError: z.string().nullable().optional(),
    }),
  })),
});
export type CrewAutomation = z.infer<typeof automationsOverviewSchema>["automations"][number]["automation"];

/** What a bot's row says, and where tapping it goes. */
export interface CrewLine {
  tone: "ask" | "failed" | "running" | "new" | "quiet";
  text: string;
  threadId: string;
  at: number | null;
}

export interface CrewRow {
  bot: RosterBot;
  line: CrewLine;
  /** Further asks or running jobs behind the one shown. */
  more: number;
  context: number | null;
}

const MINUTE = 60_000;

/** Minutes between runs for frequent schedules (a watcher), or null for anything rarer. */
export function watchInterval(automation: CrewAutomation): number | null {
  if (automation.trigger.triggerType !== "schedule" || !automation.trigger.cron) return null;
  const minute = automation.trigger.cron.trim().split(/\s+/)[0] ?? "";
  if (minute === "*") return 1;
  const step = /^\*\/(\d+)$/.exec(minute);
  const every = step ? Number(step[1]) : null;
  return every !== null && every > 0 && every <= 30 ? every : null;
}

/** Bot-owned automations, plus unowned ones living in the bot's projects. */
export function automationsFor(bot: RosterBot, automations: readonly CrewAutomation[]): CrewAutomation[] {
  const projects = new Set([bot.projectId, ...bot.projects]);
  return automations.filter((automation) => {
    const owner = automation.execution?.worker?.owner?.bot;
    return owner ? owner === bot.key : projects.has(automation.projectId);
  });
}

/** "Bricks Bot: GitLab activity gate (VPS)" reads as "GitLab activity gate". */
export function shortAutomationName(name: string): string {
  return name.replace(/^[^:]{1,40}\bBot:\s*/i, "").replace(/\s*\(.*$/, "").trim() || name;
}

/** Compact relative time for dense rows: "now", "3m", "2h", "4d". */
export function shortAgo(ts: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - ts) / MINUTE);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

/** Decisions arrive mid-sentence ("reboot salem-pc…"); a row reads as its own line. */
function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function isFailedThread(thread: PluginSidebarThread): boolean {
  return thread.status === "error" || thread.indicator === "unread-error" || thread.indicator === "queued-failed";
}

function isWorkerOf(thread: PluginSidebarThread, coordinatorId: string): boolean {
  return thread.id !== coordinatorId && !thread.isArchived &&
    (thread.parentThreadId === coordinatorId || thread.lifecycleOwnerThreadId === coordinatorId);
}

/**
 * Everything waiting on Salem for one bot, failures first. A coordinator's
 * ask stays open after it is read, until the coordinator replies again: a
 * "Decision needed:" line, or else Jev's judgement of that same reply. A
 * watcher counts once it misses three of its own intervals.
 */
function asksFor(bot: RosterBot, coordinator: PluginSidebarThread | null, workers: readonly PluginSidebarThread[],
  pulse: Pulse | null, judgement: CrewJudgement | null, automations: readonly CrewAutomation[], now: number): CrewLine[] {
  const failed: CrewLine[] = [];
  const asks: CrewLine[] = [];
  if (coordinator) {
    if (isFailedThread(coordinator)) {
      failed.push({ tone: "failed", text: "Its last turn failed", threadId: coordinator.id, at: coordinator.latestAttentionAt });
    } else if (needsYou(coordinator)) {
      asks.push({ tone: "ask", text: coordinator.indicatorLabel ?? "Waiting for your answer", threadId: coordinator.id, at: coordinator.latestAttentionAt });
    } else if (!isLiveThread(coordinator)) {
      const judged = judgement?.threadId === coordinator.id && judgement.version === coordinator.latestAttentionAt
        && (judgement.waiting ?? 0) >= WAITING_THRESHOLD;
      const text = pulse?.decision ?? (judged ? judgement.ask ?? pulse?.subject ?? "Waiting for your answer" : null);
      if (text) asks.push({ tone: "ask", text: sentence(text), threadId: coordinator.id, at: coordinator.latestAttentionAt });
    }
  }
  for (const worker of workers) {
    if (isFailedThread(worker) && worker.isUnread) {
      failed.push({ tone: "failed", text: `${worker.displayTitle} failed`, threadId: worker.id, at: worker.latestAttentionAt });
    } else if (needsYou(worker)) {
      asks.push({ tone: "ask", text: `${worker.displayTitle} needs your input`, threadId: worker.id, at: worker.latestAttentionAt });
    }
  }
  for (const automation of automations) {
    const name = shortAutomationName(automation.name);
    if (automation.lastRunStatus === "failed") {
      const error = automation.lastError?.split("\n")[0]?.trim();
      failed.push({ tone: "failed", text: error ? `${name} failed: ${error}` : `${name} failed`, threadId: automation.lastRunThreadId ?? bot.current, at: automation.lastRunAt ?? null });
      continue;
    }
    const every = watchInterval(automation);
    const late = every !== null && automation.nextRunAt ? Math.floor((now - automation.nextRunAt) / MINUTE) : 0;
    if (every !== null && late >= Math.max(3 * every, 10)) {
      failed.push({ tone: "failed", text: `${name} hasn't run in ${shortAgo(now - late * MINUTE, now)}`, threadId: bot.current, at: automation.nextRunAt ?? null });
    }
  }
  const recent = (a: CrewLine, b: CrewLine) => (b.at ?? 0) - (a.at ?? 0);
  return [...failed.sort(recent), ...asks.sort(recent)];
}

export function crewRow(args: {
  bot: RosterBot;
  threads: readonly PluginSidebarThread[];
  pulse: Pulse | null;
  /** Jev's reading of the coordinator's latest reply, when the server has one. */
  judgement?: CrewJudgement | null;
  /** Null when the automations plugin did not answer: its checks are skipped. */
  automations: readonly CrewAutomation[] | null;
  now: number;
}): CrewRow {
  const { bot, threads, pulse, now } = args;
  const coordinator = threads.find((thread) => thread.id === bot.current) ?? null;
  const workers = threads.filter((thread) => isWorkerOf(thread, bot.current));
  const automations = args.automations ? automationsFor(bot, args.automations).filter((automation) => automation.enabled) : [];
  const context = pulse?.context ?? null;

  const asks = asksFor(bot, coordinator, workers, pulse, args.judgement ?? null, automations, now);
  if (asks.length > 0) return { bot, line: asks[0]!, more: asks.length - 1, context };

  const running = workers
    .filter((worker) => isLiveThread(worker) && !worker.isHidden)
    .sort((a, b) => b.createdAt - a.createdAt);
  if (running.length > 0) {
    const job = running[0]!;
    return { bot, line: { tone: "running", text: job.displayTitle, threadId: job.id, at: job.createdAt }, more: running.length - 1, context };
  }
  if (coordinator && isLiveThread(coordinator)) {
    return { bot, line: { tone: "running", text: "Thinking", threadId: coordinator.id, at: null }, more: 0, context };
  }

  return {
    bot,
    line: {
      tone: coordinator?.isUnread ? "new" : "quiet",
      text: pulse?.subject || (coordinator ? "No reply yet" : "Coordinator not found"),
      threadId: bot.current,
      at: coordinator?.latestAttentionAt ?? null,
    },
    more: 0,
    context,
  };
}

/**
 * Bots with something to say speak, most urgent first: failures, asks, work in
 * flight, then unread replies. Everyone else rests. Roster order holds within
 * each step so bubbles do not shuffle.
 */
/**
 * A bot's ask that is already on the Needs-you list is said once, by the list: its bubble would only
 * repeat it. The bot rests unless it has something else to say.
 */
export function withoutListedAsks(rows: readonly CrewRow[], listed: readonly { bot: string; text: string; state: string }[]): CrewRow[] {
  const active = new Set(listed.filter((item) => item.state !== "done" && item.state !== "dropped")
    .map((item) => `${item.bot}\u0000${normalizedNeedsText(item.text)}`));
  return rows.map((row) => row.line.tone === "ask" && active.has(`${row.bot.key}\u0000${normalizedNeedsText(row.line.text)}`)
    ? { ...row, line: { ...row.line, tone: "quiet" } }
    : row);
}

export function arrangeCrew(rows: readonly CrewRow[]): { speaking: CrewRow[]; resting: CrewRow[] } {
  const rank: Record<CrewLine["tone"], number> = { failed: 0, ask: 1, running: 2, new: 3, quiet: 4 };
  const ordered = rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => rank[a.row.line.tone] - rank[b.row.line.tone] || a.index - b.index)
    .map(({ row }) => row);
  return {
    speaking: ordered.filter((row) => row.line.tone !== "quiet"),
    resting: ordered.filter((row) => row.line.tone === "quiet"),
  };
}

/** One job a bot ran: a worker thread under its current coordinator. */
export interface CrewJob {
  id: string;
  title: string;
  status: string;
  createdAt: number;
}

export interface CrewFeedItem {
  id: string;
  bot: RosterBot;
  title: string;
  startedAt: number;
  state: "running" | "done" | "failed";
}

export function startOfToday(now: number): number {
  const day = new Date(now);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

/**
 * Every job the crew started today, newest first: live workers from the
 * sidebar (hidden run threads included) plus archived ones, once each. Bots
 * archive runs when they finish, so most of a day's work is archived.
 */
export function crewFeed(args: {
  roster: readonly RosterBot[];
  threads: readonly PluginSidebarThread[];
  archived: ReadonlyMap<string, readonly CrewJob[]>;
  now: number;
}): CrewFeedItem[] {
  const dayStart = startOfToday(args.now);
  const items = new Map<string, CrewFeedItem>();
  for (const bot of args.roster) {
    for (const job of args.archived.get(bot.current) ?? []) {
      if (job.createdAt < dayStart) continue;
      items.set(job.id, { id: job.id, bot, title: job.title, startedAt: job.createdAt, state: job.status === "error" ? "failed" : "done" });
    }
    for (const thread of args.threads) {
      if (thread.createdAt < dayStart || thread.id === bot.current) continue;
      if (thread.parentThreadId !== bot.current && thread.lifecycleOwnerThreadId !== bot.current) continue;
      items.set(thread.id, {
        id: thread.id, bot, title: thread.displayTitle, startedAt: thread.createdAt,
        state: isFailedThread(thread) ? "failed" : isLiveThread(thread) ? "running" : "done",
      });
    }
  }
  return [...items.values()].sort((a, b) => b.startedAt - a.startedAt);
}

/** A run of consecutive jobs by one bot in today's feed, shown as one card. */
export interface CrewChapter {
  id: string;
  bot: RosterBot;
  items: CrewFeedItem[];
  /** Earliest and latest start in the run. */
  from: number;
  to: number;
  done: number;
  failed: number;
  running: number;
}

/** Group the newest-first feed into runs by the same bot, so a busy bot reads as one story. */
export function crewChapters(feed: readonly CrewFeedItem[]): CrewChapter[] {
  const chapters: CrewChapter[] = [];
  for (const item of feed) {
    let chapter = chapters.at(-1);
    if (!chapter || chapter.bot.key !== item.bot.key) {
      chapter = { id: item.id, bot: item.bot, items: [], from: item.startedAt, to: item.startedAt, done: 0, failed: 0, running: 0 };
      chapters.push(chapter);
    }
    chapter.items.push(item);
    chapter.from = item.startedAt;
    chapter[item.state] += 1;
  }
  return chapters;
}

/** Jobs started today per bot key. */
export function jobsByBot(feed: readonly CrewFeedItem[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const item of feed) counts.set(item.bot.key, (counts.get(item.bot.key) ?? 0) + 1);
  return counts;
}

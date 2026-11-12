import type { z } from "zod";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { deskSchema, taskSchema } from "@/lib/botTasks";
import { NOW, DAY, HOUR, MINUTE, ago, clock, shortDay, span, stamp } from "./clock";
import type { BotTasksInput, NeedsInput, TaskDetailInput, ThreadRow, World } from "./world";

export type TaskInput = z.input<typeof taskSchema> & { movedAgoMs?: number };
export type DeskInput = z.input<typeof deskSchema>;

export const BOTS = [
  { key: "personal", name: "Personal Bot" },
  { key: "home", name: "Home Bot" },
  { key: "bricks", name: "Bricks Bot" },
  { key: "work", name: "Work Bot" },
  { key: "erbareeq", name: "ERBareeq Bot" },
  { key: "store", name: "Store Bot" },
  { key: "lab", name: "Lab Bot" },
  { key: "security", name: "Security Bot" },
] as const;
export type BotKey = typeof BOTS[number]["key"];

export function coordinator(key: BotKey): string {
  return `thr_coord_${key}`;
}

let serial = 0;
function nextId(prefix: string): string {
  serial += 1;
  return `${prefix}_${String(serial).padStart(4, "0")}`;
}

export interface Asked { text: string; at: number; full?: string; from?: string }

function askOf(bot: BotKey, asked: Asked | undefined, seq: number): TaskInput["ask"] {
  if (!asked) return undefined;
  return { excerpt: asked.text, ...(asked.full ? { full: asked.full } : {}), label: `${asked.from ?? "You asked"}, ${stamp(asked.at)}`, ref: { threadId: coordinator(bot), seq }, at: asked.at };
}

interface Common { bot: BotKey; title: string; outcome?: string; asked?: Asked; age?: number; id?: string; tags?: string[] }

function base({ bot, title, outcome, asked, age, id, tags }: Common): Omit<TaskInput, "displayState" | "line"> {
  const taskId = id ?? nextId("ptask");
  const opened = age ?? (asked ? NOW - asked.at : HOUR);
  return { id: taskId, bot, title, outcome: outcome ?? title, ask: askOf(bot, asked, 1000 + serial), ageMs: opened, movedAgoMs: Math.min(opened, 2 * MINUTE), conversationThreadId: `thr_work_${taskId}`, tags: tags ?? [], origin: "verified", observedAt: NOW };
}

export const tasks = {
  working(common: Common, step: string, extra: { runningFor?: number; progress?: { done: string; now: string }; alert?: "quiet" | "stuck" } = {}): TaskInput {
    const running = extra.runningFor ?? common.age ?? 10 * MINUTE;
    return { ...base(common), displayState: "working", line: step, runningForMs: running,
      ...(extra.progress ? { progress: { ...extra.progress, forMs: 2 * MINUTE } } : {}),
      ...(extra.alert ? { alert: { kind: extra.alert, forMs: Math.min(running, 25 * MINUTE) } } : {}) };
  },
  retrying(common: Common): TaskInput {
    return { ...base(common), displayState: "working", line: "Retrying after an error" };
  },
  waitingOnBot(common: Common, reason: string, wakeAt?: number, untouched?: number): TaskInput {
    const wake = wakeAt !== undefined ? ` · wakes ${clock(wakeAt)}` : " · no wake set";
    return { ...base(common), displayState: "waiting", line: `Waiting for the bot: ${reason}${wake}${untouched ? ` · untouched ${span(untouched)}` : ""}`, waitFor: "the bot", ...(wakeAt !== undefined ? { wakeAt } : {}), ...(untouched ? { movedAgoMs: untouched } : {}) };
  },
  waitingOnSomeone(common: Common, reason: string, on: string | undefined, wakeAt?: number): TaskInput {
    const wake = wakeAt !== undefined ? ` · wakes ${clock(wakeAt)}` : " · no wake set";
    return { ...base(common), displayState: "waiting", line: `Waiting for someone else: ${reason}${wake}`, waitFor: "someone else", ...(on ? { waitOn: on } : {}), ...(wakeAt !== undefined ? { wakeAt } : {}) };
  },
  waitingOnRun(common: Common, reason: string): TaskInput {
    return { ...base(common), displayState: "waiting", line: `Waiting for the bot: ${reason} · wakes on automation-run`, waitFor: "the bot" };
  },
  overdue(common: Common, dueAt: number): TaskInput {
    return { ...base(common), displayState: "waiting", line: `Wake was due ${clock(dueAt)} · overdue ${span(NOW - dueAt)}`, waitFor: "the bot", wakeAt: dueAt };
  },
  machineOff(common: Common, seen: number): TaskInput {
    return { ...base(common), displayState: "waiting", line: `Its machine is off · seen ${span(seen)} ago; work resumes when it is back` };
  },
  queued(common: Common, reason: string, retryAt: number): TaskInput {
    return { ...base(common), displayState: "waiting", line: `Queued: ${reason} · retry ${clock(retryAt)}`, retryAt, wakeAt: retryAt };
  },
  notStarted(common: Common): TaskInput {
    return { ...base(common), displayState: "waiting", line: "Filed. Not started.", conversationThreadId: null };
  },
  withTheBot(common: Common, step: string): TaskInput {
    return { ...base(common), displayState: "waiting", line: `With the bot: ${step}`, conversationThreadId: null };
  },
  notChecked(common: Common): TaskInput {
    return { ...base(common), displayState: "waiting", line: "Worker finished; the result is not checked yet" };
  },
  checkFailed(common: Common, passed: number, total: number, since: number): TaskInput {
    return { ...base(common), displayState: "waiting", line: `A check failed (${passed} of ${total} passed); the bot hasn't acted on it · since ${shortDay(since)}` };
  },
  checking(common: Common, passed: number, total: number): TaskInput {
    return { ...base(common), displayState: "waiting", line: `Checking ${passed} of ${total} criteria` };
  },
  needs(common: Common, question: string, askedAt: number, extra: { options?: string[]; interactionId?: string; recommended?: string; consequence?: string; seq?: number } = {}): TaskInput {
    const row = base(common);
    return { ...row, displayState: "needs", line: question, waitFor: "you",
      needs: { threadId: extra.interactionId ? row.conversationThreadId ?? coordinator(common.bot) : coordinator(common.bot), interactionId: extra.interactionId ?? "", question, askedAt, ...(extra.seq !== undefined || !extra.interactionId ? { messageSeq: extra.seq ?? 2000 + serial } : {}), ...(extra.options ? { options: extra.options } : {}), ...(extra.recommended ? { recommended: extra.recommended } : {}), ...(extra.consequence ? { consequence: extra.consequence } : {}) } };
  },
  notNow(common: Common, reason: string, parkedAt: number, wakeAt?: number): TaskInput {
    return { ...base(common), displayState: "waiting", line: `Later (you chose Not now ${stamp(parkedAt)}): ${reason}`, waitFor: "you", later: { reason: "not-now", at: parkedAt }, ...(wakeAt !== undefined ? { wakeAt } : {}) };
  },
  answered(common: Common, reason: string, answeredAt: number, wakeAt?: number): TaskInput {
    return { ...base(common), displayState: "waiting", line: `You answered ${stamp(answeredAt)} · bot to follow up: ${reason}`, waitFor: "the bot", later: { reason: "answered", at: answeredAt, threadId: coordinator(common.bot), messageSeq: 3000 + serial }, ...(wakeAt !== undefined ? { wakeAt } : {}) };
  },
  done(common: Common, completedAt: number, line?: string): TaskInput {
    return { ...base({ ...common, age: common.age ?? NOW - completedAt + 40 * MINUTE }), displayState: "done", line: line ?? `Done ${shortDay(completedAt)}`, completedAt };
  },
  closedByYou(common: Common, completedAt: number): TaskInput {
    return tasks.done(common, completedAt, `Closed by Salem ${shortDay(completedAt)}`);
  },
  quietClose(common: Common, completedAt: number): TaskInput {
    return tasks.done(common, completedAt, `Closed after a quiet day ${shortDay(completedAt)}`);
  },
  unconfirmed(common: Common, completedAt: number): TaskInput {
    return tasks.done({ ...common, tags: ["Owner review"] }, completedAt, "Recorded done · owner review needed");
  },
  cancelled(common: Common, completedAt: number): TaskInput {
    return tasks.done(common, completedAt, "Cancelled");
  },
  stopped(common: Common, completedAt: number, halted: number): TaskInput {
    return tasks.done(common, completedAt, `Stopped by Salem · ${halted} ${halted === 1 ? "worker" : "workers"} halted`);
  },
};

export type DeskStatus = DeskInput["status"];

export function desk(bot: BotKey, kind: DeskInput["desk"], who: string, subject: string, status: DeskStatus, extra: { updated?: number; quiet?: number | null; waitingOn?: string; wakeAt?: number; deadline?: number; deferredReason?: string; later?: number } = {}): DeskInput {
  const id = nextId("desk");
  const label = { chat: "Chat", whatsapp: "WhatsApp", bricks: "Bricks", campaign: "Campaign", redemption: "Redemption", feedback: "Feedback" }[kind];
  const updatedAt = ago(extra.updated ?? 5 * MINUTE);
  return { id, desk: kind, label, key: id, threadId: `thr_${id}`, title: [label, who, subject].filter(Boolean).join(" · "), status, updatedAt,
    quietSince: extra.quiet === null ? null : ago(extra.quiet ?? extra.updated ?? 5 * MINUTE), deadline: extra.deadline ?? null, deferredReason: extra.deferredReason ?? null, waitingOn: extra.waitingOn ?? null,
    ...(extra.wakeAt !== undefined ? { wake: { at: extra.wakeAt, state: "pending" } } : {}), ...(extra.later !== undefined ? { later: extra.later } : {}) };
}

export interface Worker { title: string; state: "running" | "idle" | "error"; started: number; ended?: number; model?: string; effort?: string }

export interface BotContent { tasks?: TaskInput[]; desks?: DeskInput[]; unlinked?: { title: string; started: number }[]; chatting?: boolean; lastReply?: number; startedByYou?: { title: string; active: number }[] }

export interface Sketch {
  focus: BotKey;
  bots: Partial<Record<BotKey, BotContent>>;
  workers?: Record<string, Worker[]>;
  needs?: NeedsInput[];
  notNow?: { key: string; at: number }[];
}

function quietBot(key: BotKey): BotContent {
  return { tasks: [tasks.done({ bot: key, title: "Weekly check" }, ago(26 * HOUR))], lastReply: ago(4 * HOUR) };
}

function sidebarThread(fields: Pick<PluginSidebarThread, "id" | "projectId" | "displayTitle" | "latestAttentionAt"> & Partial<PluginSidebarThread>): PluginSidebarThread {
  return {
    title: fields.displayTitle, titleFallback: null, parentThreadId: null, lifecycleOwnerThreadId: null, parentNotifications: "auto", sourceThreadId: null, sectionId: null, originKind: null, originPluginId: null,
    providerId: "claude-code", status: "idle", runtimeStatus: "idle", queuedWork: "none", hasPendingInteraction: false, activity: { workflows: 0, backgroundAgents: 0, backgroundCommands: 0, planMode: 0, goals: 0 },
    indicator: "none", indicatorLabel: null, isUnread: false, isPinned: false, pinnedAt: null, pinSortKey: null, isArchived: false, archivedAt: null, href: `/threads/${fields.id}`, isHidden: false, environment: null, host: null,
    createdAt: fields.latestAttentionAt - DAY, updatedAt: fields.latestAttentionAt, lastReadAt: fields.latestAttentionAt,
    ...fields,
  };
}

export function need(bot: BotKey, text: string, askedAt: number, extra: Partial<NeedsInput> = {}): NeedsInput {
  return { id: nextId("need"), bot, kind: "decision", text, due: null, state: "open", snoozeUntil: null, source: { threadId: coordinator(bot) }, key: null, createdAt: new Date(askedAt).toISOString(), closedAt: null, reminders: 0, ...extra };
}

export function buildWorld(sketch: Sketch): World {
  const bots: BotTasksInput["bots"] = [];
  const sidebarThreads: PluginSidebarThread[] = [];
  const threadRows: ThreadRow[] = [];
  const taskDetails: Record<string, TaskDetailInput> = {};
  BOTS.forEach(({ key, name }, order) => {
    const content = sketch.bots[key] ?? quietBot(key);
    const unlinked = (content.unlinked ?? []).map(worker => ({ threadId: nextId("thr_unlinked"), title: worker.title, started: worker.started }));
    bots.push({ key, name, order, coordinatorThreadId: coordinator(key), tasksV2: true, tasks: content.tasks ?? [], desks: content.desks ?? [], unlinked: unlinked.map(({ threadId, title }) => ({ threadId, title })) });
    for (const worker of unlinked) threadRows.push({ id: worker.threadId, title: worker.title, status: "active", createdAt: ago(worker.started), updatedAt: NOW });
    const lastReply = content.lastReply ?? ago(20 * MINUTE);
    sidebarThreads.push(sidebarThread({ id: coordinator(key), projectId: `proj_${key}`, displayTitle: name, latestAttentionAt: lastReply, isPinned: true, status: content.chatting ? "active" : "idle" }));
    threadRows.push({ id: coordinator(key), title: name, status: content.chatting ? "active" : "idle", createdAt: ago(3 * DAY), updatedAt: lastReply });
    for (const chat of content.startedByYou ?? []) sidebarThreads.push(sidebarThread({ id: nextId("thr_yours"), projectId: `proj_${key}`, displayTitle: chat.title, latestAttentionAt: ago(chat.active) }));
  });
  for (const [taskId, workers] of Object.entries(sketch.workers ?? {})) {
    const rows = workers.map(worker => ({ worker, threadId: nextId("thr_worker") }));
    taskDetails[taskId] = { taskId, workers: rows.map(({ worker, threadId }) => ({ threadId, title: worker.title, model: worker.model ?? "claude-code/claude-opus-5-5", effort: worker.effort ?? "medium", state: worker.state === "running" ? "running" : worker.state })) };
    for (const { worker, threadId } of rows) threadRows.push({ id: threadId, title: worker.title, status: worker.state === "running" ? "active" : worker.state, createdAt: ago(worker.started), updatedAt: worker.state === "running" ? NOW : ago(worker.ended ?? 0) });
  }
  return {
    now: NOW,
    tasks: { bots, needs: [], notFiled: [], observedAt: NOW, notNow: sketch.notNow ?? [] },
    needs: sketch.needs ?? [],
    roster: { bots: BOTS.map(({ key, name }) => ({ key, name, current: coordinator(key), projectId: `proj_${key}`, projects: [], hostId: "host_harness", providerId: "claude-code", model: "claude-opus-5-5", rollover: null })) },
    sidebarThreads,
    projects: BOTS.map(({ key, name }) => ({ id: `proj_${key}`, name })),
    taskDetails,
    threadRows,
    threadActions: [],
    calls: [],
  };
}

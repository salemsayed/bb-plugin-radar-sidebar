import { z } from "zod";
import type { BotTasks, BotTasksOutput, DisplayState, TaskRow } from "./tasks-v2-types";

/**
 * The Bots view's read of orchestrator-mode `bot_tasks` (tasks v2), and the
 * pure rules that fold it into what the sidebar shows. Nothing here acts on a
 * task: rows only open bb's own thread route.
 */

export const DISPLAY_STATES = ["needs", "working", "queued", "offline", "retrying", "waiting", "overdue", "checking", "ready", "stopped", "done", "cancelled"] as const satisfies readonly DisplayState[];

/** A state a newer core adds still shows, as open work, rather than vanishing. */
const displayState = z.string().transform((state): DisplayState =>
  (DISPLAY_STATES as readonly string[]).includes(state) ? state as DisplayState : "ready");

const taskSchema = z.object({
  id: z.string(),
  bot: z.string().default(""),
  title: z.string().default(""),
  outcome: z.string().optional(),
  ask: z.object({ excerpt: z.string(), full: z.string().optional(), label: z.string(), ref: z.object({ threadId: z.string(), seq: z.number() }), at: z.number().optional() }).optional(),
  displayState,
  line: z.string().default(""),
  waitFor: z.string().optional(),
  ageMs: z.number().nonnegative().default(0),
  completedAt: z.number().optional(),
  wakeAt: z.number().optional(),
  retryAt: z.number().optional(),
  conversationThreadId: z.string().nullable().default(null),
  needs: z.object({ threadId: z.string(), interactionId: z.string(), question: z.string(), options: z.array(z.string()).optional(), askedAt: z.number().optional(), messageSeq: z.number().optional() }).optional(),
  later: z.object({ reason: z.enum(["answered", "not-now"]).catch("not-now"), at: z.number(), threadId: z.string().optional(), messageSeq: z.number().optional() }).optional(),
  laterNote: z.object({ at: z.number(), text: z.string() }).optional(),
  tags: z.array(z.string()).default([]),
  origin: z.enum(["verified", "unverified", "imported"]).catch("unverified"),
  observedAt: z.number().optional(),
});

export const deskSchema = z.object({
  id: z.string(), desk: z.enum(["chat", "bricks", "whatsapp", "campaign", "redemption", "feedback"]),
  label: z.string(), key: z.string(), threadId: z.string().nullable(), title: z.string(),
  status: z.enum(["draft", "blocked", "working", "info", "done", "deferred"]),
  updatedAt: z.number(), quietSince: z.number().nullable(), deadline: z.number().nullable(), deferredReason: z.string().nullable(),
  later: z.number().optional(),
});
export type BotDesk = z.infer<typeof deskSchema>;

export const DESK_MARKS: Record<BotDesk["status"], string> = { draft: "🟢", blocked: "🟠", working: "⏳", info: "⚪", done: "✅", deferred: "⏸" };
const DESK_RANK: Record<BotDesk["status"], number> = { draft: 0, blocked: 0, working: 1, info: 2, deferred: 3, done: 4 };
const LEADING_MARKS = /^(?:(?:🟢|🟠|🟡|🔴|⏳|⚪|✅|⏸|⚠)\uFE0F?\s*)+/u;
const THREAD_REF = /(?:\s+(?:on|in|at|from|see))?\s*@thread:\S+/g;

export function needsYou(desk: Pick<BotDesk, "status" | "later">): boolean {
  return desk.later === undefined && (desk.status === "draft" || desk.status === "blocked");
}

export function sortDesks(desks: readonly BotDesk[]): BotDesk[] {
  return [...desks].sort((a, b) => DESK_RANK[a.status] - DESK_RANK[b.status]
    || (needsYou(a) ? a.updatedAt - b.updatedAt : b.updatedAt - a.updatedAt));
}

export interface DeskBadge { count: number; tone: "blocked" | "draft" }

export function deskBadge(desks: readonly BotDesk[]): DeskBadge | null {
  const waiting = desks.filter(needsYou);
  if (!waiting.length) return null;
  return { count: waiting.length, tone: waiting.some(desk => desk.status === "blocked") ? "blocked" : "draft" };
}

function cleanDeskText(text: string): string {
  return text.replace(THREAD_REF, "").replace(/\s+/g, " ").trim().replace(LEADING_MARKS, "").trim();
}

export function deskTitle(desk: Pick<BotDesk, "label" | "title">): string {
  const label = cleanDeskText(desk.label);
  const title = cleanDeskText(desk.title);
  if (!title) return label;
  if (!label || title.toLowerCase().startsWith(label.toLowerCase())) return title;
  return `${label}${title.startsWith("#") ? " " : " · "}${title}`;
}

const count = z.number().int().nonnegative().default(0);
const botSchema = z.object({
  key: z.string(),
  name: z.string(),
  order: z.number().default(0),
  color: z.string().optional(),
  faceUrl: z.string().optional(),
  coordinatorThreadId: z.string(),
  tasksV2: z.boolean().default(false),
  summary: z.object({ needs: count, working: count, queued: count, offline: count, waiting: count, done: count, notStarted: count }).partial().default({}),
  // One malformed row must not blank a whole bot: bad rows are dropped one by one.
  tasks: z.array(z.unknown()).default([]).transform(rows => rows.flatMap(row => {
    const parsed = taskSchema.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  })),
  desks: z.array(deskSchema).optional().default([]),
  unlinked: z.array(z.object({ threadId: z.string(), title: z.string().default("") })).default([]),
});

export const botTasksSchema = z.object({
  bots: z.array(botSchema.transform(bot => ({ ...bot, unlinked: bot.unlinked.filter(worker => !bot.desks.some(desk => desk.threadId === worker.threadId)) }))),
  needs: z.array(z.object({ bot: z.string(), taskId: z.string(), threadId: z.string(), interactionId: z.string(), question: z.string(), askedAt: z.number().optional(), messageSeq: z.number().optional() })).default([]),
  notFiled: z.array(z.object({ threadId: z.string(), title: z.string().default(""), suggestedBot: z.string().optional() })).default([]),
  observedAt: z.number().default(() => Date.now()),
  notNow: z.array(z.object({ key: z.string(), at: z.number() })).optional(),
});

export type BotTasksData = z.infer<typeof botTasksSchema>;
export type BotTasksBot = BotTasksData["bots"][number];
export type BotTaskRow = BotTasksBot["tasks"][number];

// The parsed shapes are the shared contract types, with defaults filled in.
type Assignable<A, B> = A extends B ? true : false;
const contractCheck: [Assignable<BotTaskRow, Omit<TaskRow, "observedAt"> & { observedAt?: number }>, Assignable<BotTasksData["needs"], BotTasksOutput["needs"]>] = [true, true];
void contractCheck;
export type { BotTasks };

export const STATE_LABEL: Record<DisplayState, string> = {
  needs: "Needs you",
  working: "Working",
  queued: "Queued",
  offline: "Offline",
  retrying: "Retrying",
  waiting: "Waiting",
  overdue: "Overdue",
  checking: "To check",
  ready: "Not started",
  stopped: "Stopped",
  done: "Done",
  cancelled: "Cancelled",
};

/** Open work that is always shown, most urgent first. */
const ACTIVE_ORDER: readonly DisplayState[] = ["overdue", "offline", "retrying", "working", "checking", "queued", "ready"];
const CLOSED: readonly DisplayState[] = ["done", "stopped", "cancelled"];
/** Waiting rows shown before the rest fold behind "n more waiting". */
export const WAITING_SHOWN = 3;

export function isClosed(state: DisplayState): boolean {
  return CLOSED.includes(state);
}

/** Same local calendar day: a task finished yesterday evening is not "Done today". */
export function isSameLocalDay(a: number, b: number): boolean {
  const x = new Date(a);
  const y = new Date(b);
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
}

/** The one state a bot wears on its card: its most urgent open work, else quiet. */
export type BotMood = "needs" | "overdue" | "offline" | "working" | "checking" | "queued" | "ready" | "waiting" | "quiet";
const MOOD_ORDER: readonly Exclude<BotMood, "quiet">[] = ["needs", "overdue", "offline", "working", "checking", "queued", "ready", "waiting"];

/** Most urgent open state first, in the summary's own order; work without a task counts as working. */
export function botMood(tasks: readonly BotTaskRow[], withoutTask = 0): BotMood {
  const has = (state: DisplayState) => tasks.some(task => task.displayState === state);
  for (const mood of MOOD_ORDER) {
    if (has(mood) || (mood === "working" && (has("retrying") || withoutTask > 0))) return mood;
  }
  return "quiet";
}

export interface BotLayout {
  bot: BotTasksBot;
  mood: BotMood;
  needs: BotTaskRow[];
  active: BotTaskRow[];
  waitingShown: BotTaskRow[];
  waitingFolded: BotTaskRow[];
  /** Finished, stopped or cancelled today (local), newest first. */
  closedToday: BotTaskRow[];
  /**
   * Closed before today, newest first: the rest of the week the core sends, so
   * nothing finished vanishes from under its bot (Salem, thr_g9gsfjxfyx). A
   * closed row the core dated nowhere lands here too rather than nowhere.
   */
  closedEarlier: BotTaskRow[];
  /** Nothing needs Salem, nothing is moving and nothing waits. */
  quiet: boolean;
  /** Most urgent first; the header drops whole trailing parts when it runs out of room. */
  summaryParts: string[];
  summary: string;
}

export function layoutBot(bot: BotTasksBot, now: number): BotLayout {
  const needs = bot.tasks.filter(task => task.displayState === "needs");
  const active = ACTIVE_ORDER.flatMap(state => bot.tasks.filter(task => task.displayState === state));
  const waiting = bot.tasks.filter(task => task.displayState === "waiting");
  const closed = bot.tasks.filter(task => isClosed(task.displayState)).sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
  const closedToday = closed.filter(task => task.completedAt !== undefined && isSameLocalDay(task.completedAt, now));
  const closedEarlier = closed.filter(task => !closedToday.includes(task));
  // Workers the bot runs without a task (a job relayed from another thread) count too (Salem, 2026-10-29).
  const quiet = needs.length + active.length + waiting.length + bot.unlinked.length === 0;
  const summaryParts = summaryLine(bot.tasks, closedToday.length, bot.unlinked.length);
  return {
    bot,
    mood: botMood(bot.tasks, bot.unlinked.length),
    needs,
    active,
    waitingShown: waiting.slice(0, WAITING_SHOWN),
    waitingFolded: waiting.slice(WAITING_SHOWN),
    closedToday,
    closedEarlier,
    quiet,
    summaryParts,
    summary: summaryParts.join(" · "),
  };
}

function summaryLine(tasks: readonly BotTaskRow[], doneToday: number, withoutTask = 0): string[] {
  const n = (states: readonly DisplayState[]) => tasks.filter(task => states.includes(task.displayState)).length;
  const parts: string[] = [];
  const add = (value: number, label: string) => { if (value > 0) parts.push(`${value} ${label}`); };
  add(n(["needs"]), "for you");
  add(n(["overdue"]), "overdue");
  add(n(["offline"]), "offline");
  add(n(["working", "retrying"]) + withoutTask, "working");
  // A result waiting for the bot's check is not work in progress (Salem's status pass, 2026-10-29).
  add(n(["checking"]), "to check");
  add(n(["queued"]), "queued");
  // A legacy "ready" task is filed but nothing holds it in a queue.
  add(n(["ready"]), "not started");
  add(n(["waiting"]), "waiting");
  if (parts.length > 0) return parts;
  return doneToday > 0 ? ["quiet", `${doneToday} done today`] : ["quiet"];
}

export interface NeedRow {
  key: string;
  bot: BotTasksBot | null;
  botKey: string;
  taskId: string;
  /** The exact thread holding the pending interaction (worker or coordinator), else the task's conversation. */
  threadId: string | null;
  question: string;
  taskTitle: string;
  /** The bot's suggested answers for this ask, when the task carries them; each one opens the thread with it typed in. */
  options: string[];
}

/**
 * Every decision across bots: the server's interaction-level items first, then
 * any task in the needs state the server listed without one, so a plain
 * Needs-you task never disappears for lack of an interaction.
 */
export function needRows(data: BotTasksData): NeedRow[] {
  const bots = new Map(data.bots.map(bot => [bot.key, bot]));
  const tasks = new Map(data.bots.flatMap(bot => bot.tasks.map(task => [task.id, task] as const)));
  const rows: NeedRow[] = data.needs.map(item => ({
    key: `${item.taskId}:${item.interactionId}`,
    bot: bots.get(item.bot) ?? null,
    botKey: item.bot,
    taskId: item.taskId,
    threadId: item.threadId,
    question: item.question,
    taskTitle: tasks.get(item.taskId)?.title ?? "",
    options: optionsFor(tasks.get(item.taskId), item.interactionId),
  }));
  const listed = new Set(data.needs.map(item => item.taskId));
  for (const bot of data.bots) {
    for (const task of bot.tasks) {
      if (task.displayState !== "needs" || listed.has(task.id)) continue;
      rows.push({
        key: `${task.id}:${task.needs?.interactionId ?? "task"}`,
        bot,
        botKey: bot.key,
        taskId: task.id,
        threadId: task.needs?.threadId ?? task.conversationThreadId ?? bot.coordinatorThreadId,
        question: task.needs?.question || task.line || task.title,
        taskTitle: task.title,
        options: answerOptions(task.needs?.options),
      });
    }
  }
  const order = (key: string) => bots.get(key)?.order ?? Number.MAX_SAFE_INTEGER;
  return rows.map((row, index) => ({ row, index }))
    .sort((a, b) => order(a.row.botKey) - order(b.row.botKey) || a.index - b.index)
    .map(({ row }) => row);
}

/** A task's suggested answers belong to its own pending interaction only, never to another ask on the same task. */
function optionsFor(task: BotTaskRow | undefined, interactionId: string): string[] {
  if (!task?.needs || task.needs.interactionId !== interactionId) return [];
  return answerOptions(task.needs.options);
}

/** Answers as buttons: trimmed, blanks and repeats dropped, at most three, the same on every path an ask arrives by. */
export function answerOptions(options: readonly string[] | undefined): string[] {
  return [...new Set((options ?? []).map(option => option.trim()).filter(Boolean))].slice(0, 3);
}

export function orderedBots(data: BotTasksData): BotTasksBot[] {
  return data.bots.map((bot, index) => ({ bot, index }))
    .sort((a, b) => a.bot.order - b.bot.order || a.index - b.index)
    .map(({ bot }) => bot);
}

/** When the row was true: the task's own observation, else the response's. */
export function rowStartedAt(task: BotTaskRow, observedAt: number): number {
  return (task.observedAt ?? observedAt) - task.ageMs;
}

const doneDateFormatter = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });
const SERVER_DONE_DATE = /^Done (?:\d{4}-\d{2}-\d{2}|\d{1,2} [A-Z][a-z]{2})\b/;

/**
 * A core writes "Done YYYY-MM-DD" from a UTC date (older) or "Done 29 Oct" in
 * Cairo time (current), so a task finished after local midnight could read as
 * another day. The row's completedAt timestamp is the truth: its date is
 * re-rendered in this device's local time, and today reads "Done today" (the
 * stress test found every row of today saying "Done 29 Oct": only the older
 * form was recognised).
 */
export function localizeDoneLine(task: Pick<BotTaskRow, "line" | "completedAt">, now: number): string {
  if (task.completedAt === undefined || !SERVER_DONE_DATE.test(task.line)) return task.line;
  const day = isSameLocalDay(task.completedAt, now) ? "today" : doneDateFormatter.format(new Date(task.completedAt));
  return task.line.replace(SERVER_DONE_DATE, `Done ${day}`);
}

/**
 * The core's `task_detail`: a task's workers (its attempts), each with the
 * model and effort it ran on and its thread's live state. Checks and the wait
 * are not read here. An older core without the method is handled by the hook.
 */
export const taskDetailSchema = z.object({
  taskId: z.string(),
  outcome: z.string().default(""),
  checks: z.array(z.object({
    status: z.string(),
    verdict: z.string().nullable().optional(),
  })).default([]),
  workers: z.array(z.object({
    threadId: z.string(),
    title: z.string().default(""),
    model: z.string().nullable().default(null),
    effort: z.string().nullable().default(null),
    state: z.string().default("unknown"),
  })).default([]),
  history: z.array(z.object({ threadId: z.string(), until: z.number() })).default([]),
  conversation: z.object({ threadId: z.string(), since: z.number() }).nullable().default(null),
});
export type TaskDetail = z.infer<typeof taskDetailSchema>;

/** What `threads.list` says about a worker's thread, when it answers: its times and whether it still runs. */
export interface AttemptThread { id: string; title?: string | null; status?: string; createdAt?: number; updatedAt?: number }

export interface Attempt {
  threadId: string;
  title: string;
  /** "codex/gpt-6.1-sol" when the core read what the worker ran on, else null. */
  model: string | null;
  effort: string | null;
  /** The thread's status (running, idle, …) from the list, else the core's word, else "unknown". */
  state: string;
  startedAt: number | null;
  /** The thread's last activity: when an attempt that no longer runs ended. */
  endedAt: number | null;
  /** The attempt a tap on the task row opens: the task's conversation. */
  latest: boolean;
}

/**
 * A task's attempts, newest first. The core lists workers in its own order
 * (the executor, then every worker ever started); the threads' creation times
 * put them in order, and those without a time follow, the latest leading. A task whose
 * detail lists no worker still has its conversation as its one known attempt.
 * The core sends no per-attempt result line: the thread's state stands in.
 */
export function taskAttempts(task: Pick<BotTaskRow, "conversationThreadId">, detail: TaskDetail | null, threads: readonly AttemptThread[] = []): Attempt[] {
  const byId = new Map(threads.map(thread => [thread.id, thread]));
  const latest = task.conversationThreadId;
  const rows = (detail?.workers ?? []).map((worker, index) => {
    const thread = byId.get(worker.threadId);
    const running = (thread?.status ?? worker.state) === "running";
    return { index, attempt: {
      threadId: worker.threadId,
      title: worker.title || thread?.title || "Worker",
      model: worker.model,
      effort: worker.effort,
      state: thread?.status ?? worker.state,
      startedAt: thread?.createdAt ?? null,
      endedAt: running ? null : thread?.updatedAt ?? null,
      latest: worker.threadId === latest,
    } satisfies Attempt };
  });
  if (rows.length === 0 && latest) {
    const thread = byId.get(latest);
    const running = thread?.status === "running";
    rows.push({ index: 0, attempt: { threadId: latest, title: thread?.title || "Worker", model: null, effort: null, state: thread?.status ?? "unknown",
      startedAt: thread?.createdAt ?? null, endedAt: running ? null : thread?.updatedAt ?? null, latest: true } });
  }
  // Timed attempts first, newest first; then untimed ones, the latest leading and the rest in the
  // core's reverse order. One key per group keeps the order total when threads.list answers only some.
  const rank = (row: typeof rows[number]) => row.attempt.startedAt !== null ? 0 : row.attempt.latest ? 1 : 2;
  return rows.sort((a, b) => rank(a) - rank(b)
    || (rank(a) === 0 ? b.attempt.startedAt! - a.attempt.startedAt! : 0)
    || b.index - a.index).map(row => row.attempt);
}

/** "codex/gpt-6.1-sol" reads as "gpt-6.1-sol": the provider is noise in a 12px line. */
export function shortModel(model: string | null): string {
  if (!model) return "";
  const slash = model.lastIndexOf("/");
  return slash >= 0 ? model.slice(slash + 1) : model;
}

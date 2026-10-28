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
  displayState,
  line: z.string().default(""),
  waitFor: z.string().optional(),
  ageMs: z.number().nonnegative().default(0),
  completedAt: z.number().optional(),
  conversationThreadId: z.string().nullable().default(null),
  needs: z.object({ threadId: z.string(), interactionId: z.string(), question: z.string(), options: z.array(z.string()).optional() }).optional(),
  tags: z.array(z.string()).default([]),
  origin: z.enum(["verified", "unverified", "imported"]).catch("unverified"),
  observedAt: z.number().optional(),
});

const count = z.number().int().nonnegative().default(0);
const botSchema = z.object({
  key: z.string(),
  name: z.string(),
  order: z.number().default(0),
  color: z.string().optional(),
  faceUrl: z.string().optional(),
  coordinatorThreadId: z.string(),
  tasksV2: z.boolean().default(false),
  summary: z.object({ needs: count, working: count, queued: count, offline: count, waiting: count, done: count }).partial().default({}),
  // One malformed row must not blank a whole bot: bad rows are dropped one by one.
  tasks: z.array(z.unknown()).default([]).transform(rows => rows.flatMap(row => {
    const parsed = taskSchema.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  })),
  unlinked: z.array(z.object({ threadId: z.string(), title: z.string().default("") })).default([]),
});

export const botTasksSchema = z.object({
  bots: z.array(botSchema),
  needs: z.array(z.object({ bot: z.string(), taskId: z.string(), threadId: z.string(), interactionId: z.string(), question: z.string() })).default([]),
  notFiled: z.array(z.object({ threadId: z.string(), title: z.string().default(""), suggestedBot: z.string().optional() })).default([]),
  observedAt: z.number().default(() => Date.now()),
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
  checking: "Checking",
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

export interface BotLayout {
  bot: BotTasksBot;
  needs: BotTaskRow[];
  active: BotTaskRow[];
  waitingShown: BotTaskRow[];
  waitingFolded: BotTaskRow[];
  /** Finished, stopped or cancelled today (local), newest first. Older closed work is not listed. */
  closedToday: BotTaskRow[];
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
  const closedToday = bot.tasks
    .filter(task => isClosed(task.displayState) && task.completedAt !== undefined && isSameLocalDay(task.completedAt, now))
    .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
  const quiet = needs.length + active.length + waiting.length === 0;
  const summaryParts = summaryLine(bot.tasks, closedToday.length);
  return {
    bot,
    needs,
    active,
    waitingShown: waiting.slice(0, WAITING_SHOWN),
    waitingFolded: waiting.slice(WAITING_SHOWN),
    closedToday,
    quiet,
    summaryParts,
    summary: summaryParts.join(" · "),
  };
}

function summaryLine(tasks: readonly BotTaskRow[], doneToday: number): string[] {
  const n = (states: readonly DisplayState[]) => tasks.filter(task => states.includes(task.displayState)).length;
  const parts: string[] = [];
  const add = (value: number, label: string) => { if (value > 0) parts.push(`${value} ${label}`); };
  add(n(["needs"]), "for you");
  add(n(["overdue"]), "overdue");
  add(n(["offline"]), "offline");
  add(n(["working", "checking", "retrying"]), "working");
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
      });
    }
  }
  const order = (key: string) => bots.get(key)?.order ?? Number.MAX_SAFE_INTEGER;
  return rows.map((row, index) => ({ row, index }))
    .sort((a, b) => order(a.row.botKey) - order(b.row.botKey) || a.index - b.index)
    .map(({ row }) => row);
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
const SERVER_DONE_DATE = /^Done \d{4}-\d{2}-\d{2}\b/;

/**
 * A core writes "Done YYYY-MM-DD" from a UTC date, so a task finished after
 * local midnight read as the day before. The row's completedAt timestamp is
 * the truth: its date is re-rendered in this device's local time.
 */
export function localizeDoneLine(task: Pick<BotTaskRow, "line" | "completedAt">, now: number): string {
  if (task.completedAt === undefined || !SERVER_DONE_DATE.test(task.line)) return task.line;
  const day = isSameLocalDay(task.completedAt, now) ? "today" : doneDateFormatter.format(new Date(task.completedAt));
  return task.line.replace(SERVER_DONE_DATE, `Done ${day}`);
}

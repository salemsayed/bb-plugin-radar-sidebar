import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { isClosed, isSameLocalDay, needsYou, sortDesks, type Attempt, type BotDesk, type BotTaskRow, type BotTasksBot } from "@/lib/botTasks";
import { elapsed } from "../elapsed";
import { isQuestionRow, isStepAsk, needsTopic, questionTopic } from "../questions";
import { stageText, stageTitle } from "../stage";
import { shortAgo } from "../time";
import type { WorkerSnapshot } from "../useDispatchWorkers";
import { capitalFirst, cardOrder, plainNote, plainQueue, plainWorkerTitle, taskHeadline } from "../workText";
import { deskParts, deskStatus, taskStatus, type Group, type Status } from "./status";
import type { IdleWait } from "./taskWords";

export interface TaskItem { kind: "task"; key: string; title: string; status: Status; at: number; task: BotTaskRow; attempts: Attempt[]; running: Attempt[]; waitsOn: IdleWait | null; reason: string; ownsReason: boolean }
export interface DeskItem { kind: "desk"; key: string; title: string; status: Status; at: number; desk: BotDesk }
export interface ThreadItem { kind: "thread"; key: string; title: string; status: Status; at: number; threadId: string }
export type WorkItem = TaskItem | DeskItem | ThreadItem;

export interface PanelModel {
  asks: TaskItem[];
  deskAsks: DeskItem[];
  stuck: WorkItem[];
  working: WorkItem[];
  waiting: WorkItem[];
  yours: ThreadItem[];
  later: WorkItem[];
  doneToday: WorkItem[];
  doneEarlier: WorkItem[];
  workers: number | null;
  chatting: boolean;
  stepsOnly: boolean;
}

const DAY_MS = 86_400_000;
const TEST_TASK = /^TEST\b/;
const TEST_OUTCOME = /^TEST fixture\b/i;

export function detailReason(text: string): string {
  return capitalFirst(plainQueue(text).replace(/^(?:You answered [^·]{1,40} · bot to follow up|Later \(you chose Not now [^()]{1,40}\)):\s*/i, "It asked you: ").replace(/^Waiting for (?:someone else|the bot|you|a worker):\s*/i, "").replace(/^You:\s+/i, "Your ask: ").replace(/(?:\s*·\s*(?:wakes?\b[^·]*|next check [^·]+|no wake set|untou\w*[^·]*|retry\b[^·]*))+\s*$/i, "").replace(/\s*·\s*$/, "").trim());
}

function idleWait(task: BotTaskRow, bot: BotTasksBot, snapshot: WorkerSnapshot, now: number): IdleWait | null {
  if (!/\bwakes on thread-idle\b/i.test(task.line)) return null;
  const named = /\bthr_[a-z0-9]+/.exec(task.line)?.[0];
  if (named) {
    for (const other of bot.tasks) {
      const attempt = (snapshot.byTask[other.id] ?? []).find(a => a.threadId === named);
      if (!attempt) continue;
      if (attempt.state === "running") return { title: other.id === task.id ? "" : stageTitle(other.title, other.outcome), running: other.id !== task.id };
      return { title: "", running: false, idleFor: attempt.endedAt != null ? elapsed(attempt.endedAt, now) : undefined };
    }
  }
  const own = (snapshot.byTask[task.id] ?? []).filter(a => a.state !== "running").sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))[0];
  return own ? { title: "", running: false, idleFor: own.endedAt != null ? elapsed(own.endedAt, now) : undefined } : null;
}

function taskTitle(task: BotTaskRow): string {
  if (task.displayState === "needs" && task.needs?.question && /\?/.test(task.needs.question)) return needsTopic(task.needs.question, stageTitle(task.title, task.outcome));
  if (isQuestionRow(task)) return questionTopic(task.needs?.question ?? task.title);
  return stageTitle(task.title, task.outcome);
}

function distinctTitles(items: TaskItem[]): void {
  const look = (item: TaskItem) => `${item.title}\n${item.status.words}\n${item.status.note}`;
  const totals = new Map<string, number>();
  for (const item of items) totals.set(look(item), (totals.get(look(item)) ?? 0) + 1);
  const seen = new Map<string, number>();
  for (const item of items) {
    const key = look(item);
    const total = totals.get(key) ?? 1;
    if (total < 2) continue;
    const goal = item.task.outcome ? stageTitle(item.task.outcome) : "";
    if (goal && goal !== item.title && goal.toLowerCase().startsWith(item.title.toLowerCase()) && goal.length <= 70) { item.title = goal; continue; }
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    item.title = `${item.title} (${n} of ${total})`;
  }
}

function deskItem(desk: BotDesk, now: number): DeskItem {
  const { person, subject } = deskParts(desk);
  return { kind: "desk", key: `desk:${desk.id}`, title: person && !needsYou(desk) ? `${person} · ${subject}` : subject, status: deskStatus(desk, now), at: desk.updatedAt, desk };
}

function bySoonest(a: WorkItem, b: WorkItem): number {
  const wake = (item: WorkItem) => item.kind === "task" ? item.task.wakeAt ?? Infinity : Infinity;
  return wake(a) - wake(b);
}

export interface PanelInput {
  bot: BotTasksBot;
  snapshot: WorkerSnapshot;
  now: number;
  yours: readonly PluginSidebarThread[];
}

export function panelModel({ bot, snapshot, now, yours }: PanelInput): PanelModel {
  const open = cardOrder(bot.tasks.filter(task => !isClosed(task.displayState)));
  const closed = bot.tasks.filter(task => isClosed(task.displayState) && !TEST_TASK.test(task.title) && !TEST_OUTCOME.test(task.outcome ?? "")).sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
  const reasonOwner = new Map<string, string>();
  const reasonOf = (task: BotTaskRow) => detailReason(stageText(task.needs?.question ?? task.line, task.displayState === "needs"));
  const runs = (id: string) => (snapshot.byTask[id] ?? []).some(a => a.state === "running");
  for (const task of [...open, ...closed]) {
    const reason = reasonOf(task);
    const owner = reasonOwner.get(reason);
    if (!owner || runs(task.id) && !runs(owner)) reasonOwner.set(reason, task.id);
  }
  const items = [...open, ...closed].map((task): TaskItem => {
    const attempts = snapshot.byTask[task.id] ?? [];
    const running = attempts.filter(a => a.state === "running" && a.threadId !== bot.coordinatorThreadId);
    const waitsOn = running.length ? null : idleWait(task, bot, snapshot, now);
    const reason = reasonOf(task);
    return { kind: "task", key: `task:${task.id}`, title: taskTitle(task), status: taskStatus({ task, running, now, waitsOn, botName: bot.name }), at: task.completedAt ?? now - task.ageMs, task, attempts, running, waitsOn, reason, ownsReason: reasonOwner.get(reason) === task.id };
  });
  distinctTitles(items);
  const asks = items.filter(item => item.status.group === "needs");
  const askTitles = new Set(asks.map(item => stageTitle(item.task.title).toLowerCase()));
  const shadowed = (item: TaskItem) => item.task.displayState === "waiting" && item.status.group !== "later" && askTitles.has(stageTitle(item.task.title).toLowerCase());
  const visibleDesks = bot.desks.filter(desk => desk.status !== "done" && desk.status !== "info" || desk.quietSince === null || now - desk.quietSince < DAY_MS);
  const desks = sortDesks(visibleDesks).map(desk => deskItem(desk, now));
  const unlinked = bot.unlinked.map((worker): ThreadItem => ({ kind: "thread", key: `worker:${worker.threadId}`, title: taskHeadline(plainWorkerTitle(worker.title || "Worker")), status: { group: "working", mark: "working", words: "Working", note: "on its own, not filed as a task" }, at: now, threadId: worker.threadId }));
  const group = (name: Group): WorkItem[] => [...items.filter(item => item.status.group === name && !shadowed(item)), ...desks.filter(item => item.status.group === name)];
  const done = group("done").sort((a, b) => b.at - a.at);
  return {
    asks,
    deskAsks: desks.filter(item => item.status.group === "needs"),
    stuck: group("stuck"),
    working: [...group("working"), ...unlinked],
    waiting: group("waiting").sort(bySoonest),
    yours: yours.map((thread): ThreadItem => {
      const age = shortAgo(thread.latestAttentionAt, now);
      return { kind: "thread", key: `yours:${thread.id}`, title: plainNote(thread.displayTitle), status: { group: "waiting", mark: "info", words: "Your chat", note: age ? `active ${age === "now" ? "just now" : `${age} ago`}` : "" }, at: thread.latestAttentionAt, threadId: thread.id };
    }),
    later: group("later"),
    doneToday: done.filter(item => isSameLocalDay(item.at, now)),
    doneEarlier: done.filter(item => !isSameLocalDay(item.at, now)),
    workers: snapshot.known.has(bot.key) ? snapshot.byBot[bot.key]?.length ?? 0 : null,
    chatting: snapshot.chat.has(bot.key),
    stepsOnly: asks.length > 0 && asks.every(item => isStepAsk(item.task)) && !desks.some(item => item.status.group === "needs"),
  };
}

export interface Tally { group: Group; count: number; label: string }

export function panelTally(model: PanelModel): Tally[] {
  const freshAsks = model.asks.length + model.deskAsks.length;
  const parts: Tally[] = [
    { group: "needs", count: freshAsks, label: model.stepsOnly ? (freshAsks === 1 ? "step for you" : "steps for you") : freshAsks === 1 ? "needs you" : "need you" },
    { group: "stuck", count: model.stuck.length, label: "stuck" },
    { group: "working", count: model.working.length, label: "working" },
    { group: "waiting", count: model.waiting.length, label: "waiting" },
    { group: "later", count: model.later.length, label: "later" },
  ];
  return parts.filter(part => part.count > 0);
}

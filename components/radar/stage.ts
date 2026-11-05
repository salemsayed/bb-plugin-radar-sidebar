import { deskTitle, isClosed, isSameLocalDay, needsYou, sortDesks, type BotDesk, type BotTaskRow, type BotTasksBot } from "@/lib/botTasks";
import { clockFormatter, clearsLine, clearsWeekdayFormatter } from "./BotsView";
import { plainNote, taskHeadline, youWords } from "./workText";
import type { StagePose } from "./StageFace";

export type StageTone = "ask" | "blocked" | "busy" | "news" | "good" | "quiet";

export interface StageLook {
  pose: StagePose;
  line: string;
  extra: string;
  tone: StageTone;
  quiet: boolean;
}

export interface StageContext {
  running: number;
  runningTitle?: string;
  failedChecks?: ReadonlySet<string>;
  chatting: boolean;
  unread: boolean;
  now: number;
}

const BLOCKED = new Set(["overdue", "retrying"]);
const CHECKING_LINE = /^(?:checking \d+ of \d+|not checked|checks needed|(?:a )?check failed|evidence needs review|owner review|the bot hasn't (?:checked|finished its checks)|worker finished|every check passed)/i;
const NOT_STARTED_LINE = /^filed\.\s*not started/i;

const IRREGULAR: Record<string, string> = { is: "are", was: "were", has: "have", does: "do", says: "say", goes: "go" };

function verb(word: string): string {
  return IRREGULAR[word] ?? (/[^s]s$/.test(word) && word.length > 3 ? word.slice(0, -1) : word);
}

function capital(word: string): string {
  return word ? word[0]!.toUpperCase() + word.slice(1) : word;
}

function secondPerson(text: string): string {
  return text
    .replace(/\b(Does|Is|Was|Has) he\b/g, (_, word: string) => `${capital(verb(word.toLowerCase()))} you`)
    .replace(/\b([Hh])e ((?:still|also|now|already|just|really|only|usually) )?(\w+)\b/g, (_, h: string, adverb: string | undefined, word: string) => `${h === "H" ? "You" : "you"} ${adverb ?? ""}${verb(word)}`)
    .replace(/\bhe\b/g, "you").replace(/\bhim\b/g, "you").replace(/\bhis\b/g, "your").replace(/\bhimself\b/g, "yourself");
}

function flatten(text: string): string {
  return text
    .replace(/\s*\[([^\]]+)\]\([^)]+\)/g, "")
    .replace(/(?:\s+(?:on|in|at|from|see))?\s*@thread:\S+/g, "")
    .replace(/\*\*|__|`/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[,;:]?\s*\b(?:see|on|in|at|from)\s*$/i, "");
}

export function stageText(text: string): string {
  return plainNote(secondPerson(youWords(flatten(text)).replace(/^You to (?:say|tell me|confirm) (whether|if) /, "Tell me $1 ")));
}

export function stageTitle(raw: string): string {
  return plainNote(secondPerson(flatten(taskHeadline(raw)).replace(/(?<![\w-])Salem's\b/g, "your").replace(/(?<![\w-])Salem\b(?!-)/g, "you")));
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function nextCheck(at: number, now: number): string {
  const when = clearsLine(at, now);
  if (when.startsWith("overdue")) return `Check overdue since ${when.slice("overdue since ".length)}`;
  const day = (ms: number) => new Date(ms).setHours(0, 0, 0, 0);
  const days = Math.round((day(at) - day(now)) / 86_400_000);
  const time = clockFormatter.format(new Date(at));
  if (days === 0) return `Next check ${time}`;
  if (days === 1) return `Next check ${time} tomorrow`;
  if (days < 7) return `Next check ${time} ${clearsWeekdayFormatter.format(new Date(at))}`;
  return `Next check ${when}`;
}

function waitLine(task: BotTaskRow, now: number): string {
  if (task.wakeAt !== undefined) return nextCheck(task.wakeAt, now);
  if (task.waitFor && task.waitFor !== "the bot") return "Waiting on someone else";
  if (/wakes on thread-idle/i.test(task.line)) return "Waiting on a worker";
  return "Waiting, no date set";
}

function isChecking(task: BotTaskRow): boolean {
  return task.displayState === "checking" || (task.displayState === "waiting" && CHECKING_LINE.test(task.line));
}

function notStarted(task: BotTaskRow): boolean {
  return task.displayState === "ready" || (task.displayState === "waiting" && NOT_STARTED_LINE.test(task.line));
}

export function stageLook(bot: BotTasksBot, ctx: StageContext): StageLook {
  const open = bot.tasks.filter(task => !isClosed(task.displayState));
  const needs = open.filter(task => task.displayState === "needs");
  if (needs.length) {
    const first = needs[0]!;
    const question = stageText(first.needs?.question || first.line || first.title);
    return { pose: "asking", line: question || "Has a question for you", extra: needs.length > 1 ? `${needs.length} questions for you` : "", tone: "ask", quiet: false };
  }
  const desks = sortDesks(bot.desks.filter(needsYou));
  if (desks.length) {
    return { pose: "asking", line: deskNeedLine(desks[0]!), extra: desks.length > 1 ? `${desks.length} desks need you` : "", tone: "ask", quiet: false };
  }
  const blocked = open.find(task => BLOCKED.has(task.displayState));
  if (blocked) {
    const retry = blocked.retryAt ? `· retrying ${clockFormatter.format(new Date(blocked.retryAt))}` : "";
    const why = blocked.displayState === "overdue" ? "missed its check" : "keeps failing";
    return { pose: "blocked", line: `${stageTitle(blocked.title)} ${why}`, extra: retry, tone: "blocked", quiet: false };
  }
  if (ctx.unread) return { pose: "unread", line: "New reply for you", extra: "", tone: "news", quiet: false };
  const offline = open.find(task => task.displayState === "offline");
  const working = open.filter(task => task.displayState === "working" || task.displayState === "queued");
  if (offline && !working.length && !ctx.running) {
    return { pose: "offline", line: "Its machine is off", extra: "", tone: "quiet", quiet: true };
  }
  const helpers = ctx.running ? plural(ctx.running, "worker running", "workers running") : "";
  const moving = working[0] ?? (ctx.running ? open.find(task => !isClosed(task.displayState) && !notStarted(task) && task.displayState !== "waiting") : undefined);
  if (moving || ctx.running) {
    const what = moving ? stageTitle(moving.title) : ctx.runningTitle ? stageTitle(ctx.runningTitle) : "";
    const queued = moving?.displayState === "queued" && !ctx.running;
    const line = queued ? `Queued: ${what}` : what ? `Working on ${what}` : "Working";
    return { pose: "working", line, extra: helpers, tone: "busy", quiet: false };
  }
  const checking = open.find(isChecking);
  if (checking && !ctx.chatting) {
    const failed = ctx.failedChecks?.has(checking.id) || /check failed|evidence needs review/i.test(checking.line);
    const status = failed ? "check didn't pass yet" : "waiting on its check";
    return { pose: "idle", line: `${stageTitle(checking.title)}: ${status}`, extra: "", tone: "quiet", quiet: true };
  }
  if (ctx.chatting) return { pose: "working", line: "Chatting with you", extra: "", tone: "busy", quiet: false };
  const waiting = open.filter(task => task.displayState === "waiting" && !notStarted(task))
    .sort((a, b) => (a.wakeAt ?? Infinity) - (b.wakeAt ?? Infinity));
  if (waiting.length) {
    return { pose: "waiting", line: waitLine(waiting[0]!, ctx.now), extra: plural(waiting.length, "task waiting", "tasks waiting"), tone: "quiet", quiet: true };
  }
  const todo = open.find(notStarted);
  if (todo) return { pose: "idle", line: `Not started yet: ${stageTitle(todo.title)}`, extra: "", tone: "quiet", quiet: true };
  const last = bot.tasks.filter(task => task.completedAt !== undefined && task.displayState === "done")
    .sort((a, b) => b.completedAt! - a.completedAt!)[0];
  if (last && isSameLocalDay(last.completedAt!, ctx.now)) return { pose: "done", line: `Done: ${stageTitle(last.title)}`, extra: "", tone: "good", quiet: false };
  return { pose: "idle", line: "Idle, nothing waiting", extra: "", tone: "quiet", quiet: true };
}

export type RowKind = "ask" | "live" | "calm";
export type RowBadge = "ask" | "wait" | "unread" | "blocked" | null;

export function deskNeedLine(desk: Pick<BotDesk, "status" | "label" | "title">): string {
  return `${desk.status === "draft" ? "Your go" : "Your answer"}: ${plainNote(deskTitle(desk))}`;
}

export function needsCount(bot: BotTasksBot): number {
  return bot.tasks.filter(task => task.displayState === "needs").length + bot.desks.filter(needsYou).length;
}

export interface RowLook extends StageLook {
  kind: RowKind;
  badge: RowBadge;
  time: string;
  helpers: number;
}

export function since(at: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - at) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}h`;
  return `${Math.floor(minutes / 1440)}d`;
}

function lastActivity(bot: BotTasksBot): number | undefined {
  const times = bot.tasks.map(task => task.completedAt ?? (task.observedAt !== undefined ? task.observedAt - task.ageMs : undefined)).filter((at): at is number => at !== undefined);
  return times.length ? Math.max(...times) : undefined;
}

export function rowLook(bot: BotTasksBot, ctx: StageContext): RowLook {
  const look = stageLook(bot, ctx);
  const helpers = ctx.running;
  if (look.pose === "asking") {
    const first = bot.tasks.find(task => task.displayState === "needs");
    const desk = sortDesks(bot.desks.filter(needsYou))[0];
    const asked = first?.observedAt !== undefined ? first.observedAt - first.ageMs : desk?.updatedAt;
    return { ...look, kind: "ask", badge: "ask", time: asked !== undefined ? since(asked, ctx.now) : "", helpers };
  }
  if (look.pose === "blocked") return { ...look, kind: "live", badge: "blocked", time: "", helpers };
  if (look.tone === "busy") return { ...look, kind: "live", badge: null, time: "now", helpers };
  if (look.pose === "unread") return { ...look, kind: "calm", badge: null, time: "", helpers };
  if (look.pose === "offline") return { ...look, kind: "calm", badge: null, time: "", helpers };
  if (look.quiet && bot.tasks.some(isChecking)) return { ...look, kind: "calm", badge: "wait", time: "", helpers };
  const last = lastActivity(bot);
  if (look.pose === "waiting") return { ...look, pose: "idle", kind: "calm", badge: "wait", time: last !== undefined ? since(last, ctx.now) : "", helpers };
  return { ...look, kind: "calm", badge: null, time: last !== undefined ? since(last, ctx.now) : "", helpers };
}

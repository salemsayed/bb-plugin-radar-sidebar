import { isClosed, isSameLocalDay, type BotTaskRow, type BotTasksBot } from "@/lib/botTasks";
import { clockFormatter, clearsLine } from "./BotsView";
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
  chatting: boolean;
  unread: boolean;
  now: number;
}

const BLOCKED = new Set(["overdue", "retrying"]);
const CHECKING_LINE = /^checking \d+ of \d+|not checked|checks needed|check failed|evidence needs review|owner review/i;
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

function title(raw: string): string {
  return plainNote(secondPerson(flatten(taskHeadline(raw)).replace(/\bSalem's\b/g, "your").replace(/\bSalem\b/g, "you")));
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function waitLine(task: BotTaskRow, now: number): string {
  if (task.wakeAt !== undefined) {
    const when = clearsLine(task.wakeAt, now);
    return when.startsWith("overdue") ? `Check was due ${when.slice("overdue since ".length)}` : `Checks again ${when}`;
  }
  if (task.waitFor && task.waitFor !== "the bot") return "Waiting on someone";
  if (/thread-idle|builder|worker|helper/i.test(task.line)) return "Waiting on a helper";
  return "Waiting";
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
    return { pose: "asking", line: question || "Has a question for you", extra: needs.length > 1 ? `· +${needs.length - 1} more` : "", tone: "ask", quiet: false };
  }
  const blocked = open.find(task => BLOCKED.has(task.displayState));
  if (blocked) {
    const retry = blocked.retryAt ? `· retrying ${clockFormatter.format(new Date(blocked.retryAt))}` : "";
    const why = blocked.displayState === "overdue" ? "missed its check" : "keeps failing";
    return { pose: "blocked", line: `${title(blocked.title)} ${why}`, extra: retry, tone: "blocked", quiet: false };
  }
  if (ctx.unread) return { pose: "unread", line: "New reply for you", extra: "", tone: "news", quiet: false };
  const offline = open.find(task => task.displayState === "offline");
  const working = open.filter(task => task.displayState === "working" || task.displayState === "queued");
  if (offline && !working.length && !ctx.running) {
    return { pose: "offline", line: "Its machine is off", extra: "", tone: "quiet", quiet: true };
  }
  const helpers = ctx.running ? `· ${plural(ctx.running, "helper", "helpers")}` : "";
  const moving = working[0] ?? (ctx.running ? open.find(task => !isClosed(task.displayState) && !notStarted(task) && task.displayState !== "waiting") : undefined);
  if (moving || ctx.running || bot.unlinked.length) {
    const what = moving ? title(moving.title) : bot.unlinked[0]?.title ? title(bot.unlinked[0].title) : "Working";
    const queued = moving?.displayState === "queued" && !ctx.running ? "· queued" : "";
    return { pose: "working", line: what, extra: helpers || queued, tone: "busy", quiet: false };
  }
  const checking = open.find(isChecking);
  if (checking) return { pose: "checking", line: `Checking ${title(checking.title)}`, extra: "", tone: "busy", quiet: false };
  if (ctx.chatting) return { pose: "working", line: "Chatting with you", extra: "", tone: "busy", quiet: false };
  const waiting = open.filter(task => task.displayState === "waiting" && !notStarted(task))
    .sort((a, b) => (a.wakeAt ?? Infinity) - (b.wakeAt ?? Infinity));
  if (waiting.length) {
    return { pose: "waiting", line: waitLine(waiting[0]!, ctx.now), extra: waiting.length > 1 ? `· +${waiting.length - 1} more` : "", tone: "quiet", quiet: true };
  }
  const todo = open.find(notStarted);
  if (todo) return { pose: "idle", line: `Not started yet: ${title(todo.title)}`, extra: "", tone: "quiet", quiet: true };
  const last = bot.tasks.filter(task => task.completedAt !== undefined && task.displayState === "done")
    .sort((a, b) => b.completedAt! - a.completedAt!)[0];
  if (last && isSameLocalDay(last.completedAt!, ctx.now)) return { pose: "done", line: `Done: ${title(last.title)}`, extra: "", tone: "good", quiet: false };
  return { pose: "idle", line: "Resting", extra: "", tone: "quiet", quiet: true };
}

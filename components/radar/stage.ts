import { deskTitle, isClosed, isSameLocalDay, needsYou, sortDesks, type BotDesk, type BotTaskRow, type BotTasksBot } from "@/lib/botTasks";
import { clockFormatter, clearsLine, clearsWeekdayFormatter } from "./BotsView";
import { capitalFirst, plainNote, plainWorkerTitle, taskHeadline, waitingOn, youWords } from "./workText";
import type { StagePose } from "./StageFace";

export type StageTone = "ask" | "blocked" | "busy" | "news" | "good" | "quiet";

export interface StageLook {
  pose: StagePose;
  line: string;
  ask?: string;
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
  lastReply?: number;
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

const ASK_CLAUSE = /\?|^you\b|\b(?:decide|approve|confirm|choose|pick|whether|go-ahead|ok to|should (?:i|we)|can (?:i|we)|want me to|your call)\b/i;
const ASK_LONG = 80;
const DECIDE = /^you (?:decide|choose|pick|say|tell me|confirm) (?:whether|if) (?:to )?(.+)$/i;
const YOU_ACT = /^you (?:can |could |should |need to |may )?((?:approve|confirm|close|keep|choose|pick|decide|reply|answer|merge|ship|send|pay|sign|review|check|test|accept|reject|switch|cancel|renew|buy|book|upgrade|wait)\b.*)$/i;
const SECOND_VERB = /\b(or|and) ((?:approve|confirm|close|keep|choose|pick|decide|reply|answer|merge|ship|send|pay|sign|review|check|test|accept|reject|switch|cancel|renew|buy|book|upgrade|wait|drop|stop|leave|delete|remove|archive|retry|skip|hold|start|restart|move)(?:e?s))\b/gi;
const DANGLING = /\b(?:it|them)\b|\b(?:this|that|these|those)\b(?=\s*(?:[?.!,;]|$|(?:or|and|now|today|tonight|first|instead)\b))/i;
const SUBJECT = /\b((?:the|this|that|your|its|our) (?:[\w-]+ ){0,3}?[\w-]+) (?:is|are|was|were|has|have|had|can|cannot|can't|could|couldn't|will|won't|would|should|does|doesn't|did|didn't|still|keeps|needs|fails|failed|passes|passed|runs|works|stays|looks|went|got|rose|dropped|changed)\b/i;

function antecedent(parts: readonly string[], plural: boolean): string {
  for (let i = parts.length - 1; i >= 0; i--) {
    const clauses = parts[i]!.split(/,\s+|;\s+|\s+(?:so|but|and|because|which)\s+/i).reverse();
    for (const clause of clauses) {
      const noun = SUBJECT.exec(clause)?.[1];
      if (!noun) continue;
      const many = /[^su]s$/i.test(noun);
      if (many === plural) return noun.replace(/^(?:This|That|Your|Its|Our|The)\b/, word => word.toLowerCase());
    }
  }
  return "";
}

function carryNoun(lead: string, noun: string): string {
  const pair = /^(\w+) (or|and) (\w+) (it|them|this|that)\b/i.exec(lead);
  if (pair) return `${pair[1]} ${noun} ${pair[2]} ${pair[3]} ${pair[4]}${lead.slice(pair[0].length)}`;
  return lead.replace(DANGLING, noun);
}

function decisionLead(clause: string): string {
  const bare = clause.replace(/^so\s+/i, "").replace(/[.;,]\s*$/, "").trim();
  const decide = DECIDE.exec(bare) ?? YOU_ACT.exec(bare);
  if (!decide) return capitalFirst(bare);
  const lead = decide[1]!.trim().replace(SECOND_VERB, (_, join: string, word: string) => `${join} ${word.replace(/(?:(?<=(?:ss|sh|ch|x))es|s)$/, "")}`);
  return `${capitalFirst(lead)}${/[?!]$/.test(lead) ? "" : "?"}`;
}

export function askFirst(text: string, title = ""): string {
  const parts = text.split(/(?<=[.;!?])\s+|,\s+(?=so\s)/i).map(part => part.trim()).filter(Boolean);
  let at = -1;
  for (let i = parts.length - 1; i >= 0; i--) if (ASK_CLAUSE.test(parts[i]!.replace(/^so\s+/i, ""))) { at = i; break; }
  if (at < 0) return text;
  if (at === 0 && text.length <= ASK_LONG && !DECIDE.test(parts[0]!) && !YOU_ACT.test(parts[0]!)) return text;
  let lead = decisionLead(parts[at]!);
  const head = title.trim();
  const rest = parts.filter((_, i) => i !== at).reduce((out, part) => !out ? part : /^so\s/i.test(part) ? `${out.replace(/[.;]$/, "")}, ${part}` : `${out} ${part}`, "").replace(/[;,]\s*$/, "");
  const named = (text: string) => text.toLowerCase().includes(head.toLowerCase());
  const pronoun = DANGLING.exec(lead)?.[0];
  const noun = pronoun ? antecedent(parts.slice(0, at), /^(?:them|these|those)$/i.test(pronoun)) : "";
  if (noun) lead = carryNoun(lead, noun);
  else if (head && pronoun && !named(lead) && !rest.toLowerCase().startsWith(head.toLowerCase())) lead = `${head}: ${lead[0]!.toLowerCase()}${lead.slice(1)}`;
  return rest ? `${lead} · ${rest}` : lead;
}

export function stageText(text: string): string {
  return plainNote(secondPerson(youWords(flatten(text)).replace(/^You to (?:say|tell me|confirm) (whether|if) /, "Tell me $1 ")));
}

const MERGE_REQUEST = /^([a-z][\w-]*)!(\d+)$/i;

export function stageTitle(raw: string): string {
  const request = MERGE_REQUEST.exec(raw.trim());
  if (request) return `Merge request ${request[2]}`;
  return plainNote(secondPerson(flatten(taskHeadline(plainWorkerTitle(raw))).replace(/(?<![\w-])Salem's\b/g, "your").replace(/(?<![\w-])Salem\b(?!-)/g, "you")));
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
  if (days === 1) return `Next check tomorrow\u00a0${time}`;
  if (days < 7) return `Next check ${clearsWeekdayFormatter.format(new Date(at))}\u00a0${time}`;
  return `Next check ${when}`;
}

function waitLine(task: BotTaskRow, now: number): string {
  if (task.wakeAt !== undefined) return nextCheck(task.wakeAt, now);
  if (task.waitFor && task.waitFor !== "the bot") return waitingOn(task.line) ? `Waiting on ${waitingOn(task.line)}` : "Waiting on someone else";
  if (/wakes on thread-idle/i.test(task.line)) return "Waiting on a worker";
  return "Waiting on the bot · no check scheduled";
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
  const desks = sortDesks(bot.desks.filter(needsYou));
  if (needs.length || desks.length) {
    const first = needs[0];
    const ask = first ? askFirst(stageText(first.needs?.question || first.line || first.title), stageTitle(first.title)) || "Has a question for you" : deskNeedLine(desks[0]!);
    return { pose: "asking", line: `Waiting on you · ${plural(needs.length + desks.length, "ask", "asks")}`, ask, extra: "", tone: "ask", quiet: false };
  }
  const blocked = open.find(task => BLOCKED.has(task.displayState));
  if (blocked) {
    const retry = blocked.retryAt ? `· retrying ${clockFormatter.format(new Date(blocked.retryAt))}` : "";
    const why = blocked.displayState === "overdue" ? "missed its check" : "keeps failing";
    return { pose: "blocked", line: `${stageTitle(blocked.title)} ${why}`, extra: retry, tone: "blocked", quiet: false };
  }
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

const CHANNEL_TAG = /^(?:chat|whatsapp|dm|desk|email|ticket chat)$/i;
const SEND_FIRST = /^(nudge|reminder|follow-up|followup|reply|message|note|update|offer)\s+(?:on|about|re|for|regarding)\s+(.+)$/i;
const SENDABLE = /\b(?:nudge|reminder|follow-up|followup|reply|message|note|update|offer|invite|invitation|quote|email|answer)$/i;

function lowerFirst(text: string): string {
  return /^[A-Z][a-z]/.test(text) && !/^[A-Z][a-z]+(?:\s+[A-Z]|$)/.test(text) ? text[0]!.toLowerCase() + text.slice(1) : text;
}

export function deskNeedLine(desk: Pick<BotDesk, "status" | "label" | "title"> & Partial<Pick<BotDesk, "desk">>): string {
  const parts = plainNote(deskTitle(desk)).split(/\s+·\s+/).map(part => part.trim()).filter(Boolean);
  if (parts.length > 1 && (CHANNEL_TAG.test(parts[0]!) || parts[0]!.toLowerCase() === desk.label.trim().toLowerCase())) parts.shift();
  const conversation = desk.desk === undefined || desk.desk === "chat" || desk.desk === "whatsapp";
  if (conversation && parts.length >= 2) {
    const [name, ...rest] = parts;
    const subject = rest.join(" · ");
    if (desk.status === "blocked") return `${name} is waiting on your answer · ${subject}`;
    const flipped = SEND_FIRST.exec(subject);
    const thing = flipped ? `${flipped[2]} ${flipped[1]!.toLowerCase()}` : subject;
    return SENDABLE.test(thing) ? `Send the ${flipped ? thing : lowerFirst(thing)} to ${name}?` : `Send your reply to ${name}? · ${subject}`;
  }
  const rest = parts.join(" · ");
  if (!rest) return desk.status === "draft" ? "Approve the bot's draft?" : "The bot needs your answer";
  return desk.status === "draft" ? `Approve ${lowerFirst(rest)}?` : `${rest} · needs your answer`;
}

export function needsCount(bot: BotTasksBot): number {
  return bot.tasks.filter(task => task.displayState === "needs").length + bot.desks.filter(needsYou).length;
}

export interface RowLook extends StageLook {
  kind: RowKind;
  badge: RowBadge;
  time: string;
  timeTitle?: string;
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

const replyClock = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const replyDay = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

function replyTime(bot: BotTasksBot, ctx: StageContext): Pick<RowLook, "time" | "timeTitle"> {
  const at = ctx.lastReply ?? lastActivity(bot);
  if (at === undefined) return { time: "" };
  const title = `${ctx.lastReply !== undefined ? "Last reply" : "Last activity"} ${isSameLocalDay(at, ctx.now) ? replyClock.format(new Date(at)) : replyDay.format(new Date(at))}`;
  return { time: since(at, ctx.now), timeTitle: title };
}

export function rowLook(bot: BotTasksBot, ctx: StageContext): RowLook {
  const look = stageLook(bot, ctx);
  const helpers = ctx.running;
  const when = replyTime(bot, ctx);
  if (look.pose === "asking") return { ...look, kind: "ask", badge: "ask", ...when, helpers };
  if (look.pose === "blocked") return { ...look, kind: "live", badge: "blocked", ...when, helpers };
  if (look.tone === "busy") return { ...look, kind: "live", badge: null, time: "now", helpers };
  if (look.pose === "offline") return { ...look, kind: "calm", badge: null, ...when, helpers };
  if (look.quiet && bot.tasks.some(isChecking)) return { ...look, kind: "calm", badge: "wait", ...when, helpers };
  if (look.pose === "waiting") return { ...look, pose: "idle", kind: "calm", badge: "wait", ...when, helpers };
  return { ...look, kind: "calm", badge: null, ...when, helpers };
}

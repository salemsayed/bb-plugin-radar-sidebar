import { deskTitle, isClosed, isSameLocalDay, needsYou, sortDesks, type BotDesk, type BotTaskRow, type BotTasksBot, type BotTasksData } from "@/lib/botTasks";
import { clockFormatter, clearsLine, clearsWeekdayFormatter } from "./BotsView";
import { capitalFirst, cutAtWord, plainNote, plainWorkerTitle, readableCut, readerWords, taskHeadline, waitingOn, youWords } from "./workText";
import type { StagePose } from "./StageFace";
import { wholeTitle } from "./displayText";
import { isQuestionRow } from "./questions";
import { withoutMarks } from "./recommend";

export function taskAsk(task: Pick<BotTaskRow, "needs" | "line" | "title" | "outcome" | "tags">): string {
  const asked = isQuestionRow(task) ? task.needs?.question ?? task.title : needAsk((task.needs?.question || task.line || task.title).replace(/^(?:needs you|waiting for you)\s*[:\u00b7-]\s*/i, ""), stageTitle(task.title, task.outcome));
  return task.needs?.recommended ? withoutMarks(asked) : asked;
}

export type StageTone = "ask" | "blocked" | "busy" | "news" | "good" | "quiet";

export interface StageLook {
  pose: StagePose;
  line: string;
  alts?: string[];
  whole?: string;
  exact?: boolean;
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

const ASK_CLAUSE = /\?|^you\b(?! (?:[a-z]+ed|chose|said|asked|picked|approved|decided|wanted|agreed|told|replied|confirmed|already|made|ran|sent|took|gave|wrote|set|put|got|began|left|let|saw|did|were|have|had)\b)|\b(?:decide|approve|confirm|choose|pick|whether|go-ahead|ok to|should (?:i|we)|can (?:i|we)|want me to|your call)\b|\b(?:awaits?|waiting (?:on|for)|needs?) your (?:go|go-ahead|ok|okay|answer|approval|call|decision|sign-off|reply)\b/i;
const AWAITS_GO = /^(.+?)\s+(?:awaits?|is waiting (?:on|for)|needs?) your (?:go|go-ahead|ok|okay|approval|sign-off)\b\.?$/i;
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
  const awaits = AWAITS_GO.exec(bare);
  if (awaits) return `Go ahead with ${lowerFirst(awaits[1]!)}?`;
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

const IMPERATIVE = /^(?:approve|confirm|close|keep|choose|pick|decide|reply|answer|merge|ship|send|pay|sign|review|check|test|accept|reject|switch|cancel|renew|buy|book|upgrade|tell|give|share|add|set|run|open|go ahead|let me know|read|look|try|restart|retry|update|fix|install|remove|delete|move|publish|deploy|release|start|stop|rename|plug|unplug|scan|call|order|grab)\b(?!\s+(?:is|was|are|were|has|have|had|will|would|can|could|cannot|can't|should|did|does|do|got|gets|went|looks|passed|failed|stays|works|landed|shipped|deployed|ran|runs|needs|needed)\b)/i;
const CLOSES_ON_YOU = /\b(?:it|this|the task)\s+(?:only\s+)?(?:closes|can close|will close|can be closed|closes only) (?:on|with|after) your (?:word|say-so|go|ok|okay|confirmation)\b/i;
const YOU_TO = /\b(?:waiting (?:on|for) you to|waits (?:on|for) you to|needs? you to|for you to|you need to|you should|asks? you to)\s+([^.;·?]{3,80})/i;

export function isDecision(text: string): boolean {
  const lead = text.split(" · ")[0]!.trim();
  return /\?/.test(lead) || IMPERATIVE.test(lead);
}

export function needAsk(raw: string, title: string): string {
  const text = stageText(raw, true);
  const first = askFirst(text, title);
  if (!first || isDecision(first)) return first;
  const wanted = YOU_TO.exec(text)?.[1]?.trim().replace(/[,\s]+$/, "");
  const rest = first.split(/(?<=[.;!?])\s+/).filter(part => !YOU_TO.test(part) && !/^Waiting (?:on|for) you\b/i.test(part)).join(" ").trim().replace(/\s*[;,:]$/, ".");
  if (wanted) {
    const verbs = wanted.replace(/\s*\/\s*/g, " or ");
    const object = /^[a-z]+(?: (?:or|and) [a-z]+)?$/i.test(verbs) && title ? ` ${title}` : "";
    return `${capitalFirst(verbs)}${object}?${rest ? ` · ${rest}` : ""}`;
  }
  if (CLOSES_ON_YOU.test(text)) return `Close ${title || "it"}? · ${first}`;
  return `Reply needed on ${title || "this task"}${rest ? ` · ${rest}` : ""}`;
}

export function stageText(text: string, keepNames = false): string {
  return plainNote(secondPerson(youWords(flatten(text)).replace(/^You to (?:say|tell me|confirm) (whether|if) /, "Tell me $1 ")), keepNames).replace(/([.!?]\s+)(you|your)\b/g, (_, end: string, word: string) => `${end}${word[0]!.toUpperCase()}${word.slice(1)}`);
}

const MERGE_REQUEST = /^([a-z][\w-]*)!(\d+)$/i;

function participleEnd(title: string, outcome: string): string {
  const full = outcome.trim().replace(/^(?:the|a|an)\s+/i, "");
  if (!full.toLowerCase().startsWith(title.trim().toLowerCase())) return title;
  const next = /^\s+([a-z]{3,}ed)\b/.exec(full.slice(title.trim().length));
  return next ? `${title.trim()} ${next[1]}` : title;
}

export function stageTitle(raw: string, outcome?: string): string {
  const request = MERGE_REQUEST.exec(raw.trim());
  if (request) return `Merge request ${request[2]}`;
  const whole = outcome ? participleEnd(wholeTitle(raw, outcome), outcome) : raw;
  return capitalFirst(plainNote(secondPerson(flatten(taskHeadline(plainWorkerTitle(whole))).replace(/(?<![\w-])Salem's\b/g, "your").replace(/(?<![\w-])Salem\b(?!-)/g, "you"))));
}

const SCHEDULED_RUN = /\bwakes on automation-run\b/i;
const RUN_TIME = /\b(today's|tonight's|tomorrow's|(?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day's)\s+(\d{1,2}:\d{2})\b/;

export function scheduledWait(line: string): string {
  if (!SCHEDULED_RUN.test(line)) return /\bwakes on thread-idle\b/i.test(line) ? "Waits for its worker to finish" : "";
  const at = RUN_TIME.exec(line);
  return at ? `Next check after ${at[1]} ${at[2]} run` : "Next check after its next scheduled run";
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

export function answeredHere(later: { reason: string; messageSeq?: number }): boolean {
  return later.reason === "answered" && later.messageSeq !== undefined;
}

export function laterLine(later: { reason: string; messageSeq?: number }): string {
  return answeredHere(later) ? "You answered · bot to follow up" : later.reason === "answered" ? "Moved to Later" : "Later · until it asks again";
}

export function laterNoteHead(text: string, max = 80): string {
  return capitalFirst(readableCut(readerWords(plainNote(text)).split(/(?<=[.!?])\s+/)[0]!, max).replace(/[.]$/, ""));
}

const DONE_VERB = /^(.{3,60}?)\s+((?:was |were |is |are |has been |have been |got )?(?:[a-z]+ed|built|sent|shipped|done|made|run|set|put|taken|written|given|found|closed|merged|released|published|deployed|fixed|approved|rejected|paid|cancelled|stopped|restored|moved)\b.*)$/;

export function noteRowForms(text: string, title: string): string[] {
  const head = laterNoteHead(text);
  const bare = head.replace(/\s*\([^()]*\)/g, "").replace(/\s{2,}/g, " ").trim();
  const forms = [head, bare];
  const verb = DONE_VERB.exec(bare);
  if (verb) {
    const subject = verb[1]!.toLowerCase().split(/[^a-z0-9]+/).filter(word => word.length > 2);
    const theirs = title.toLowerCase().split(/[^a-z0-9]+/);
    if (subject.some(word => theirs.some(other => other.length > 2 && (other.startsWith(word.slice(0, 5)) || word.startsWith(other.slice(0, 5)))))) {
      const done = verb[2]!.replace(/^(?:was|were|is|are|has been|have been|got) /, "");
      const number = /(?:^|\s)(#\d+|v?\d+(?:\.\d+)+)(?=\s|$)/.exec(verb[1]!)?.[1];
      const named = verb[1]!.replace(/\s*#\d+\b/g, "").replace(/\s{2,}/g, " ").trim();
      const word = done.split(/\s+/)[0]!;
      const version = /\bv?\d+(?:\.\d+)+\b/.exec(done)?.[0];
      if (number && named.length >= 3 && named !== verb[1]) {
        if (version) forms.push(`${capitalFirst(named)} ${version} ${word}`);
        forms.push(`${capitalFirst(named)} ${word}`);
      }
      if (number) forms.push(`${number} ${done}`);
      else forms.push(capitalFirst(done));
    }
  }
  return [...new Set(forms.filter(Boolean))];
}

function noteLook(task: BotTaskRow): Pick<StageLook, "line" | "alts" | "whole"> | null {
  if (task.displayState !== "waiting" || !task.laterNote || task.later) return null;
  const forms = noteRowForms(task.laterNote.text, task.title);
  const fits = forms.map(form => rowFit("", form)).filter(form => !/\u2026$/.test(form));
  const all = [...new Set([...fits, ...forms.map(form => rowFit("", form))])];
  return { line: all[0]!, alts: all.slice(1), whole: forms[0]! };
}

const PERSON = /^[A-Z][a-z]+(?: [A-Z][a-z]+)?$/;

export function awaitedPerson(task: Pick<BotTaskRow, "waitFor" | "line" | "outcome">): string {
  if (task.waitFor !== "someone else") return "";
  const who = waitingOn(task.line, task.outcome);
  return PERSON.test(who) ? who : "";
}

function personWaitLook(task: BotTaskRow, now: number): Pick<StageLook, "line" | "alts" | "whole"> | null {
  const who = awaitedPerson(task);
  if (!who || task.later) return null;
  const base = waitLine(task, now);
  if (base.includes(who)) return null;
  const when = base.replace(/^Next check\s+/, "");
  const lower = `${base[0]!.toLowerCase()}${base.slice(1)}`;
  const forms = [`Waiting on ${who} \u00b7 ${lower}`, ...(when !== base ? [`Waiting on ${who} \u00b7 ${when}`, `Waits on ${who} \u00b7 ${when}`] : []), `Waiting on ${who}`, base];
  return { line: forms[0]!, alts: forms.slice(1), whole: forms[0]! };
}

const RUN_NAMED = /\b(\d{1,2}):(\d{2})\b(?=[^\u00b7.;]{0,30}?\b(?:run|report|job|watch|digest)\b)|\b(?:starts|runs)\b[^\u00b7.;]{0,24}?\b(\d{1,2}):(\d{2})\b/i;

export function runBeforeCheck(line: string, wakeAt: number): string {
  const said = line.split(/\s\u00b7\s(?:wakes|next check)\b/)[0] ?? "";
  const run = RUN_NAMED.exec(said);
  if (!run) return "";
  const hour = Number(run[1] ?? run[3]), minute = Number(run[2] ?? run[4]);
  const wake = new Date(wakeAt);
  const gap = wake.getHours() * 60 + wake.getMinutes() - (hour * 60 + minute);
  return gap > 0 && gap <= 360 ? `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}` : "";
}

export function waitLine(task: BotTaskRow, now: number): string {
  if (task.later) return laterLine(task.later);
  if (task.wakeAt !== undefined) {
    const run = runBeforeCheck(task.line, task.wakeAt);
    return `${nextCheck(task.wakeAt, now)}${run ? `, after the ${run} run` : ""}`;
  }
  if (task.waitFor === "you") return "Waiting on you";
  if (task.waitFor && task.waitFor !== "the bot") return waitingOn(task.line) ? `Waiting on ${waitingOn(task.line)}` : "Waiting on someone else";
  const scheduled = scheduledWait(task.line);
  if (scheduled) return scheduled;
  return "Waiting on the bot · no check scheduled";
}

function isChecking(task: BotTaskRow): boolean {
  return task.displayState === "checking" || (task.displayState === "waiting" && CHECKING_LINE.test(task.line));
}

function notStarted(task: BotTaskRow): boolean {
  return task.displayState === "ready" || (task.displayState === "waiting" && NOT_STARTED_LINE.test(task.line));
}

export const ROW_LINE = 40;

export function rowFit(lead: string, title: string, tail = "", max = ROW_LINE): string {
  const whole = `${lead}${title}${tail}`;
  if (whole.length <= max) return whole;
  const room = max - lead.length - tail.length;
  const head = /^(.{6,}?)(?::\s|\s[—–]\s|;\s)/.exec(title)?.[1];
  if (head && head.length <= room) return `${lead}${head}${tail}`;
  return `${lead}${cutAtWord(title, Math.max(12, room - 1))}${tail}`;
}

function fitted(lead: string, title: string, tail = "", shorter: readonly string[] = []): Pick<StageLook, "line" | "alts" | "whole"> {
  const line = rowFit(lead, title, tail);
  const brief = title.replace(/\bMerge request ((?:[a-z][\w-]*)?!?\d+)/i, "MR $1");
  const alts = [...shorter.map(short => rowFit(short, title, tail)), ...(brief !== title ? [lead, ...shorter].map(short => rowFit(short, brief, tail)) : [])];
  return { line, alts: [...new Set(alts)].filter(alt => alt !== line), whole: `${lead}${title}${tail}` };
}

export function stageLook(bot: BotTasksBot, ctx: StageContext): StageLook {
  const open = bot.tasks.filter(task => !isClosed(task.displayState));
  const needs = open.filter(task => task.displayState === "needs" && !isOldAsk(task));
  const desks = sortDesks(bot.desks.filter(needsYou));
  if (needs.length || desks.length) {
    const first = needs[0];
    const ask = first ? taskAsk(first) || "Has a question for you" : deskNeedLine(desks[0]!);
    return { pose: "asking", line: `${plural(needs.length + desks.length, "question", "questions")} for you`, ask, extra: "", tone: "ask", quiet: false };
  }
  const blocked = open.find(task => BLOCKED.has(task.displayState));
  if (blocked) {
    const retry = blocked.retryAt ? `· retrying ${clockFormatter.format(new Date(blocked.retryAt))}` : "";
    const why = blocked.displayState === "overdue" ? "missed its check" : "keeps failing";
    return { pose: "blocked", ...fitted("", stageTitle(blocked.title), ` ${why}`), extra: retry, tone: "blocked", quiet: false };
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
    const fit = queued ? fitted("Queued: ", what) : what ? fitted("Working on ", what, "", ["Working: "]) : { line: "Working" };
    return { pose: "working", ...fit, extra: helpers, tone: "busy", quiet: false };
  }
  const checking = open.find(isChecking);
  if (checking && !ctx.chatting) {
    const failed = ctx.failedChecks?.has(checking.id) || /check failed|evidence needs review/i.test(checking.line);
    const status = failed ? "check didn't pass yet" : "waiting on its check";
    return { pose: "idle", ...fitted("", stageTitle(checking.title), `: ${status}`), extra: "", tone: "quiet", quiet: true };
  }
  if (ctx.chatting) return { pose: "working", line: "Chatting with you", extra: "", tone: "busy", quiet: false };
  const waiting = open.filter(task => task.displayState === "waiting" && !notStarted(task))
    .sort((a, b) => Number(!!a.later) - Number(!!b.later) || (a.wakeAt ?? Infinity) - (b.wakeAt ?? Infinity));
  if (waiting.length) {
    const noted = noteLook(waiting[0]!) ?? personWaitLook(waiting[0]!, ctx.now);
    return { pose: "waiting", ...(noted ?? { line: waitLine(waiting[0]!, ctx.now) }), extra: plural(waiting.length, "open task", "open tasks"), tone: "quiet", quiet: true };
  }
  const todo = open.find(notStarted);
  if (todo) return { pose: "idle", ...fitted("Not started yet: ", stageTitle(todo.title), "", ["Not started: "]), extra: "", tone: "quiet", quiet: true };
  const last = bot.tasks.filter(task => task.completedAt !== undefined && task.displayState === "done")
    .sort((a, b) => b.completedAt! - a.completedAt!)[0];
  if (last && isSameLocalDay(last.completedAt!, ctx.now)) return { pose: "done", ...fitted("Done: ", stageTitle(last.title)), exact: true, extra: "", tone: "good", quiet: false };
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

export const OLD_ASK_TAG = "radar:old-ask";
export const OLD_ASK_MS = 12 * 3_600_000;
const ACTED_AFTER_MS = 10 * 60_000;

export function isOldAsk(task: Pick<BotTaskRow, "tags">): boolean {
  return task.tags.includes(OLD_ASK_TAG);
}

export function askedAtOf(task: Pick<BotTaskRow, "needs" | "observedAt" | "ageMs">, observedAt: number): number {
  return task.needs?.askedAt ?? (task.observedAt ?? observedAt) - task.ageMs;
}

export function withOldAsks(data: BotTasksData, lastReply: (threadId: string) => number | undefined): BotTasksData {
  let changed = false;
  const bots = data.bots.map(bot => {
    const replied = lastReply(bot.coordinatorThreadId);
    if (replied === undefined) return bot;
    let mine = false;
    const tasks = bot.tasks.map(task => {
      if (task.displayState !== "needs" || task.later || isOldAsk(task)) return task;
      const asked = askedAtOf(task, data.observedAt);
      if (data.observedAt - asked < OLD_ASK_MS || replied < asked + ACTED_AFTER_MS) return task;
      mine = true;
      return { ...task, tags: [...task.tags, OLD_ASK_TAG] };
    });
    if (!mine) return bot;
    changed = true;
    return { ...bot, tasks };
  });
  return changed ? { ...data, bots } : data;
}

export function needsCount(bot: BotTasksBot): number {
  return bot.tasks.filter(task => task.displayState === "needs" && !isOldAsk(task)).length + bot.desks.filter(needsYou).length;
}

export interface RowLook extends StageLook {
  kind: RowKind;
  badge: RowBadge;
  time: string;
  timeTitle?: string;
  helpers: number;
}

export const CLOCK_STEP_MS = 10_000;

export function clockNow(): number {
  return Math.floor(Date.now() / CLOCK_STEP_MS) * CLOCK_STEP_MS;
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
  const age = since(at, ctx.now);
  return { time: age === "now" ? "<1m" : age, timeTitle: title };
}

export function rowLook(bot: BotTasksBot, ctx: StageContext): RowLook {
  const look = stageLook(bot, ctx);
  const helpers = ctx.running;
  const when = replyTime(bot, ctx);
  if (look.pose === "asking") return { ...look, kind: "ask", badge: "ask", ...when, helpers };
  if (look.pose === "blocked") return { ...look, kind: "live", badge: "blocked", ...when, helpers };
  if (look.tone === "busy") return { ...look, kind: "live", badge: null, ...when, helpers };
  if (look.pose === "offline") return { ...look, kind: "calm", badge: null, ...when, helpers };
  if (look.quiet && bot.tasks.some(isChecking)) return { ...look, kind: "calm", badge: "wait", ...when, helpers };
  if (look.pose === "waiting") return { ...look, pose: "idle", kind: "calm", badge: "wait", ...when, helpers };
  return { ...look, kind: "calm", badge: null, ...when, helpers };
}

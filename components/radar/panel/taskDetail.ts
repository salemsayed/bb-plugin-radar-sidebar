import { isClosed, type BotTaskRow } from "@/lib/botTasks";
import { isQuestionRow } from "../questions";
import { stageTitle } from "../stage";
import { askParts, capCut, capitalFirst, cutAtWord, plainNote, plainWorkerTitle, readerWords, sameJob, type AskParts, type OriginalOf } from "../workText";
import type { TaskItem } from "./panelModel";
import { CRITERIA } from "./taskWords";

const OUTCOME_CAP = 600;
const CORE_CAPS = [300, 600];
const LINE_CAP = 240;
const CLOSED_ONLY = /^(?:Done|Closed by (?:you|Salem)|Cancelled|Stopped)(?: (?:from the task header|by hand|today|yesterday|on)?\s*(?:\d{1,2} [A-Z][a-z]{2}|[A-Z][a-z]{2} \d{1,2})?)?\.?$/i;
const CLOSED_REVIEW = [/^Recorded done · owner review needed$/i, /^Recorded done · evidence needs review$/i];
const NOTE_ID = /\s*\((?:reply |comment |chat )?note #?\d{6,}\)/gi;
const STALE_WHILE_RUNNING = /^(?:Starts when|Not started yet|Its (?:browser test|next step) hasn't started|Queued\b|Next check\b)/i;

function closedNote(task: BotTaskRow, reason: string): string {
  if (!isClosed(task.displayState)) return reason;
  const said = reason.trim();
  return CLOSED_ONLY.test(said) || CLOSED_REVIEW.some(pattern => pattern.test(said)) ? "" : reason;
}

export function yourAskSplit(text: string): { asked: string; status: string } | null {
  const said = /^Your ask:\s+(.+)$/.exec(text);
  if (!said) return null;
  const body = said[1]!;
  const end = /[.!?](?=\s+\S)/.exec(body);
  const asked = capitalFirst((end ? body.slice(0, end.index + 1) : body).trim());
  const status = capitalFirst((end ? body.slice(end.index + 1) : "").trim().replace(/^(?:an? )?worker (?:is )?(\w+ing)\b/i, "A worker is $1"));
  return { asked, status };
}

function afterStop(text: string): string {
  return text.replace(/([.!?]["”’)]?)…$/, "$1");
}

export function quoteShown(text: string, cut: boolean): string {
  const body = text.replace(/^You \([^)]*\) on the Needs you item [“"][^”"]*[”"]:\s*/, "").replace(/^[“"]([^“”"]+)[”"]$/, "$1");
  return cut && !/(?:…|\.\.\.|[.!?])$/.test(body.trim()) ? `${body.trim()}…` : body;
}

export interface TaskDetail {
  ask: AskParts | null;
  goal: string;
  soFar: string;
  botNote: { text: string; at: number } | null;
  standing: string;
  latest: string;
}

export interface DetailContext {
  now: number;
  botName: string;
  askerOf?: (threadId: string) => string | undefined;
  originalOf?: OriginalOf;
}

function goalOf(item: TaskItem): string {
  const { task, title, attempts } = item;
  if (!task.outcome || task.outcome === task.title) return "";
  const text = readerWords(plainNote(task.outcome)).replace(/^([^.!?]*[^.!?\s])\.$/, "$1");
  const flat = (words: string) => words.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const repeatsTitle = flat(text) === flat(title) || stageTitle(task.outcome) === title && text.length <= title.length + 16;
  const fragment = text.split(/\s+/).length < 6 && task.outcome.length > text.length + 10;
  const namesWorker = attempts.some(attempt => plainWorkerTitle(attempt.title).toLowerCase() === text.toLowerCase());
  if (!text || repeatsTitle || fragment || namesWorker) return "";
  const capped = CORE_CAPS.includes(task.outcome.length) && !/[.!?]$/.test(task.outcome.trim());
  return afterStop(capped ? cutAtWord(`${text}…`, text.length) : capCut(text, OUTCOME_CAP - (task.outcome.length - text.length)));
}

export function taskDetail(item: TaskItem, { now, botName, askerOf, originalOf }: DetailContext): TaskDetail {
  const { task, attempts, running, status } = item;
  const told = task.ask ? askParts(task.ask, now, askerOf, botName, originalOf) : null;
  const offTopic = told?.kind === "update" && !sameJob(task.ask!.full ?? task.ask!.excerpt, [task.title, task.outcome ?? "", ...attempts.map(attempt => attempt.title)]);
  const said = !isQuestionRow(task) && item.ownsReason ? closedNote(task, item.reason).replace(NOTE_ID, "") : "";
  const split = yourAskSplit(said);
  const note = split ? split.status : said;
  const shown = `${status.words} · ${status.note}`;
  const repeats = !note || CRITERIA.test(note) || shown.includes(note) || note.startsWith(status.words) || running.length > 0 && STALE_WHILE_RUNNING.test(note) || task.displayState === "needs";
  return {
    ask: told && !offTopic && (told.quote || told.full) ? told : null,
    goal: goalOf(item),
    soFar: status.group === "working" || status.group === "stuck" ? task.progress?.done ?? "" : "",
    botNote: task.displayState === "waiting" && task.laterNote ? { text: readerWords(plainNote(task.laterNote.text)), at: task.laterNote.at } : null,
    standing: split?.asked ?? "",
    latest: repeats ? "" : afterStop(capCut(note, task.line.length >= LINE_CAP - 1 ? 0 : Infinity)),
  };
}

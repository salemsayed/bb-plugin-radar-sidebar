import { deskLater, deskTitle, deskWakeAt, isClosed, needsYou, type Attempt, type BotDesk, type BotTaskRow } from "@/lib/botTasks";
import { clearsLine } from "../BotsView";
import { ago, elapsed } from "../elapsed";
import { deskNeedLine, laterNoteHead } from "../stage";
import { capitalFirst, plainNote } from "../workText";
import { cardStatus, checksLine, dayAndTime, type IdleWait } from "./taskWords";

export type Group = "needs" | "stuck" | "working" | "waiting" | "later" | "done";
export type Mark = "ask" | "stuck" | "working" | "waiting" | "queued" | "later" | "info" | "done" | "ended";

export interface Status {
  group: Group;
  mark: Mark;
  words: string;
  note: string;
}

export const GROUP_TITLE: Record<Group, string> = { needs: "Needs you", stuck: "Stuck", working: "Working", waiting: "Waiting", later: "Later", done: "Done" };

const QUEUED = "Queued for a free worker";

function split(line: string): { words: string; note: string } {
  const [words = "", ...rest] = line.split(" · ");
  return { words, note: rest.join(" · ") };
}

function alertWords(alert: NonNullable<BotTaskRow["alert"]>): string {
  const span = elapsed(0, alert.forMs);
  return alert.kind === "stuck" ? `Going in circles for ${span}` : `No update for ${span}`;
}

export interface TaskStatusInput {
  task: BotTaskRow;
  running: readonly Attempt[];
  now: number;
  waitsOn?: IdleWait | null;
  botName: string;
}

export function taskStatus({ task, running, now, waitsOn, botName }: TaskStatusInput): Status {
  const state = task.displayState;
  const line = task.line;
  const said = split(cardStatus(task, [...running], now, waitsOn, botName));
  if (isClosed(state)) return { group: "done", mark: /^(?:Cancelled|Stopped)\b/.test(said.words) ? "ended" : "done", ...said };
  if (task.later?.reason === "not-now") return { group: "later", mark: "later", words: "Not now", note: `since ${dayAndTime(task.later.at, now)}` };
  if (state === "needs") return { group: "needs", mark: "ask", words: [said.words, said.note].filter(Boolean).join(" · "), note: "" };
  if (task.later) return { group: "waiting", mark: "waiting", ...said };
  const live = state === "working" || running.length > 0;
  if (/^Retrying/.test(line) || state === "retrying") return { group: "stuck", mark: "stuck", words: "Retrying after an error", note: "" };
  if (live && task.alert) return { group: "stuck", mark: "stuck", words: alertWords(task.alert), note: task.progress?.now ?? "" };
  if (live) return { group: "working", mark: "working", words: said.words, note: [said.note, task.progress?.now ?? ""].filter(Boolean).join(" · ") };
  if (/^Wake was due/.test(line) || state === "overdue") return { group: "stuck", mark: "stuck", words: "Check overdue", note: task.wakeAt !== undefined ? clearsLine(task.wakeAt, now).replace(/^overdue /, "") : "" };
  if (/^Its machine is off/.test(line) || state === "offline") return { group: "stuck", mark: "stuck", words: "Machine off", note: "resumes when it is back" };
  if (/^A check failed\b/i.test(line)) return { group: "stuck", mark: "stuck", words: "A check failed", note: "the bot has not acted on it" };
  if (/^Its worker failed\b/.test(line)) return { group: "stuck", mark: "stuck", words: "Worker failed", note: "no result came back" };
  if (/^Queued/.test(line) || state === "queued") return { group: "waiting", mark: "queued", words: QUEUED, note: task.retryAt !== undefined && task.retryAt > now ? checksLine(task.retryAt, now).replace(/^next check/, "next try") : "starting soon" };
  if (/^Filed\. Not started/.test(line) || state === "ready") return { group: "waiting", mark: "queued", words: "Not started", note: "" };
  if (task.laterNote) return { group: "waiting", mark: "waiting", words: laterNoteHead(task.laterNote.text), note: dayAndTime(task.laterNote.at, now) };
  return { group: "waiting", mark: "waiting", ...said };
}

const CHANNEL = /^(?:chat|whatsapp|dm|desk|email|ticket chat)$/i;

export interface DeskParts { channel: string; person: string; subject: string }

export function deskParts(desk: Pick<BotDesk, "label" | "title">): DeskParts {
  const parts = plainNote(deskTitle(desk)).split(/\s+·\s+/).map(part => part.trim()).filter(Boolean);
  const label = desk.label.trim();
  const named = parts.length > 1 && (CHANNEL.test(parts[0]!) || parts[0]!.toLowerCase() === label.toLowerCase());
  const channel = named ? parts.shift()! : label;
  const person = parts.length > 1 ? parts.shift()! : "";
  return { channel: /^whatsapp$/i.test(channel) ? "WhatsApp" : capitalFirst(channel), person, subject: capitalFirst(parts.join(" · ") || channel) };
}

export function deskStatus(desk: BotDesk, now: number): Status {
  const { channel } = deskParts(desk);
  const moved = `${channel} · ${ago(desk.updatedAt, now)}`;
  if (needsYou(desk)) return { group: "needs", mark: "ask", words: desk.status === "draft" ? "Go-ahead needed" : "Answer needed", note: moved };
  if (deskLater(desk)) return { group: "later", mark: "later", words: "Not now", note: "back when the desk changes" };
  if (desk.status === "done") return { group: "done", mark: "done", words: "Done", note: dayAndTime(desk.updatedAt, now) };
  if (desk.status === "info") return { group: "done", mark: "info", words: "For your info", note: dayAndTime(desk.updatedAt, now) };
  if (desk.status === "working") return { group: "working", mark: "working", words: "Working", note: moved };
  if (desk.status === "deferred") return { group: "waiting", mark: "queued", words: QUEUED, note: desk.deadline !== null ? `due ${clearsLine(desk.deadline, now).replace(/^overdue since/, "since")}` : channel };
  const wakeAt = deskWakeAt(desk);
  if (wakeAt !== null && wakeAt < now) return { group: "stuck", mark: "stuck", words: "Check overdue", note: clearsLine(wakeAt, now).replace(/^overdue /, "") };
  const words = desk.waitingOn ? `Waiting on ${desk.waitingOn}` : "Waiting";
  return { group: "waiting", mark: "waiting", words, note: wakeAt !== null ? checksLine(wakeAt, now) : moved };
}

export function deskAsk(desk: BotDesk): { question: string; about: string } {
  const { person, subject } = deskParts(desk);
  if (desk.status === "blocked") return person ? { question: `${person} is waiting on your answer`, about: subject } : { question: subject, about: "The bot needs your answer" };
  if (desk.desk === "chat" || desk.desk === "whatsapp") {
    const [question = "", ...rest] = deskNeedLine(desk).split(" \u00b7 ");
    return { question, about: rest.join(" \u00b7 ") };
  }
  return { question: person ? `Approve the bot's reply to ${person}?` : "Approve the bot's draft?", about: subject };
}

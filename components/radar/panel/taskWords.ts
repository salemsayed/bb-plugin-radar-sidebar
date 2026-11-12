import { isClosed, STATE_LABEL, type Attempt, type BotTaskRow } from "@/lib/botTasks";
import { clearsLine, clockFormatter, clearsWeekdayFormatter, rowDetail } from "../BotsView";
import { elapsed } from "../elapsed";
import { laterLine, runBeforeCheck, scheduledWait, taskAsk } from "../stage";
import { plainQueue, waitingOn } from "../workText";

const dateFormatter = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });
export function checksLine(at: number, now: number) {
  if (at < now) return clearsLine(at, now);
  const days = Math.round((new Date(at).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / 86_400_000);
  const time = clockFormatter.format(new Date(at));
  const when = days === 0 ? time : days === 1 ? `tomorrow ${time}` : days < 7 ? `${clearsWeekdayFormatter.format(new Date(at))} ${time}` : `${dateFormatter.format(new Date(at))} ${time}`;
  return `next check ${when.replace(/\s+/g, "\u00a0")}`;
}
export function dayAndTime(at: number, now: number) {
  const days = Math.round((new Date(now).setHours(0, 0, 0, 0) - new Date(at).setHours(0, 0, 0, 0)) / 86_400_000);
  return days === 0 ? `today ${clockFormatter.format(new Date(at))}` : days === 1 ? `yesterday ${clockFormatter.format(new Date(at))}` : dateFormatter.format(new Date(at));
}
function afterRun(task: BotTaskRow): string {
  const run = task.wakeAt !== undefined ? runBeforeCheck(task.line, task.wakeAt) : "";
  return run ? `, after the ${run} run` : "";
}
export function taskStatus(task: BotTaskRow, now: number): string {
  if (task.displayState === "waiting" && task.wakeAt !== undefined) return `${STATE_LABEL.waiting} · ${checksLine(task.wakeAt, now)}${afterRun(task)}`;
  const detail = rowDetail(task, now);
  if (!isClosed(task.displayState)) return [STATE_LABEL[task.displayState], detail].filter(Boolean).join(" · ");
  const parts = detail ? detail.split(" · ") : [];
  const label = /^(Cancelled|Stopped)\b/.test(parts[0] ?? "") ? parts.shift()!.replace(/^(Cancelled|Stopped) (?:from the task header|by hand)\.?$/i, "$1") : /^Closed by (?:Salem|you)\b/i.test(parts[0] ?? "") ? (parts.shift(), "Closed by you") : STATE_LABEL[task.displayState];
  return [label, task.completedAt !== undefined ? dayAndTime(task.completedAt, now) : "", ...parts].filter(Boolean).join(" · ");
}
const CHECKING = /not checked|checks needed|check failed|hasn't (?:checked|closed|finished)|evidence needs review|owner review/i;
export const CRITERIA = /^checking (\d+) of (\d+) criteria/i;
const NO_CHECK = "no check scheduled";
const IDLE_WAIT = "Waits for its worker to finish";
export interface IdleWait { title: string; running: boolean; idleFor?: string }

export function cardStatus(task: BotTaskRow, running: Attempt[], now: number, waitsOn?: IdleWait | null, botName = ""): string {
  const state = task.displayState;
  if (task.later) return laterLine(task.later, botName);
  if (state === "needs") return taskAsk(task) || "Waiting on you";
  if (state === "working" || running.length && !isClosed(state)) {
    const first = [...running].sort((a, b) => (a.startedAt ?? now) - (b.startedAt ?? now))[0];
    if (!first) return "Working";
    const age = first.startedAt != null ? elapsed(first.startedAt, now) : "";
    if (age === "now") return running.length > 1 ? `${running.length} workers \u00b7 just started` : "Just started";
    const span = age ? ` for ${age}` : "";
    return running.length > 1 ? `${running.length} workers · working${span}` : `Working${span}`;
  }
  if (isClosed(state)) {
    const [label = "", when = ""] = taskStatus(task, now).split(" · ");
    const unconfirmed = state === "done" && /\bRecorded done\b.*(?:owner review|evidence needs review)/i.test(task.line);
    return [unconfirmed ? "Done, not confirmed yet" : label, when].filter(Boolean).join(" · ");
  }
  if (state === "waiting" && task.wakeAt !== undefined) {
    const when = checksLine(task.wakeAt, now);
    const line = when.startsWith("next check ") ? `Next check ${when.slice(11)}${afterRun(task)}` : `Check ${when}`;
    if (task.waitFor !== "someone else") return line;
    const who = task.waitOn ?? waitingOn(task.line, task.outcome, task.ask?.excerpt);
    return `${who ? `Waiting on ${who}` : "Waiting on someone else"} · ${line[0]!.toLowerCase()}${line.slice(1)}`;
  }
  const line = task.line;
  if (/^Its machine is off/.test(line)) return "Machine off · resumes when it is back";
  if (/^Queued/.test(line)) {
    const why = plainQueue(line).split(" · ")[0]!;
    const label = /^(?:Starts|Not started)/.test(why) ? why : "Queued";
    return task.retryAt && task.retryAt > now ? `${label} · next try ${clockFormatter.format(new Date(task.retryAt))}` : label;
  }
  if (/^Retrying/.test(line)) return "Retrying after an error";
  if (/^Wake was due/.test(line) || state === "overdue") return "Check overdue";
  if (/^Filed\. Not started/.test(line) || state === "ready") return "Not started";
  if (/^With the bot/.test(line)) return "With the bot";
  const criteria = CRITERIA.exec(line);
  if (criteria) return `Checking its ${criteria[2]} ${criteria[2] === "1" ? "goal" : "goals"}`;
  if (CHECKING.test(line) || state === "checking") return "Result waits for the bot's check";
  const scheduled = scheduledWait(line);
  if (scheduled === IDLE_WAIT && !running.length && waitsOn) return waitsOn.running ? `Waits for the ${waitsOn.title} worker to finish` : `Its worker is idle${waitsOn.idleFor ? ` for ${waitsOn.idleFor}` : ""} · ${NO_CHECK}`;
  if (scheduled) return scheduled;
  if (task.waitFor === "someone else") { const who = task.waitOn ?? waitingOn(task.line, task.outcome, task.ask?.excerpt); return `${who ? `Waiting on ${who}` : "Waiting on someone else"} · ${NO_CHECK}`; }
  if (state === "offline") return "Machine off";
  if (state === "queued") return "Queued";
  return `Waiting on ${task.waitFor === "you" ? "you" : "the bot"} · ${NO_CHECK}`;
}
export function attemptStatus(attempt: Attempt, now: number): string {
  if (attempt.state === "running") return attempt.startedAt == null ? "working" : elapsed(attempt.startedAt, now) === "now" ? "just started" : `working for ${elapsed(attempt.startedAt, now)}`;
  if (attempt.state === "unknown") return "";
  return attempt.endedAt != null && elapsed(attempt.endedAt, now) !== "now" ? `${attempt.state} ${elapsed(attempt.endedAt, now)}` : attempt.state;
}

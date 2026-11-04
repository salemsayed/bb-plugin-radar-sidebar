const TECHNICAL_ID = /\s*\b(?:thr|env|proj|host|notif)_[a-z0-9]{6,}\b/gi;

export function plainNote(text: string): string {
  return text
    .replace(TECHNICAL_ID, "")
    .replace(/\(\s*\)/g, "")
    .replace(/\s+([,;:.)])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function taskHeadline(title: string): string {
  const full = title.trim().replace(/\s+/g, " ");
  const bare = full.replace(/\s*\([^()]{12,}\)/g, "").replace(/\s{2,}/g, " ").trim();
  const base = bare.length >= 20 ? bare : full;
  const head = /^(.{20,110}?)(?::\s|;\s|\s[—–]\s)/.exec(base)?.[1];
  return (head ?? base).trim();
}

const SHORT_PART = 28;

export function splitStatus(status: string): { state: string; meta: string; note: string } {
  const [state = "", ...rest] = status.split(" · ");
  const meta: string[] = [], note: string[] = [];
  for (const part of rest) (part.length <= SHORT_PART && !note.length ? meta : note).push(part);
  return { state, meta: meta.join(" · "), note: note.join(" · ") };
}

export function youWords(text: string): string {
  const out = text.replace(/(?<![\w-])Salem's\b/g, "your").replace(/(?<![\w-])Salem\b(?!-)/g, "you").replace(/\bhis\b(?= (?:OK|go|answer|pick|choice|decision|call|ask|reply))/g, "your").trim();
  return out ? out[0]!.toUpperCase() + out.slice(1) : out;
}

const askTime = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const askDay = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });

export function askLine(ask: { excerpt: string; label: string; at?: number }, now: number): string {
  const who = /^(You asked|Relayed via ChatGPT|Bot request)/.exec(ask.label)?.[1] ?? "You asked";
  const sameDay = ask.at !== undefined && new Date(ask.at).toDateString() === new Date(now).toDateString();
  const when = ask.at === undefined ? ask.label.replace(/^[^,]*,\s*/, "") : sameDay ? askTime.format(new Date(ask.at)) : askDay.format(new Date(ask.at));
  const excerpt = ask.excerpt.replace(/\s+/g, " ").trim();
  return excerpt ? `${who} ${when}: \u201c${excerpt}\u201d` : `${who} ${when}`;
}

const CARD_RANK: Record<string, number> = { needs: 0, overdue: 1, offline: 1, retrying: 1, working: 2, queued: 3, checking: 3 };
export function cardOrder<T extends { displayState: string }>(tasks: T[]): T[] {
  return tasks.map((task, i) => ({ task, i })).sort((a, b) => (CARD_RANK[a.task.displayState] ?? 4) - (CARD_RANK[b.task.displayState] ?? 4) || a.i - b.i).map(x => x.task);
}

export type StateTone = "needs" | "blocked" | "busy" | "quiet" | "done" | "ended";

export function stateTone(state: string): StateTone {
  if (state === "needs") return "needs";
  if (state === "overdue" || state === "offline" || state === "retrying") return "blocked";
  if (state === "working" || state === "queued" || state === "checking") return "busy";
  if (state === "done") return "done";
  if (state === "cancelled" || state === "stopped") return "ended";
  return "quiet";
}

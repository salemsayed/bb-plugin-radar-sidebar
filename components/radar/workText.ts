const TECHNICAL_ID = /\s*\b(?:thr|env|proj|host|notif)_[a-z0-9]{6,}\b/gi;

export function plainNote(text: string): string {
  return text
    .replace(TECHNICAL_ID, "")
    .replace(/\(\s*\)/g, "")
    .replace(/\s+([,;:.)])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

const MARKDOWN = [
  [/^\s*#{1,6}\s+/, ""],
  [/\s+#{1,6}\s+/g, " · "],
  [/\[\d+\]\s*/g, ""],
  [/\[([^\]]+)\]\([^)]*\)/g, "$1"],
  [/\*\*|__|`/g, ""],
  [/\s+(?:\d+[.)]|[-*•])\s+(?=\S)/g, " · "],
  [/^(?:\d+[.)]|[-*•])\s+/, ""],
  [/(?:\s*·\s*){2,}/g, " · "],
] as const;

export function plainMarkdown(text: string): string {
  return MARKDOWN.reduce((out, [pattern, to]) => out.replace(pattern, to), text).replace(/\s{2,}/g, " ").trim();
}

const MERGE_REQUEST_REF = /\b[a-z][\w-]*!(\d+)\b/gi;
const ROUTE_PREFIX = /^(?:astra|terra|opus|sonnet|sol|fable|haiku|luna|codex|gpt[\w.-]*|claude[\w.-]*|browser)\s*(review|re-check|recheck|confirm|takeover|check|fix|build)?\s*:\s*/i;
const ROUTE_ONLY = /^(?:astra|terra|opus|sonnet|sol|fable|haiku|luna|codex|gpt[\w.-]*|claude[\w.-]*|browser)\s*(?:review|re-check|recheck|confirm|takeover|check|fix|build)?\s*:/i;

export function plainWorkerTitle(title: string): string {
  let out = title.trim().replace(MERGE_REQUEST_REF, "merge request $1");
  if (ROUTE_ONLY.test(out)) {
    const match = ROUTE_PREFIX.exec(out);
    const kind = match?.[1];
    out = out.slice(match?.[0].length ?? 0);
    if (kind) out = `${kind[0]!.toUpperCase()}${kind.slice(1).toLowerCase().replace("recheck", "re-check")}: ${out}`;
  }
  out = out.replace(/^merge request/, "Merge request");
  return out ? out[0]!.toUpperCase() + out.slice(1) : out;
}

const WAITING_ON = /\b(?:waiting|wait) (?:on|for) ((?:[A-Z][\w-]+)(?: [A-Z][\w-]+)?)(?:'s\b ?([\w-]+(?: [\w-]+)?)?)?/;

export function waitingOn(line: string): string {
  const match = WAITING_ON.exec(line);
  if (!match) return "";
  const who = match[1]!.replace(/^Salem$/, "you");
  if (/^(?:the|a|an|it|its|this|that|bot|Lab|Bricks|Home|Work|Personal|Security|ERBareeq)$/.test(who.split(" ")[0]!)) return "";
  return match[2] ? `${who}'s ${match[2]}` : who;
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

const RELAYED_WORDS = /^\s*Salem,?\s+(?:(?:thr_[a-z0-9]+|msg|seq)\s*#?\d*\s*)+(?:\([^)]*\))?,?\s*(?:word for word)?\s*:\s*["\u201c]?/i;
const INTERNAL_REF = /\s*(?:\bthr_[a-z0-9]+\s+)?\b(?:seq|msg)\s*#?\d+(?:\/\d+)*\b(?:\s*\(\d{1,2} [A-Z][a-z]{2} \d{4}\))?/g;
const ASKER = /^\s*(?:\[bb message from thread:[^\]]*\]?\s*)?(?:\S*\s*([\w ]{1,30}?) asks:\s*)?/u;

export function askLine(ask: { excerpt: string; label: string; at?: number }, now: number): string {
  const label = /^(You asked|Relayed via ChatGPT|Bot request)/.exec(ask.label)?.[1] ?? "You asked";
  const asker = ASKER.exec(ask.excerpt)?.[1]?.trim();
  const bare = ask.excerpt.replace(ASKER, "");
  const relayed = RELAYED_WORDS.test(bare);
  const who = relayed ? "You asked" : label === "Bot request" ? `${asker || "A bot"} asked` : label;
  const via = relayed && asker ? ` via ${asker}` : "";
  const sameDay = ask.at !== undefined && new Date(ask.at).toDateString() === new Date(now).toDateString();
  const when = ask.at === undefined ? ask.label.replace(/^[^,]*,\s*/, "") : sameDay ? askTime.format(new Date(ask.at)) : askDay.format(new Date(ask.at));
  const excerpt = plainNote(plainMarkdown(bare.replace(RELAYED_WORDS, "")).replace(INTERNAL_REF, "").replace(/\b(?:thr|env|proj|host)_[a-z0-9]+…?/gi, "").replace(/\(\s*[,;]\s*/g, "(").replace(/\s+/g, " ")).replace(/^[,;:\s]+/, "");
  return excerpt ? `${who} ${when}${via}: \u201c${excerpt}\u201d` : `${who} ${when}${via}`;
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

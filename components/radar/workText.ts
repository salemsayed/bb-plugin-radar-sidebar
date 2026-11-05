const TECHNICAL_ID = /\s*\b(?:thr|env|proj|host|notif|auto|ptask|evt)_[a-z0-9_-]{6,}\b/gi;
const HASH = "(?=[0-9a-f]*\\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}";
const HASH_AT = new RegExp(`\\s+(?:at|@|in|commit)\\s+${HASH}\\b`, "g");
const HASH_ALONE = new RegExp(`\\s*\\b${HASH}\\b`, "g");
const COMMENT_ID = /\s*\(?\b(?:issuecomment|discussion_r|pullrequestreview|note)[-_]\d+\b\)?/gi;

const REPO_MERGE_REQUEST = /\b[a-z][\w-]*!(\d+)\b/gi;

export function plainNote(text: string): string {
  return text
    .replace(REPO_MERGE_REQUEST, "merge request $1")
    .replace(TECHNICAL_ID, "")
    .replace(COMMENT_ID, "")
    .replace(HASH_AT, "")
    .replace(HASH_ALONE, "")
    .replace(/\bonto (?:master|main)\b/g, "onto the main branch")
    .replace(/\b(into|on|to|from|against) (?:the )?master\b/g, "$1 the main branch")
    .replace(/\(\s*[,;]\s*/g, "(")
    .replace(/\s*[,;]\s*\)/g, ")")
    .replace(/\(\s*\)/g, "")
    .replace(/\s+([,;:.)])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

const ROUTING_WORDS = /\b(?:model|profile|capacity|quota|spawn|eligible|route|routing|slot|downgrade|rate limit|account pool)\b/i;

export function plainQueue(line: string): string {
  const queued = /^Queued\b\s*[:·-]?\s*(.*)$/i.exec(line.trim());
  if (!queued) return line;
  const [reason = "", ...tail] = queued[1]!.split(" · ");
  const retry = tail.filter(part => /^retry\b/i.test(part)).join(" · ");
  const rest = tail.filter(part => !/^retry\b/i.test(part));
  if (reason && !ROUTING_WORDS.test(reason)) return line;
  const why = /\bbrowser\b/i.test(reason) ? "Waiting for a free browser worker" : /\b(?:machine|host|offline)\b/i.test(reason) ? "Waiting for its machine" : "Waiting for a free worker";
  return [why, retry, ...rest].filter(Boolean).join(" · ");
}

const SOURCE_CUT = 170;

export function cutAtWord(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const clipped = /(?:\u2026|\.\.\.)$/.test(flat);
  const body = flat.replace(/(?:\u2026|\.\.\.)$/, "").trimEnd();
  if (!clipped && body.length <= max) return body;
  let cut = body.length <= max ? body : body.slice(0, max + 1);
  const tail = /\S+$/.exec(cut)?.[0] ?? "";
  const partial = body.length > max || body.length >= SOURCE_CUT || /^(?:\d[\d.,:/-]*|[a-z])$/i.test(tail);
  const space = cut.lastIndexOf(" ");
  if (partial) cut = space > 0 ? cut.slice(0, space) : cut.slice(0, max);
  const kept = cut.replace(/[\s,;:\-\u2013\u2014(/\u201c"']+$/, "");
  return `${kept || cut}\u2026`;
}

const MARKDOWN = [
  [/^\s*#{1,6}\s+/, ""],
  [/\s+#{1,6}\s+/g, " · "],
  [/\[\d+\]\s*/g, ""],
  [/\[([^\]]+)\]\([^)]*\)/g, "$1"],
  [/\*\*|__|`/g, ""],
  [/(^|[\s(])_([^_\n]+)_(?=$|[\s.,;:!?)])/g, "$1$2"],
  [/\s+(?:\d+[.)]|[-*•])\s+(?=\S)/g, " · "],
  [/(\S)\*+(?=$|[\s.,;:!?…])/g, "$1"],
  [/(^|\s)\*+(?=\S)/g, "$1"],
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
  return capitalFirst(out);
}

export function capitalFirst(text: string): string {
  if (!text || /^[a-z]+[A-Z]/.test(text)) return text;
  return text[0]!.toUpperCase() + text.slice(1);
}

const WAITING_ON = /\b(?:waiting|wait) (?:on|for) ((?:[A-Z][\w-]+)(?: [A-Z][\w-]+)?)(?:'s\b ?([\w-]+(?: [\w-]+)?)?)?/;
const BOT_NAME = /^(?:Lab|Bricks|Home|Work|Personal|Security|ERBareeq) Bot$/;
const NEXT_THING = /\b(?:until|for|on|wait for|waiting for|:)?\s*the next (?:new )?((?:[a-z][\w-]* ){0,2}(?:ticket|order|reply|message|report|run|email|payment|delivery|build|release|image|update|answer|review))s?\b/i;
const UPSTREAM = /\b(?:no|until (?:an?|the)|waits? for (?:an?|the)) (?:clean |new |fixed |supported )?(?:official|upstream|vendor) (image|release|build|fix|patch|update)s?\b/i;
const GROUP = /\b(merchants|customers|clients|suppliers|vendors|installers|technicians|reviewers)\b/i;

function personWait(line: string): string {
  const match = WAITING_ON.exec(line);
  if (!match) return "";
  const who = match[1]!.replace(/^Salem$/, "you");
  if (BOT_NAME.test(who)) return who;
  if (/^(?:the|a|an|it|its|this|that|bot|Lab|Bricks|Home|Work|Personal|Security|ERBareeq|Salem|You)$/.test(who.split(" ")[0]!)) return "";
  return match[2] ? `${who}'s ${match[2]}` : who;
}

export function waitingOn(line: string, outcome = ""): string {
  const reason = line.replace(/^Waiting for [^:]{1,30}:\s*/, "");
  const person = personWait(reason);
  if (person) return person;
  const next = NEXT_THING.exec(reason);
  if (next) return `the next ${next[1]!.toLowerCase()}`;
  const upstream = UPSTREAM.exec(reason);
  if (upstream) return `an upstream ${upstream[1]!.toLowerCase()}`;
  const group = GROUP.exec(reason) ?? GROUP.exec(outcome);
  if (group) return group[1]!.toLowerCase();
  return "";
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

const YOU_VERBS: Record<string, string> = { is: "are", was: "were", has: "have", does: "do", says: "say", goes: "go" };
const NOT_VERBS = new Set(["always", "sometimes", "perhaps", "thus", "plus", "unless", "across", "towards", "besides", "this", "its", "his", "as", "us", "yes", "less"]);

function youVerb(word: string): string {
  const lower = word.toLowerCase();
  if (YOU_VERBS[lower]) return YOU_VERBS[lower]!;
  if (NOT_VERBS.has(lower) || word.length <= 3 || !/[^s]s$/.test(lower) || /[A-Z]/.test(word)) return word;
  return /(?:ss|sh|ch|x|o)es$/.test(lower) ? word.slice(0, -2) : /ies$/.test(lower) ? `${word.slice(0, -3)}y` : word.slice(0, -1);
}

export function youWords(text: string): string {
  const out = text.replace(/(?<![\w-])Salem's\b/g, "your")
    .replace(/(?<![\w-])Salem\b(?!-)(?:(\s+)([A-Za-z]+)\b)?(?:(\s+(?:or|and)\s+)([A-Za-z]+)\b)?/g, (_, gap?: string, word?: string, join?: string, second?: string) =>
      word ? `you${gap}${youVerb(word)}${join && second ? `${join}${youVerb(second)}` : ""}` : "you")
    .replace(/\bhis\b(?= (?:OK|go|answer|pick|choice|decision|call|ask|reply))/g, "your").trim();
  return capitalFirst(out);
}

const askTime = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const askDay = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });

const RELAYED_WORDS = /^\s*Salem,?\s+(?:(?:thr_[a-z0-9]+|msg|seq)\s*#?\d*\s*)+(?:\([^)]*\))?,?\s*(?:word for word)?\s*:\s*["\u201c]?/i;
const INTERNAL_REF = /\s*(?:\bthr_[a-z0-9]+\s+)?\b(?:seq|msg)\s*#?\d+(?:\/\d+)*\b(?:\s*\(\d{1,2} [A-Z][a-z]{2} \d{4}\))?/g;
const ASKER = /^\s*(?:\[bb message from thread:([^\]\s]*)\]?\s*)?(?:\S*\s*([\w ]{1,30}?) asks:\s*)?/u;

export interface AskParts { head: string; quote: string; full: string }

function cleanAsk(text: string): string {
  return plainNote(plainMarkdown(text.replace(RELAYED_WORDS, "")).replace(INTERNAL_REF, "").replace(/\b(?:thr|env|proj|host)_[a-z0-9]+\u2026?/gi, "").replace(/\(\s*[,;]\s*/g, "(").replace(/\s+/g, " ")).replace(/^[,;:\s]+/, "");
}

export function askParts(ask: { excerpt: string; full?: string; label: string; at?: number }, now: number, askerOf?: (threadId: string) => string | undefined): AskParts {
  const label = /^(You asked|Relayed via ChatGPT|Bot request)/.exec(ask.label)?.[1] ?? "You asked";
  const found = ASKER.exec(ask.excerpt);
  const asker = found?.[2]?.trim() || (found?.[1] ? askerOf?.(found[1]) : undefined);
  const bare = ask.excerpt.replace(ASKER, "");
  const relayed = RELAYED_WORDS.test(bare);
  const who = relayed ? "You asked" : label === "Bot request" ? `${asker || "A bot"} asked` : label;
  const via = relayed && asker ? ` via ${asker}` : "";
  const sameDay = ask.at !== undefined && new Date(ask.at).toDateString() === new Date(now).toDateString();
  const when = ask.at === undefined ? ask.label.replace(/^[^,]*,\s*/, "") : sameDay ? askTime.format(new Date(ask.at)) : askDay.format(new Date(ask.at));
  const quote = cleanAsk(bare);
  const full = ask.full ? cleanAsk(ask.full.replace(ASKER, "")) : quote;
  return { head: `${who} ${when}${via}`, quote, full: /(?:\u2026|\.\.\.)$/.test(full) ? cutAtWord(full, full.length) : full };
}

export const ASK_PREVIEW = 84;

export function askLine(ask: { excerpt: string; full?: string; label: string; at?: number }, now: number, askerOf?: (threadId: string) => string | undefined, max = ASK_PREVIEW): string {
  const { head, quote } = askParts(ask, now, askerOf);
  return quote ? `${head}: \u201c${cutAtWord(quote, max)}\u201d` : head;
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

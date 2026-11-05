const MODEL_WORD = "(?:Opus|Sonnet|Sol|Fable|Astra|Terra|Haiku|Luna|GPT-[\\w.-]+|\\d+(?:\\.\\d+)?-?Sol)";
const EFFORT = "(?:low|medium|high|xhigh|max)";
const ROLE = "(?:worker|workers|planner|scorer|builder|reviewer|judge|takeover|re-review|review|re-check|recheck|check|fix|build|thread|agent|helper|run)";

const MODEL = new RegExp(`\\b${MODEL_WORD}\\b`, "i");
const MODEL_ASIDE = new RegExp(`\\s*\\([^()]*\\b${MODEL_WORD}\\b[^()]*\\)`, "gi");
const MODEL_LEAD = new RegExp(`^${MODEL_WORD}\\s*(${ROLE})?\\s*:\\s*`, "i");
const MODEL_ROUTE = new RegExp(`\\s*\\b(?:on|via|with|using|to) (?:the )?(?:latest |newest )?${MODEL_WORD}(?: (?:and|or) ${MODEL_WORD})*(?: ${EFFORT})?(?: effort)?\\b`, "gi");
const MODEL_ROUTE_ONE = new RegExp(`\\b(?:on|via|with|using) (?:the )?(?:latest |newest )?${MODEL_WORD}\\b`, "i");
const MODEL_ROLE = new RegExp(`\\b(?:(an?) )?${MODEL_WORD}( ${EFFORT})? (?=${ROLE}\\b)`, "gi");
const MODEL_EFFORT = new RegExp(`\\b${MODEL_WORD} ${EFFORT}\\b`, "gi");
const MODEL_NOUN = new RegExp(`\\b${MODEL_WORD}\\s+(?=(?:UI|note|notes|fixes|pass|picks|plan|pick)\\b)`, "gi");
const MODEL_CLAUSE = new RegExp(`^(?:never |not |no |only |and |or )?${MODEL_WORD}\\b`, "i");

const PICTOGRAPH = /\p{Extended_Pictographic}/u;
const PICTO_ASIDE = /\s*\([^()]*\p{Extended_Pictographic}[^()]*\)/gu;
const PICTO_RUN = /(?:[\p{Extended_Pictographic}\u{1F1E6}-\u{1F1FF}][️‍\u{1F3FB}-\u{1F3FF}]*(?:\s*\/\s*)?)+\s*/gu;
const RELAY_GLYPH = /^\s*[↳⤷→]\s*/;

const PAYLOAD = /\s*(?:\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+_V\d+\b|[[{]\s*"[\w$-]+"\s*:)/;
const ESCAPED = /\\(["'\\/])/g;
const ESCAPED_SPACE = /\\[nrt]/g;

const PATH = /(?:~|\/(?:home|Users|root|tmp|var|etc|opt|srv|mnt))(?:\/[\w.@%+-]+)+\/?/g;
const PATH_ASIDE = /\s*\((?:[^()]*?\s)?(?:~|\/(?:home|Users|root|tmp|var|etc|opt|srv|mnt))\/[^()]*\)/g;
const URL = /\bhttps?:\/\/([\w.-]+)(?:\/[^\s)"”]*)?/g;

const BB_COMMAND = "bb (?:saelmbot|bot-automation|thread|plugin|memory|secret|secrets|browser-automation|own-chrome|voice|connect|guide|status|pool|composer-predictions)(?: [a-z][\\w-]*){0,3}";
const CLI_ASIDE = new RegExp(`\\s*\\((?:[^()]*?,\\s*)?${BB_COMMAND}(?:,[^()]*)?\\)`, "g");
const CLI_VIA = new RegExp(`\\s*\\b(?:through|via|with|using|by running) ${BB_COMMAND}\\b`, "g");
const CLI_ALONE = new RegExp(`\\b${BB_COMMAND}\\b`, "g");
const AUTOMATION_NAMED = /\bauto_[\w-]{6,}\s*\(([^()]{3,40})\)/g;
const AUTOMATION_AFTER_NOUN = /(\b(?:job|watcher|automation|watch|run|check|schedule)) auto_[\w-]{6,}\b/gi;
const LONG_ID = /\s*\b(?:(?:msg|message|conversation|id|ref)\s+)?(?=[a-z0-9]*\d)(?=[a-z0-9]*[a-z])[a-z0-9]{20,}\b/g;
const AUTOMATION_ALONE = /\bauto_[\w-]{6,}\b/g;
const THREAD_MENTION = /(?:\s+(?:on|in|at|from|see))?\s*@thread:\S*/g;
const THREAD_OBJECT = /@thread:\S+(?=\s+thread\b)/g;

export interface Shown { text: string; cut: boolean }

function cutPayload(text: string): Shown {
  const at = PAYLOAD.exec(text);
  if (!at || at.index < 12) return { text, cut: false };
  return { text: text.slice(0, at.index).trimEnd(), cut: true };
}

function tidy(text: string): string {
  return text
    .replace(/\(\s*[,;:]\s*/g, "(")
    .replace(/\s*[,;:]\s*\)/g, ")")
    .replace(/\(\s*\)/g, "")
    .replace(/\s+([,;:.)])/g, "$1")
    .replace(/\s+([!?])(?=$|["\u201d\u2019)])/g, "$1")
    .replace(/([,;:])(?:\s*[,;:])+/g, "$1")
    .replace(/:\s*([.;])/g, "$1")
    .replace(/(^|[.!?]\s+)[,;:]\s*/g, "$1")
    .replace(/[,;:]\s*$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function machine(text: string): Shown {
  const unescaped = text.replace(ESCAPED_SPACE, " ").replace(ESCAPED, "$1");
  const { text: kept, cut } = cutPayload(unescaped);
  const out = kept
    .replace(RELAY_GLYPH, "")
    .replace(PICTO_ASIDE, "")
    .replace(PICTO_RUN, "")
    .replace(PATH_ASIDE, "")
    .replace(PATH, path => {
      const parts = path.replace(/\/$/, "").split("/").filter(Boolean);
      const last = parts.at(-1) ?? "";
      return path.endsWith("/") ? `the ${last} folder` : last;
    })
    .replace(URL, (_, host: string) => host.replace(/^www\./, ""))
    .replace(THREAD_OBJECT, "the linked")
    .replace(THREAD_MENTION, "")
    .replace(CLI_ASIDE, "")
    .replace(CLI_VIA, "")
    .replace(CLI_ALONE, "")
    .replace(AUTOMATION_AFTER_NOUN, "$1")
    .replace(AUTOMATION_NAMED, "the $1")
    .replace(LONG_ID, "")
    .replace(AUTOMATION_ALONE, "its scheduled job")
    .replace(/>=\s*/g, "≥")
    .replace(/<=\s*/g, "≤");
  return { text: tidy(out), cut };
}

function dropModelClauses(sentence: string): string {
  const pieces = sentence.split(/(\s*[,;:]\s+|\s+(?:and|but) (?=[A-Z]))/);
  const out: string[] = [];
  for (let i = 0; i < pieces.length; i += 2) {
    const piece = pieces[i] ?? "";
    const join = pieces[i - 1] ?? "";
    if (MODEL_CLAUSE.test(piece.trim())) continue;
    out.push(out.length ? join : "", piece);
  }
  return out.join("");
}

export function withoutModels(text: string): string {
  if (!MODEL.test(text)) return text;
  let out = text.replace(MODEL_ASIDE, "").replace(/(^|[.!?]\s+)([^.!?;]{12,}):\s+([^.;:!?]*)/g, (whole, start: string, lead: string, list: string) =>
    list.includes(",") && list.split(/,\s*/).some(item => MODEL_ROUTE_ONE.test(item)) && !MODEL.test(lead) && lead.trim().split(/\s+/).length >= 3 ? `${start}${lead}` : whole);
  const lead = MODEL_LEAD.exec(out);
  if (lead) out = `${lead[1] ? `${lead[1][0]!.toUpperCase()}${lead[1].slice(1).toLowerCase()}: ` : ""}${out.slice(lead[0].length)}`;
  out = out
    .replace(MODEL_ROUTE, "")
    .replace(MODEL_ROLE, (_, article: string | undefined, _effort: string | undefined, at: number) => article ? `${article[0] === "A" ? "A" : "a"} ` : "")
    .replace(MODEL_EFFORT, "")
    .replace(MODEL_NOUN, "");
  out = out.split(/(?<=[.!?])\s+/).map(sentence => {
    const kept = tidy(dropModelClauses(sentence));
    const end = /[.!?]$/.exec(sentence.trim())?.[0];
    return kept && end && !/[.!?]$/.test(kept) ? `${kept}${end}` : kept;
  }).filter(Boolean).join(" ");
  out = tidy(out).replace(/^[a-z]/, letter => letter.toUpperCase());
  return MODEL.test(out) ? tidy(out.replace(new RegExp(`\\s*\\b${MODEL_WORD}\\b`, "gi"), "")) : out;
}

export function botWords(text: string): string {
  return withoutModels(machine(text).text);
}

export function botWordsShown(text: string): Shown {
  const { text: kept, cut } = machine(text);
  return { text: withoutModels(kept), cut };
}

const PASTE = /(\b(?:this|that|the|it|says?|said|reads?|read|message|text|line|alert)\s)([A-Z][^"“”‘’]{30,}?[.!?])(?=\s+[a-z])/g;

function markPaste(text: string): string {
  if (!/^[a-z]/.test(text.trim())) return text;
  return text.replace(PASTE, (whole, lead: string, body: string) => /[.:;]\s+[A-Z0-9]/.test(body) ? `${lead}‘${body}’` : whole);
}

export function userWordsShown(text: string): Shown {
  const { text: kept, cut } = machine(text);
  return { text: markPaste(kept), cut };
}

export function hasPictograph(text: string): boolean {
  return PICTOGRAPH.test(text);
}

const KEEP_CASE = /^(?:bb|iOS|iPhone|iPad|iPadOS|macOS|npm|eSIM|ffmpeg|git|gh|t\.[\w.-]+)\b/;

export function keepsCase(text: string): boolean {
  return KEEP_CASE.test(text) || /^[a-z][\w-]*\.[a-z]/.test(text) || /^[a-z]+[A-Z]/.test(text);
}

const NOTE = /^(?:FYI\b|heads[- ]up\b|for your info\b|note:|clarification:|[A-Z][\w-]*(?: Bot)? (?:disabled|enabled|removed|closed|blocked|moved|fixed|deployed|restored|rotated|turned off)\b)|\bnotice\b|\b(?:no (?:reply|action|response|answer)(?: (?:to me|from you))? (?:is )?(?:needed|required)|nothing (?:for you )?to do)\b/i;
const FINISHED = /^\s*[↳⤷]|\b(?:finished|completed|is done|wake due|wake-up due)\s*\.?$/i;
const REQUEST = /\?|\b(?:please|can you|could you|would you|need(?:s)? you to|decide|approve|confirm|choose|pick|your call|go-ahead|reply)\b/i;

export type AskKind = "ask" | "note" | "update";

export function askKind(text: string): AskKind {
  const flat = text.trim();
  if (FINISHED.test(flat)) return "update";
  if (NOTE.test(flat)) return "note";
  if (!REQUEST.test(flat) && /\bwake\b/i.test(flat) && flat.length < 40) return "update";
  return "ask";
}

const NUMBER_TAIL = /[\d.,]$/;

const CUT_TAIL = /(?:^|\s)(?:the|a|an|of|to|for|with|through|whether|that|on|in|at|by|from|and|or|\d[\d.,]*)$/i;
const CLAUSE_WORD = /\s(?:whether|that|has|have|had|is|are|was|were|skips|waits|keeps|gets|can|will|does)\s/i;

const PHRASE_STOP = /\s(?=(?:before|after|through|under|without|while|when|because|until|unless|so that|so|which|versus|and that|and whether)\s)|,\s(?=(?:and|so|but|which|with|while|then)\s)|;\s|\s\(|\s[–—-]\s/g;
const TITLE_SHORT = 64;
const TITLE_LONG = 92;
const TITLE_MIN = 24;

function clauseOf(full: string, from: number): string {
  const end = /[;:.!?(]|\s[–—-]\s|,\s(?=(?:and|so|but|which)\s)/.exec(full.slice(from));
  return (end ? full.slice(0, from + end.index) : full).trim();
}

function stopBefore(text: string, min: number, max: number): string {
  let best = "";
  for (const match of text.matchAll(PHRASE_STOP)) {
    const at = match.index!;
    if (at < min || at > max) continue;
    const head = text.slice(0, at).replace(/[\s,;:]+$/, "");
    if (!CUT_TAIL.test(head) && (head.match(/\(/g)?.length ?? 0) === (head.match(/\)/g)?.length ?? 0)) best = head;
  }
  return best;
}

export function wholeTitle(title: string, outcome: string | undefined): string {
  const head = title.trim();
  const full = (outcome ?? "").trim();
  if (!full || full.length <= head.length || !full.startsWith(head)) return head;
  if (!CUT_TAIL.test(head) && !CLAUSE_WORD.test(` ${head} `)) return head;
  const next = full[head.length]!;
  let from = head.length;
  if (NUMBER_TAIL.test(head) && /[\d.,]/.test(next)) from += (/^[\d.,]+\d/.exec(full.slice(head.length))?.[0] ?? "").length;
  else if (/[,;:.!?)]/.test(next)) return head;
  const clause = clauseOf(full, from);
  if (clause.length <= TITLE_SHORT) return clause;
  return stopBefore(clause, from, TITLE_SHORT) || stopBefore(clause, TITLE_MIN, TITLE_SHORT)
    || (clause.length <= TITLE_LONG ? clause : stopBefore(clause, from, TITLE_LONG)) || head.replace(/(?:\s+(?:the|a|an|of|to|for|with|through|whether|that|on|in|at|by|from|and|or))+$/i, "");
}

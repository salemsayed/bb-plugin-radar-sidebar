import { askKind, botWords, botWordsShown, keepsCase, requestsSomething, userWordsShown } from "./displayText";

const TECHNICAL_ID = /\s*\b(?:thr|env|proj|host|notif|auto|ptask|evt)_[a-z0-9_-]{6,}\b/gi;
const HASH = "(?=[0-9a-f]*\\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}";
const HASH_AT = new RegExp(`\\s+(?:at|@|in|commit|head)\\s+${HASH}\\b`, "g");
const HASH_TO = new RegExp(`\\s+(?:to|onto)\\s+${HASH}\\b`, "g");
const HASH_ALONE = new RegExp(`\\s*\\b${HASH}\\b`, "g");
const HASH_ASIDE_LEAD = new RegExp(`\\((?:at|in|on|commit|head)\\s+${HASH}\\s*[,;]\\s*`, "g");
const HASH_ASIDE = new RegExp(`\\s*\\((?:(?:at|in|on|commit|head)\\s+)?${HASH}\\)`, "g");
const COMMENT_ID = /\s*\(?\b(?:issuecomment|discussion_r|pullrequestreview|note)[-_]\d+\b\)?/gi;

const REPO_MERGE_REQUEST = /\b[a-z][\w-]*!(\d+)\b/gi;
const MEMORY_SLUG_ASIDE = /\s*\((?:shared |global |project )?memory (?:mem_)?[a-z0-9]+(?:-[a-z0-9]+)+\)/gi;
const MEMORY_SLUG = /\b(?:shared |global |project )?memory (?:mem_)?[a-z0-9]+(?:-[a-z0-9]+)+\b/gi;
const NO_MODEL = /\bno (?:AI |LLM )?model\b/gi;
const NO_MODEL_LISTED = /,\s*no (?:AI |LLM )?model\b/gi;
const NO_MODEL_LEAD = /(?<=\()no (?:AI |LLM )?model,\s*/gi;
const BREADCRUMB = /\b([A-Z][\w-]*(?: [A-Z][\w-]*)?) > ([A-Z][\w-]*(?: [A-Z][\w-]*)?)( (?:pages?|tabs?|screens?|sections?|menus?|lists?))?/g;
const FILE_NOUN: Record<string, string> = { AGENTS: "agent instructions", CLAUDE: "agent instructions", README: "readme", HANDOFF: "handoff notes", AUDIT: "change log", CHANGELOG: "change log", MEMORY: "memory notes", USER: "profile notes", SOUL: "persona notes", PLUGINS: "plugin map", SHARED: "shared notes", LOOP: "runbook" };
const FILE_NAME = /\b([A-Za-z][\w-]*)\.(?:md|json|jsonl|ya?ml|toml|tsx?|py|sh|txt|env|log|sql|csv)\b/g;
const FILE_ITEM = /\s*\((?:see |in )?(?:[A-Za-z][\w-]*\.(?:md|json|ya?ml|tsx?|jsx?|py|sh|txt))(?: item \d+)?\)/g;
const REDACTED_AFTER = /\b(on|in|for|of|to|from|with|by|at) ([a-z]+) \[redacted\]/gi;
const REDACTED = /\s*\[redacted\]/gi;
const SKILL_WITH = /\s*,?\s*\b(?:with|using|via|through|by) (?:the |its |a |an )?[a-z0-9]+(?:-[a-z0-9]+)+ skill\b/gi;
const SKILL_SLUG = /\b(?:the |its |a |an )?[a-z0-9]+(?:-[a-z0-9]+)+ skill\b/gi;
const SEQ_REF = /\s*\((?:seq|msg)\s*#?\d+(?:\/\d+)*\)|\s*\b(?:seq|msg)\s*#?\d+(?:\/\d+)*\b/gi;
const WHO_ASIDE = /\s*\((?:Salem|you)\)/g;
const PROVIDER_TOPIC = /\b(?:Codex|Claude|OpenAI|Anthropic|GPT[\w.-]*)\s+(phase-out|switch|migration|rollout|cutover)\b/g;
const ASK_REF = /[,;]?\s*\b(?:(?:asked|filed|raised|tracked|sent|logged)\s+)?(?:in|as|via|under)\s+bask_[a-z0-9]+\b/gi;
const ASK_ID = /\s*\(?\bbask_[a-z0-9]+\b\)?/gi;
const HTTP_ASIDE = /\s*\((?:HTTP|status)\s*\d{3}\)/gi;
const HTTP_CODE = /\b(?:an? )?HTTP\s*\d{3}(?: error)?\b/gi;
const BUILD_TAG = /\s*\b(?:prod|staging|release|build)-[0-9a-f]{6,}\b/gi;
const IP = "\\d{1,3}(?:\\.\\d{1,3}){3}(?:\\/\\d{1,2})?(?::\\d{2,5})?";
const IP_EXIT = new RegExp(`\\bexit\\s+(?:IP\\s+)?${IP}`, "g");
const IP_AFTER = new RegExp(`\\s*(?:\\((?:at|on|via|IP|address)\\s+${IP}\\)|\\b(?:at|on|via|IP|address)\\s+${IP}\\b)`, "g");
const IP_ALONE = new RegExp(`\\s*(?:\\(${IP}\\)|\\b${IP}\\b)`, "g");
const REPO_BEFORE = /\b(?:the |its |a )?([a-z][a-z0-9]*(?:-[a-z0-9]+)+)\s+(branch|repo|repository|worktree|checkout)\b/g;
const PROJECT_SLUG = /\bproject ([a-z][a-z0-9]*(?:-[a-z0-9]+)*)\b(?!-)/g;
const TRAILING_HEADING = /([.!?])\s+(?:Final result|Results?|Next steps?|Summary|Evidence|Proof|Status|Notes?|Details|Outcome|Open items|What changed|Findings)\s*:?\s*$/;

const NAMED_COORDINATOR = /\bthe (Personal|Home|Bricks|Work|ERBareeq|Lab|Security) coordinator\b/g;
const COORDINATOR_TASKS = /\bcoordinator (tasks?)\b/g;
const COORDINATOR_OWNS = /\bthe coordinator(?:['\u2019]s)?\b/g;
const COORDINATORS = /\bcoordinators?\b/g;
const HANDOFF_RECORDS = /\b(?:the )?rollover handoff (?:records?|notes?)\b/g;
const ROLLOVER = /\b(?:a |the )?rollovers?\b/g;
const CORE_PREFIX = /(^|["\u201c]\s*|[\u21b3\u2937]\s*)Core:\s+/g;
const COMPONENT_ASIDE = /\s*\((?:Lab|bots?|Bots|the bots) core\)/g;
const TYPESAFE = /\b(?:the |its )?TypeSafe skill\b/g;
const AUTO_EFFORT = /\b(?:(through|via|with|using) )?Auto Effort\b/g;
const API_PATH = / \/([a-z][\w-]*)(?= (?:returns|actually|endpoint|route|call|works|fails|responds)\b)/g;
const RETURNS_OK = /\breturns (?:HTTP )?2\d\d\b/g;
const RETURNS_ERROR = /\breturns (?:HTTP )?[45]\d\d\b/g;
const ENUM = /\b([A-Z]{2,})((?:_[A-Z]{2,})+)\b/g;
const ON_PROD = /\bon prod\b/g;
const PACKAGE_ASIDE = /\s*\((?:com|org|net|io|app|dev)\.[a-z0-9]+(?:\.[a-z0-9]+)+\)/g;
const PACKAGE_ID = /\s*\b(?:com|org|net)\.[a-z0-9]+(?:\.[a-z0-9]+)+\b/g;
const TEST_ACCOUNT = /\s+(?:with|using|on account) \d{6,}\b/g;

const PIPELINE_WORDS: [RegExp, string][] = [
  [/\bcapacity shortfalls? queues?(?: with (?:their )?deadlines)?/g, "work waits for a free worker and keeps its deadline"],
  [/\b(?:our )?local sibling-bridge daemon patch\b/g, "our own local patch"],
  [/\b(?:model[- ])?routing status check\b/g, "check of which models the bots use"],
  [/^Routing is live\b/g, "The new model setup is live"],
  [/\bclaims and census\b/g, "thread owners and counts"],
];

function pipelineWords(text: string): string {
  return PIPELINE_WORDS.reduce((out, [pattern, words]) => out.replace(pattern, words), text);
}

export function botTokens(text: string, _keepNames = false): string {
  return text
    .replace(PROVIDER_TOPIC, "model $1")
    .replace(NAMED_COORDINATOR, "$1 Bot")
    .replace(COORDINATOR_TASKS, "main-chat $1")
    .replace(COORDINATOR_OWNS, whole => /s$/.test(whole) ? "the bot's" : "the bot")
    .replace(COORDINATORS, word => word.endsWith("s") ? "main chats" : "main chat")
    .replace(HANDOFF_RECORDS, "the notes a bot leaves when it starts a fresh chat")
    .replace(ROLLOVER, whole => /^the /.test(whole) ? "the move to a fresh chat" : /^a /.test(whole) ? "a fresh chat" : /s$/.test(whole) ? "fresh chats" : "fresh-chat")
    .replace(CORE_PREFIX, "$1")
    .replace(COMPONENT_ASIDE, "")
    .replace(TYPESAFE, "the question-writing guide")
    .replace(AUTO_EFFORT, (_, lead?: string) => lead ? "with automatic effort per worker" : "automatic worker effort")
    .replace(/[^]*/, pipelineWords)
    .replace(API_PATH, " $1 command")
    .replace(RETURNS_OK, "reports success")
    .replace(RETURNS_ERROR, "reports an error")
    .replace(ENUM, (_, head: string, tail: string) => `${head[0]}${head.slice(1).toLowerCase()}${tail.replace(/_/g, " ").toLowerCase()}`)
    .replace(ON_PROD, "in production")
    .replace(PACKAGE_ASIDE, "")
    .replace(PACKAGE_ID, "")
    .replace(TEST_ACCOUNT, "")
    .replace(IP_EXIT, "the new exit address")
    .replace(IP_AFTER, "")
    .replace(IP_ALONE, "")
    .replace(REPO_BEFORE, (whole, _slug: string, noun: string) => /^(?:the|its|a) /.test(whole) ? `${whole.split(" ")[0]} ${noun}` : noun)
    .replace(PROJECT_SLUG, "the $1 project");
}

export function botFiles(text: string, keepNames = false): string {
  return botTokens(text, keepNames)
    .replace(FILE_ITEM, "")
    .replace(FILE_NAME, (_, name: string) => FILE_NOUN[name.toUpperCase()] ?? `${name.toLowerCase().replace(/[-_]+/g, " ")} file`)
    .replace(REDACTED_AFTER, "$1 the $2")
    .replace(REDACTED, "")
    .replace(SKILL_WITH, "")
    .replace(SKILL_SLUG, "a skill");
}

export function plainNote(text: string, keepNames = false): string {
  return plainText(botFiles(botWords(text), keepNames));
}

const GITHUB_STATE: Record<string, string> = { MERGEABLE: "can merge", CONFLICTING: "has conflicts", UNSTABLE: "checks unstable", BEHIND: "behind the main branch" };
const STATE_WORD = new RegExp(`\\b(${Object.keys(GITHUB_STATE).join("|")})\\b`, "g");
const RUN_ID = /\b(run|job|pipeline|build|workflow)\s+#?\d{6,}\b/gi;
const SLASH_COMMAND = /(^|[\s(])\/([a-z][a-z]+)-([a-z]+)\b(?:\s+(?:xhigh|high|max|medium|low))?/g;
const CLI_FLAG = /\s+(?:added |run |called )?(?:with |using |via )?--[a-z][\w-]+\b/g;

const TECH_WORDS: [RegExp, string][] = [
  [/\boff Codex\b/g, "off the old models"],
  [/,?\s*Codex only reviews\b/g, ", the old models only review"],
  [/\bon Claude\b/g, "on the main models"],
  [/\breaching Claude\b/g, "reaching the AI model"],
  [/\bthe Claude provider\b/g, "the AI provider"],
  [/\bsimulator CI\b/g, "simulator checks"],
  [/\bCI on (?:the )?fork\b/g, "checks on the fork"],
  [/\breal-iPhone (?:iOS app build|IPA|app build)(?: with (?:a |the )?local bundle)?/g, "real-iPhone app build"],
  [/\brebase, ready, CI \+ /g, "rebase, mark ready, checks, "],
  [/\bCI \+ /g, "checks, "],
  [/\bCI\b(?!\/)/g, "checks"],
];

export function plainTech(text: string): string {
  return TECH_WORDS.reduce((out, [pattern, words]) => out.replace(pattern, words), text);
}

export function plainText(text: string): string {
  return text
    .replace(/\bthe [a-z][\w-]*!(\d{3,}) job\b/gi, "merge request $1")
    .replace(/\bthe !(\d{3,}) job\b/g, "merge request $1")
    .replace(/\bthe (\d{3,}) job\b/g, "merge request $1")
    .replace(STATE_WORD, (word: string) => GITHUB_STATE[word]!)
    .replace(RUN_ID, "$1")
    .replace(/\b(?:TS|CI|test|tests) runs? (?:is |are )?green\b/gi, "checks passed")
    .replace(SLASH_COMMAND, (_, lead: string, a: string, b: string) => `${lead}a ${a} ${b}`)
    .replace(CLI_FLAG, "")
    .replace(/\bbase (?:master|main)\b/g, "based on the main branch")
    .replace(/\brange-diff unchanged\b/g, "same changes")
    .replace(/\bxhigh\b/g, "thorough")
    .replace(/\bIPA\b/g, "iOS app build")
    .replace(/[^]*/, plainTech)
    .replace(REPO_MERGE_REQUEST, "merge request $1")
    .replace(/(^|[\s(])!(\d{3,})\b/g, "$1merge request $2")
    .replace(MEMORY_SLUG_ASIDE, "")
    .replace(MEMORY_SLUG, "a saved rule")
    .replace(NO_MODEL_LISTED, "")
    .replace(NO_MODEL_LEAD, "")
    .replace(NO_MODEL, "no AI")
    .replace(BREADCRUMB, (_, area: string, page: string, noun = "") => `${page}${noun} under ${area}`)
    .replace(TRAILING_HEADING, "$1")
    .replace(ASK_REF, "")
    .replace(ASK_ID, "")
    .replace(SEQ_REF, "")
    .replace(WHO_ASIDE, "")
    .replace(HTTP_ASIDE, "")
    .replace(HTTP_CODE, "an error")
    .replace(BUILD_TAG, "")
    .replace(TECHNICAL_ID, "")
    .replace(WHO_ASIDE, "")
    .replace(COMMENT_ID, "")
    .replace(HASH_ASIDE_LEAD, "(")
    .replace(HASH_ASIDE, "")
    .replace(HASH_AT, "")
    .replace(HASH_TO, "")
    .replace(HASH_ALONE, "")
    .replace(/\bonto (?:master|main)\b/g, "onto the main branch")
    .replace(/\b(into|on|to|from|against) (?:the )?master\b/g, "$1 the main branch")
    .replace(/\(\s*[,;]\s*/g, "(")
    .replace(/\s*[,;]\s*\)/g, ")")
    .replace(/\(\s*\)/g, "")
    .replace(/\b(?:to|onto|at|on) (?=\()/g, "")
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
  const why = /\b(?:machine|host|offline)\b/i.test(reason) ? "Starts when its machine is back" : /\bbrowser\b/i.test(reason) ? "Its browser test hasn't started yet" : "Its next step hasn't started yet";
  return [why, retry, ...rest].filter(Boolean).join(" · ");
}

export function cutAtWord(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const clipped = /(?:\u2026|\.\.\.)$/.test(flat);
  const body = flat.replace(/(?:\u2026|\.\.\.)$/, "").trimEnd();
  if (!clipped && body.length <= max) return body;
  let cut = body.length <= max ? body : body.slice(0, max + 1);
  const tail = /\S+$/.exec(cut)?.[0] ?? "";
  const partial = body.length > max || clipped && !/[.!?;:,)\]"\u201d\u2019']$/.test(tail);
  const space = cut.lastIndexOf(" ");
  if (partial) cut = space > 0 ? cut.slice(0, space) : cut.slice(0, max);
  const kept = dropFunctionTail(cut.replace(/[\s,;:\-\u2013\u2014(/\u201c"']+$/, ""));
  return `${kept || cut}\u2026`;
}

const FUNCTION_WORD = /^(?:a|an|the|to|of|in|on|at|by|for|from|with|into|onto|about|via|per|and|or|but|nor|so|as|than|then|that|which|who|whom|whose|what|whats|what's|when|where|while|whether|if|is|are|was|were|be|been|being|am|your|my|our|their|his|her|its|this|these|those|how|not|no|i|you|we|they|he|she|it|do|does|did|has|have|had|will|would|can|could|should|may|might|must|also|just|very|whats|im|i'm|it's|its)$/i;

export function dropFunctionTail(text: string): string {
  const words = text.split(" ");
  while (words.length > 3 && FUNCTION_WORD.test(words[words.length - 1]!.replace(/[^\p{L}'\u2019]/gu, ""))) words.pop();
  return words.join(" ").replace(/[\s,;:\-\u2013\u2014(/\u201c"']+$/, "");
}

const CLAUSE_END = /[.;!?](?=\s)|,(?=\s)/g;

export function clauseCut(text: string, max: number): string {
  if (text.length <= max) return text;
  let end = -1;
  for (const match of text.slice(0, max).matchAll(CLAUSE_END)) {
    const head = text.slice(0, match.index!);
    if ((head.match(/\(/g)?.length ?? 0) === (head.match(/\)/g)?.length ?? 0)) end = match.index!;
  }
  return end >= 12 ? `${text.slice(0, end).trimEnd()}\u2026` : "";
}

export function capCut(text: string, cap: number): string {
  const flat = text.trim();
  if (flat.length < cap - 1 || /[.!?]$/.test(flat)) return flat;
  const sentences = /^(.*(?<!\b(?:e\.g|i\.e|etc|vs|approx))[.!?])(?=["\u201d\u2019)]?\s)/.exec(flat)?.[1];
  if (sentences && sentences.length >= 40) return `${sentences}\u2026`;
  return clauseCut(flat, flat.length - 1) || cutAtWord(`${flat}\u2026`, flat.length);
}

const MARKDOWN = [
  [/(\*\*[^*]+\*\*)\s*`[a-z][\w-]*`/g, "$1"],
  [/^\s*#{1,6}\s+/, ""],
  [/\s+#{1,6}\s+/g, " · "],
  [/\[\d+(?:\.\d+)*\]\s*/g, ""],
  [/\[([^\]]+)\]\([^)]*\)/g, "$1"],
  [/\*\*|__|`/g, ""],
  [/(^|[\s(])_([^_\n]+)_(?=$|[\s.,;:!?)])/g, "$1$2"],
  [/(^|[\n.:;!?])[ \t]*\n?\s*\d{1,2}[.)]\s+(?=\S)/g, "$1 · "],
  [/\s+[-*•]\s+(?=\S)/g, " · "],
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

const MODEL = "(?:Opus|Sonnet|Sol|Fable|Astra|Terra|Haiku|Luna|Codex|GPT[\\w.-]*|Claude[\\w.-]*)";
const MODEL_ASIDE = new RegExp(`\\s*\\((?:on |via |with )?${MODEL}(?: [\\w-]+){0,2}\\)`, "gi");
const MODEL_ROLE = new RegExp(`\\b${MODEL}\\s+(?=(?:scorers?|builders?|reviewers?|judges?|workers?|takeover|re-check|recheck|reviews?|checks?|fix|build|routes?)\\b(?!-))`, "gi");

export function plainWorkerTitle(title: string): string {
  let out = botTokens(botWords(title.trim())).replace(/(^|\s)\/code-review\b(?:\s+(?:xhigh|high|max|medium|low))?/g, "$1code review").replace(/\bIPA\b/g, "iOS app build").replace(/[^]*/, plainTech).replace(/^Repair:\s*/i, "Fixing ").replace(SEQ_REF, "").replace(ASK_ID, "").replace(BUILD_TAG, "").replace(MERGE_REQUEST_REF, "merge request $1").replace(MODEL_ASIDE, "").replace(MODEL_ROLE, "");
  out = out.replace(/^Radar:\s+/, "Sidebar: ");
  if (ROUTE_ONLY.test(out)) {
    const match = ROUTE_PREFIX.exec(out);
    const kind = match?.[1];
    out = out.slice(match?.[0].length ?? 0);
    if (kind) out = `${kind[0]!.toUpperCase()}${kind.slice(1).toLowerCase().replace("recheck", "re-check")}: ${out}`;
  }
  out = out.replace(/:\s*(?:workers?|reviews?|reviewers?)(?:\s*(?:,|and)\s*(?:workers?|reviews?|reviewers?))*\s*$/i, "").replace(/^merge request/, "Merge request").replace(/(?<![\w-])Salem['\u2019]s\b/g, "your").replace(/(?<![\w-])Salem\b(?![-\w])/g, "you");
  return capitalFirst(out);
}

export function capitalFirst(text: string): string {
  if (!text || keepsCase(text)) return text;
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

const YOUR_NOUN = /(?<![\w-])Salem(?:['\u2019]s)? (approval|go-ahead|go|OK|okay|answer|decision|call|sign-off|reply|review|pick|choice|input|confirmation|consent|permission|word|words|request|ask)\b/g;

const HIS_WORDS = /((?<![\w-])Salem\b[^"\u201c\u201d]{0,160}?)\bhis (words|choices?|go|call|pick)\b/g;

export function youWords(text: string): string {
  const out = text.replace(HIS_WORDS, "$1your $2").replace(YOUR_NOUN, "your $1").replace(/(?<![\w-])Salem['\u2019]s\b/g, "your")
    .replace(/(?<![\w-])Salem\b(?!-)(?:(\s+)((?:[a-z]+ly\s+)?)([A-Za-z]+)\b)?(?:(\s+(?:or|and)\s+)([A-Za-z]+)\b)?/g, (_, gap?: string, adverb?: string, word?: string, join?: string, second?: string) =>
      word ? `you${gap}${adverb ?? ""}${youVerb(word)}${join && second ? `${join}${youVerb(second)}` : ""}` : "you")
    .replace(/\bhis\b(?= (?:OK|go|answer|pick|choice|decision|call|ask|reply))/g, "your").trim()
    .replace(/([.!?]["\u201d\u2019]?\s+)(you|your)\b/g, (_, end: string, word: string) => `${end}${word[0]!.toUpperCase()}${word.slice(1)}`);
  return capitalFirst(out);
}

const OTHER_MAN = /\b(?:Mohamed|Mohammed|Muhammad|Ahmed|Ahmad|Mahmoud|Mostafa|Moustafa|Mustafa|Yasser|Yaser|Sherif|Islam|Omar|Ali|Hassan|Hussein|Khaled|Karim|Kareem|Amr|Tarek|Tareq|Hany|Hesham|Hisham|Medo|Ibrahim|Youssef|Yousef|Ashraf|Adel|Sameh|Walid|Ehab|Tamer|Osama|Ayman|Essam|Emad|Magdy|Nader|Ramy|Fady|Mina|Hamed|Abdallah|Saeed|Sayed|Reda|Gamal|Samir|Mr|CEO)\b|\b(?:reps?|merchants?|customers?|employees?|supervisors?|installers?|technicians?|drivers?|managers?|guests?|users?|father|brother|son|uncle|man|boy)\b|[\u0600-\u06FF]/i;
const THIRD = /\b(?:he|him|his|himself)\b/i;

function readerSentence(sentence: string): string {
  return sentence
    .replace(/\b(Does|Is|Was|Has) he\b/g, (_, word: string) => `${capitalFirst(youVerb(word.toLowerCase()))} you`)
    .replace(/\b([Hh])e ((?:still|also|now|already|just|really|only|usually|then|first|later|never) )?([a-z]+)\b/g, (_, h: string, adverb: string | undefined, word: string) => `${h === "H" ? "You" : "you"} ${adverb ?? ""}${youVerb(word)}`)
    .replace(/\bhimself\b/g, "yourself").replace(/\bhim\b/g, "you").replace(/\b([Hh])is\b/g, (_, h: string) => h === "H" ? "Your" : "your");
}

export function readerWords(text: string): string {
  const named = /(?<![\w-])Salem\b/.test(text);
  const out = youWords(text);
  if (!THIRD.test(out) || !named && !/\byou(?:r)?\b/i.test(out)) return out;
  const unquoted = (sentence: string) => sentence.replace(/(["\u201c'\u2018])[^"\u201c\u201d'\u2018\u2019]*(?:["\u201d'\u2019]|$)/g, " ");
  return out.split(/(?<=[.!?;])\s+/).map(sentence => THIRD.test(unquoted(sentence)) && !OTHER_MAN.test(unquoted(sentence)) ? readerSentence(sentence) : sentence).join(" ");
}

const THIRD_VERB: Record<string, string> = { are: "is", have: "has", were: "was", do: "does", "don't": "doesn't", "aren't": "isn't", "haven't": "hasn't", "weren't": "wasn't" };
const MODAL = /^(?:can|could|should|will|would|must|may|might|cannot|can't|won't|shouldn't|wouldn't|couldn't|already|also|still|now|just|only|then|never)$/;

function thirdVerb(word: string): string {
  const lower = word.toLowerCase();
  if (THIRD_VERB[lower]) return THIRD_VERB[lower]!;
  if (MODAL.test(lower) || !/^[a-z]+$/.test(word)) return word;
  return /(?:s|sh|ch|x|o)$/.test(lower) ? `${word}es` : /[^aeiou]y$/.test(lower) ? `${word.slice(0, -1)}ies` : `${word}s`;
}

export function botToBotWords(text: string, receiver?: string): string {
  const named = receiver ? text
    .replace(/\b(to|for|with|from|ask|asks|asked|tell|tells|told|remind|thank|let) you\b/gi, (_, lead: string) => `${lead} ${receiver}`)
    .replace(/\b[Yy]ours\b/g, `${receiver}'s`)
    .replace(/\b[Yy]our\b/g, `${receiver}'s`)
    .replace(/\b[Yy]ourself\b/g, receiver)
    .replace(/(^|[.!?;:,]\s+|\b(?:and|but|so|then|that|if|when|because|unless|until|before|after|while) )[Yy]ou ((?:now |also |already |still |just )?)([a-z']+)\b/g, (_, lead: string, adverb: string, word: string) => `${lead}${receiver} ${adverb}${thirdVerb(word)}`)
    : text;
  return readerWords(named);
}

const STOP_WORDS = new Set(["the", "a", "an", "of", "and", "or", "for", "to", "in", "on", "with", "by", "at", "from", "its", "it", "is", "are", "be", "round", "fresh", "core", "lab", "bot", "worker", "workers", "task", "finished", "done", "fix", "fixes", "check", "review", "re", "build", "new", "plan", "first", "then"]);

function jobWords(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter(word => word.length > 1 && !STOP_WORDS.has(word)).map(word => word.replace(/(?:ies)$/, "y").replace(/(?<=[^s])s$/, "")));
}

export function sameJob(job: string, about: readonly string[]): boolean {
  const mine = jobWords(job.replace(/\s+(?:finished|completed|is done)\W*$/i, ""));
  if (!mine.size) return true;
  const theirs = jobWords(about.join(" "));
  const shared = [...mine].filter(word => theirs.has(word)).length;
  return shared >= 2 || shared * 2 >= mine.size;
}

const askTime = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const askDay = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });

const RELAYED_WORDS = /^\s*Salem,?\s+(?:(?:(?:thr_[a-z0-9]+|msg|seq)\s*#?\d*\s*)+(?:\([^)]*\))?,?\s*(?:word for word)?|(?:\d{1,2} [A-Z][a-z]{2}(?: \d{4})?,?\s*)?word for word)\s*:\s*["\u201c]?/i;
const RELAYED_ASIDE = /^\s*Salem\s*\([^()]{0,60}\)\s*:\s*["\u201c]/;
const RELAYED_ASKED = /^\s*Salem asked(?: (?:on|from|in|via) (?:his|your|the) [\w-]+)?\s*\([^()]{0,80}\)\s*:\s*/;
const INTERNAL_REF = /\s*(?:\bthr_[a-z0-9]+\s+)?\b(?:seq|msg)\s*#?\d+(?:\/\d+)*\b(?:\s*\(\d{1,2} [A-Z][a-z]{2} \d{4}\))?/g;
const ASKER = /^\s*(?:\[bb message from thread:([^\]\s]*)\]?\s*)?(?:\S*\s*([\w ]{1,30}?) asks:\s*)?/u;
const WAKE_ONLY = /^\s*(?:\p{Extended_Pictographic}\uFE0F?\s*)?wake(?:-up)? due\.?\s*$/iu;

export interface AskParts { head: string; quote: string; full: string; excerpt: boolean; kind: "ask" | "note" | "update" | "yours" | "handover" | "brief"; part?: string }
export type OriginalOf = (threadId: string | undefined, seq: number | undefined, words: string) => string | undefined;

const SOURCE_REF = /\b(thr_[a-z0-9]+)\s+(?:seq|msg)\s*#?(\d+)/;
const HANDOVER = /\b(?:please take ownership|take ownership|do not (?:produce|implement|commit|deploy|change|message|print|reply)|never print|you now own|in your coordinator|this is a (?:discussion )?handoff|handoff from|hand(?:ed)? (?:this|it) (?:off|over)|not implementation authori[sz]ation)\b/i;
const HAS_FILE = /\b[A-Za-z][\w-]*\.(?:md|json|ya?ml|toml|tsx?|py|sh|txt)\b/;
const ORDER = /^(?:please|do not|don't|never|start|continue|take|read|check|inspect|give|ask|reply|make|use|keep|open|judge|first|tonight|then|also|this is a)\b|\bin your coordinator\b|\bdo not\b|\byou (?:must|should|need to)\b/i;
const QUOTE_ONLY = /^[^"\u201c]{0,40}:\s*["\u201c]/;
const AGENT_BRIEF = /\b(?:do the work(?: yourself)?|never delegate|(?:message|messaging) the parent thread|parent thread|final reply is|your final reply|your report\b|first read \S*(?:AGENTS|CLAUDE)\.md|you are the (?:[\w-]+ ){0,3}(?:builder|worker|scorer|reviewer)\b|do not score your own)/i;
const YOU_HANDED = /\bSalem (?:\w+ly )?(?:requests?|requested|asked for|wants|wanted|approved) (?:this|the) hand(?:off|over)\b/i;
const HANDED_FROM = /\bhand(?:off|over|ed (?:this|it) (?:off|over)) from (?:the |a |his |your )?((?:[\w-]+ ){0,2}?)(thread|chat desk|chat|desk)\b/i;
const HANDOVER_CAP = 220;
const PASTED_NOTICE = /^(?:[A-Z][\w.-]*\s+){1,3}(?:Merged|Closed|Opened|Released|Published|Deployed|Approved|Reverted|Pushed)\b|\b(?:Merged|Closed|Opened|Reverted) (?:PR |pull request )?#\d+/;

export function paragraphs(text: string): string {
  return text.replace(/([^\s.!?:;,\u2026])[ \t]*(?:\r?\n[ \t]*)+(?=[^\s\-*\u2022#>])/g, "$1. ");
}

function cleanAsk(text: string, mine: boolean, receiver?: string): { text: string; cut: boolean } {
  const source = paragraphs(text).replace(RELAYED_WORDS, "").replace(RELAYED_ASIDE, "").replace(RELAYED_ASKED, "");
  const shown = (mine ? userWordsShown : botWordsShown)(mine ? source : botFiles(source));
  const flat = plainText(plainMarkdown(shown.text).replace(INTERNAL_REF, "").replace(/\b(?:thr|env|proj|host)_[a-z0-9]+\u2026?/gi, "").replace(/\(\s*[,;]\s*/g, "(").replace(/\s+/g, " ")).replace(/^[,;:\s]+/, "");
  return { text: mine ? flat : botToBotWords(flat, receiver), cut: shown.cut };
}

function midSentence(name: string): string {
  return /^(?:Another|Its) /.test(name) ? `${name[0]!.toLowerCase()}${name.slice(1)}` : name;
}

function firstPlain(text: string): string {
  const sentences = text.split(/(?<=[.!?]["\u201d]?)\s+(?=[A-Z"\u201c'])/).map(part => part.trim()).filter(Boolean);
  const plain = sentences.filter(part => !ORDER.test(part) && !QUOTE_ONLY.test(part));
  return plain.find(part => part.length >= 40) ?? plain[0] ?? sentences[0] ?? text;
}

function relayedQuote(text: string): string {
  const words = RELAYED_WORDS.exec(text);
  if (words && /["\u201c]\s*$/.test(words[0])) {
    const body = text.slice(words[0].length);
    const close = /["\u201d](?=[.,;:!?]?(?:\s|$))/.exec(body);
    if (close) return body.slice(0, close.index);
  }
  if (RELAYED_ASKED.test(text)) {
    const body = text.replace(RELAYED_ASKED, "");
    const quoted = /^(["\u201c'\u2018])([^"\u201c\u201d'\u2018\u2019]{2,})["\u201d'\u2019]/.exec(body);
    return quoted ? quoted[2]! : body;
  }
  if (!RELAYED_ASIDE.test(text)) return text;
  const body = text.replace(RELAYED_ASIDE, "");
  const close = body.search(/["\u201d]/);
  return close > 0 ? body.slice(0, close) : body;
}

function relayedWords(text: string): string {
  return relayedQuote(text).replace(RELAYED_WORDS, "").replace(/["\u201c\u201d]/g, "").replace(/(?:\u2026|\.\.\.)$/, "").replace(/\s*\S*$/, "").trim();
}

function handedFrom(text: string): string {
  const from = HANDED_FROM.exec(text);
  if (!from) return "";
  const name = from[1]!.trim().replace(/\b(?:thr|env|proj)_\S+/g, "").trim();
  if (!name || /^(?:this|that|another|other|a|an)$/i.test(name)) return from[2] === "thread" ? "" : `A ${from[2]}`;
  return `The ${name} ${from[2] === "thread" ? "chat" : from[2]}`;
}

const DECISION_FORM = /^Re:\s*([^·]+?)\s*·\s*Decisions\.?\s*·\s*/;
const FORM_CAP = 280;

export function formAnswers(text: string): { subject: string; answers: string; note?: string } | null {
  const flat = plainMarkdown(text.trim());
  const form = DECISION_FORM.exec(flat);
  if (!form) return null;
  const answers = flat.slice(form[0].length).split(/\s+·\s+/).map(part => /→\s*(.+)$/.exec(part)?.[1]?.trim()).filter((part): part is string => !!part);
  if (!answers.length) return null;
  const last = /^(.+?[.!?])\s+(\S.{19,})$/.exec(answers[answers.length - 1]!);
  if (last) answers[answers.length - 1] = last[1]!;
  return { subject: form[1]!.trim(), answers: answers.join("; "), ...(last ? { note: last[2]!.trim() } : {}) };
}

export function askParts(ask: { excerpt: string; full?: string; label: string; at?: number; ref?: { threadId: string } }, now: number, askerOf?: (threadId: string) => string | undefined, own?: string, originalOf?: OriginalOf): AskParts {
  const form = !/^Bot request/.test(ask.label) ? formAnswers((ask.full ?? ask.excerpt).replace(ASKER, "")) : null;
  if (form?.note) {
    const parts = askParts({ ...ask, label: "You asked", excerpt: form.note, full: form.note }, now, askerOf, own);
    return { ...parts, head: parts.head.replace(/^You asked\b/, "You answered"), excerpt: true, kind: "yours", part: "your words" };
  }
  if (form) {
    const long = form.answers.length > FORM_CAP;
    const answers = long ? clauseCut(form.answers, FORM_CAP) || cutAtWord(form.answers, FORM_CAP) : form.answers;
    const parts = askParts({ ...ask, label: "You asked", excerpt: answers, full: answers }, now, askerOf, own);
    return { ...parts, head: parts.head.replace(/^You asked\b/, "You answered"), excerpt: long || parts.excerpt, kind: "yours", ...(long ? { part: "excerpt" } : {}) };
  }
  const label = /^(You asked|Relayed via ChatGPT|Bot request)/.exec(ask.label)?.[1] ?? "You asked";
  const found = ASKER.exec(ask.excerpt);
  const named = found?.[2]?.trim() || (found?.[1] ? askerOf?.(found[1]) : undefined);
  const asker = named && named !== own ? named : named ? "Its own chat" : found?.[1] ? "Another chat" : undefined;
  const bare = ask.excerpt.replace(ASKER, "");
  const paraphrase = RELAYED_ASKED.test(bare) && !/^["\u201c'\u2018]/.test(bare.replace(RELAYED_ASKED, ""));
  const relayed = !paraphrase && (RELAYED_WORDS.test(bare) || RELAYED_ASIDE.test(bare) || RELAYED_ASKED.test(bare));
  const mine = relayed || label !== "Bot request";
  const rawFull = (ask.full ?? ask.excerpt).replace(ASKER, "");
  const told = askKind(bare);
  const notice = told === "ask" && label === "Bot request" && !requestsSomething(rawFull);
  const kind: AskParts["kind"] = mine ? "yours" : paraphrase ? "ask" : AGENT_BRIEF.test(rawFull) ? "brief" : told !== "update" && (HANDOVER.test(rawFull) || HAS_FILE.test(rawFull) || rawFull.length > 300) ? "handover" : told;
  const sameDay = ask.at !== undefined && new Date(ask.at).toDateString() === new Date(now).toDateString();
  const when = ask.at === undefined ? ask.label.replace(/^[^,]*,\s*/, "") : sameDay ? `today ${askTime.format(new Date(ask.at))}` : askDay.format(new Date(ask.at));
  const via = relayed && named && named !== own ? ` via ${named}` : "";
  const starter = named ?? (ask.ref ? askerOf?.(ask.ref.threadId) : undefined) ?? own;
  if (kind === "brief") return { head: `${starter ?? "A bot"} started this ${when}`, quote: "", full: "", excerpt: false, kind };
  const from = !asker || asker === "Another chat" ? handedFrom(rawFull) : "";
  const handedBy = YOU_HANDED.test(rawFull) ? `You handed this over${from ? ` from ${from[0]!.toLowerCase()}${from.slice(1)}` : ""}` : `${from || asker || "Another chat"} handed this over`;
  const shared = label === "You asked" && !relayed && !requestsSomething(rawFull) && PASTED_NOTICE.test(rawFull.trim());
  const who = shared ? "You shared" : relayed ? "You asked" : paraphrase ? `${asker && asker !== "Another chat" ? asker : "A bot"} passed on your ask` : kind === "handover" ? handedBy : kind === "note" || notice ? `${asker ? `Note from ${midSentence(asker)}` : "Note from a bot"}` : kind === "update" ? (asker ? `Update from ${midSentence(asker)}` : "Worker update") : label === "Bot request" ? `${asker || "Another bot"} asked` : label;
  const ref = relayed ? SOURCE_REF.exec(bare) : null;
  const original = relayed && originalOf ? originalOf(ref?.[1], ref ? Number(ref[2]) : undefined, relayedWords(bare)) : undefined;
  const source = original ?? (relayed ? relayedQuote(bare) : paraphrase ? bare.replace(RELAYED_ASKED, "") : bare);
  const quoteShown = WAKE_ONLY.test(bare) ? { text: "", cut: false } : cleanAsk(source, mine, own);
  const fullSource = original ?? (ask.full ? (relayed ? relayedQuote(ask.full.replace(ASKER, "")) : ask.full.replace(ASKER, "").replace(paraphrase ? RELAYED_ASKED : /$^/, "")) : "");
  const fullShown = fullSource && !WAKE_ONLY.test(bare) ? cleanAsk(fullSource, mine, own) : quoteShown;
  const head = WAKE_ONLY.test(bare) ? `Scheduled check ${when}` : `${who} ${when}${via}`;
  if (kind === "update") {
    const done = (text: string) => text.replace(/\s+(?:finished|completed)(?=["\u201d]?$)/i, "");
    quoteShown.text = done(quoteShown.text);
    fullShown.text = done(fullShown.text);
  }
  if (kind === "handover") {
    const said = YOU_HANDED.test(rawFull) ? /["\u201c]([^"\u201c\u201d]{12,})["\u201d]/.exec(fullShown.text)?.[1] : undefined;
    const first = said ? said.trim() : firstPlain(fullShown.text.replace(/(?:\u2026|\.\.\.)["\u201d\u2019]?$/, ""));
    const line = first.length > HANDOVER_CAP ? cutAtWord(first, HANDOVER_CAP) : first;
    const clipped = /(?:\u2026|\.\.\.)["\u201d\u2019]?$/.test(fullShown.text);
    const complete = !said && !fullShown.cut && !clipped && line.trim() === fullShown.text.trim();
    return { head, quote: line, full: line, excerpt: !complete, kind, part: said ? "your words" : "first sentence" };
  }
  const trailing = /(?:\u2026|\.\.\.)["\u201d\u2019]?$/.test(fullShown.text);
  const cut = trailing || fullShown.cut;
  const whole = trailing ? wholeSentences(fullShown.text.replace(/["\u201d\u2019]$/, "")) : fullShown.text;
  const relay = kind !== "yours";
  const kept = relay ? dropOrders(whole) : whole;
  const long = relay && kept.length > RELAY_CAP;
  const full = long ? sentencesUpTo(kept, RELAY_CAP) : kept;
  const quote = quoteShown.cut ? full : relay ? dropOrders(quoteShown.text) : quoteShown.text;
  return { head, quote, full, excerpt: cut || long, kind };
}

const RELAY_CAP = 300;
const BOT_ORDER = /^["\u201c]?(?:reply (?:with|to)|report back|continue (?:that|this|the|with)|no reply(?: to me)? is needed|please (?:reply|confirm|recheck|report|continue|keep|let me)|let me know|send me|tell me|ping me)\b/i;
const ORDER_CLAUSE = /[;,]\s*(?:and\s+)?no reply(?: to me)? is needed\b/gi;

export function dropOrders(text: string): string {
  const parts = text.replace(ORDER_CLAUSE, "").split(/(?<=[.!?]["\u201d]?)\s+(?=["\u201c]?[A-Z])/);
  return parts.filter((part, i) => i === 0 || !BOT_ORDER.test(part.trim())).join(" ").trim();
}

export function sentencesUpTo(text: string, max: number): string {
  if (text.length <= max) return text;
  let end = -1;
  for (const match of text.slice(0, max + 1).matchAll(SENTENCE_END)) end = match.index! + 1;
  return end >= 40 ? text.slice(0, end) : clauseCut(text, max) || cutAtWord(text, max);
}

const SENTENCE_END = /(?<!\b(?:e\.g|i\.e|etc|vs|approx))[.!?](?=["\u201d\u2019)]?\s)/g;

export function wholeSentences(text: string): string {
  const body = text.replace(/(?:\u2026|\.\.\.)$/, "").trimEnd();
  let end = -1;
  for (const match of body.matchAll(SENTENCE_END)) end = match.index! + 1;
  if (end >= Math.min(40, body.length * 0.3)) return body.slice(0, end);
  return clauseCut(body, body.length - 1) || cutAtWord(`${body}\u2026`, body.length);
}

const PREVIEW_STRETCH = 40;

export function readableCut(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  const clipped = /(?:\u2026|\.\.\.)$/.test(flat);
  if (flat.length <= max && !clipped) return flat;
  const bare = flat.replace(/(?:\u2026|\.\.\.)$/, "").trimEnd();
  if (!clipped && bare.length <= max + PREVIEW_STRETCH) return bare;
  const first = /^(.+?(?<!\b(?:e\.g|i\.e|etc|vs|approx))[.!?])(?=["\u201d\u2019)]?\s|$)/.exec(flat)?.[1];
  if (first && first.length <= max && first.length >= 12) return first;
  for (const match of bare.matchAll(CLAUSE_END)) {
    const at = match.index!;
    if (at < max) continue;
    if (at > max + PREVIEW_STRETCH) break;
    return /[,;]/.test(bare[at]!) ? `${bare.slice(0, at)}\u2026` : bare.slice(0, at + 1);
  }
  return clauseCut(bare, max) || cutAtWord(flat, max);
}

export const ASK_PREVIEW = 84;
const PREVIEW_LINES = 150;
const PREVIEW_MIN = 24;
const CLAUSE_STOP = /[,;:](?=\s)|\s[\u2013\u2014-](?=\s)|\s(?=\()/g;
const PHRASE_BREAK = /\s(?=(?:through|before|after|under|without|while|when|because|until|unless|so|which|and|but|or|with|for|to|on|in|at|by|from|that|whether|if|via|into|about|since|as)\s)/g;

function balanced(text: string): boolean {
  return (text.match(/\(/g)?.length ?? 0) === (text.match(/\)/g)?.length ?? 0) && (text.match(/["\u201c\u201d]/g)?.length ?? 0) % 2 === 0;
}

export function previewUnit(text: string, max: number): { text: string; partial: boolean } {
  const flat = text.replace(/\s+/g, " ").trim();
  const clipped = /(?:\u2026|\.\.\.)$/.test(flat);
  const bare = flat.replace(/(?:\u2026|\.\.\.)$/, "").trimEnd();
  if (!clipped && bare.length <= max) return { text: bare, partial: false };
  let end = -1;
  for (const match of bare.matchAll(SENTENCE_END)) { const at = match.index! + 1; if (at > max) break; if (balanced(bare.slice(0, at))) end = at; }
  if (end >= PREVIEW_MIN && end < bare.length) return { text: bare.slice(0, end), partial: true };
  if (end >= PREVIEW_MIN) return { text: bare.slice(0, end), partial: clipped };
  for (const stop of [CLAUSE_STOP, PHRASE_BREAK]) {
    let at = -1;
    for (const match of bare.slice(0, max + 1).matchAll(stop)) {
      const head = dropFunctionTail(bare.slice(0, match.index!).replace(/[\s,;:\u2013\u2014-]+$/, ""));
      if (head.length >= PREVIEW_MIN && balanced(head)) at = head.length;
    }
    if (at >= PREVIEW_MIN) return { text: dropFunctionTail(bare.slice(0, at)), partial: true };
  }
  return { text: cutAtWord(bare, max), partial: true };
}

export function askPreview(ask: { excerpt: string; full?: string; label: string; at?: number }, now: number, askerOf?: (threadId: string) => string | undefined, own?: string, originalOf?: OriginalOf): { line: string; shown: string; partial: boolean } {
  const parts = askParts(ask, now, askerOf, own, originalOf);
  if (!parts.quote) return { line: parts.head, shown: "", partial: false };
  const room = Math.max(48, PREVIEW_LINES - parts.head.length);
  const source = parts.full && parts.full.length > parts.quote.length && parts.full.startsWith(parts.quote.replace(/(?:\u2026|\.\.\.)$/, "").slice(0, 24)) ? parts.full : parts.quote;
  const unit = previewUnit(source, room);
  const partial = unit.partial || parts.excerpt;
  return { line: `${parts.head}${partial ? " \u00b7 excerpt" : ""}: \u201c${unit.text}\u201d`, shown: unit.text, partial };
}

export function askLine(ask: { excerpt: string; full?: string; label: string; at?: number }, now: number, askerOf?: (threadId: string) => string | undefined, _max = ASK_PREVIEW, own?: string, originalOf?: OriginalOf): string {
  return askPreview(ask, now, askerOf, own, originalOf).line;
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

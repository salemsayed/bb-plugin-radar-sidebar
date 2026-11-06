import { isClosed, type BotTaskRow, type BotTasksData } from "@/lib/botTasks";
import { normalizedNeedsText, type NeedsItem } from "@/lib/needs";
import { askFirst, needAsk, stageText, stageTitle } from "./stage";
import { capitalFirst, cutAtWord, plainText } from "./workText";

export const QUESTION_TAG = "radar:question";
export const IN_PANEL_TAG = "radar:question-in-panel";

export function isQuestionRow(task: Pick<BotTaskRow, "tags">): boolean {
  return task.tags.includes(QUESTION_TAG);
}

export function questionInPanel(task: Pick<BotTaskRow, "tags">): boolean {
  return task.tags.includes(IN_PANEL_TAG);
}

const STATUS_TAG = /^(?:overdue|reminder|decision(?: needed)?|question|heads-up|fyi)\s*[:·-]\s*/i;
const GO_WAIT = /^(.*?)[;,.]\s*(?:still\s+)?(?:waiting|waits) (?:for|on) your (?:go|go-ahead|ok|okay|approval|decision|answer|call|sign-off)\b(.*)$/i;
const CHOICE = /\byour (?:choice|pick) of ((?:an? |the )?[^(,;.]+?)\s*(?:\(|[,;.]|$)/i;
const FINISH: [RegExp, string][] = [
  [/,?\s*\b(?:unpublished|not (?:yet )?published)\b/i, "Publish"],
  [/,?\s*\b(?:undeployed|not (?:yet )?deployed)\b/i, "Deploy"],
  [/,?\s*\b(?:unmerged|not (?:yet )?merged)\b/i, "Merge"],
  [/,?\s*\b(?:unsent|not (?:yet )?sent)\b/i, "Send"],
  [/,?\s*\bnot (?:yet )?(?:shipped|released)\b/i, "Ship"],
];
const SUBJECT = /^([A-Za-z][\w-]*(?: [A-Za-z][\w-]*)?)\s+(?:is |was |has been )?(?:built|ready|done|checked|tested|finished|prepared|drafted|written)\b/;

function waitedGo(text: string, title: string): string {
  const wait = GO_WAIT.exec(text);
  if (!wait) return "";
  let status = wait[1]!.trim();
  let verb = "";
  for (const [pattern, word] of FINISH) if (pattern.test(status)) { verb = word; status = status.replace(pattern, "").trim(); break; }
  const subject = SUBJECT.exec(status)?.[1] ?? "";
  const named = title && subject && title.toLowerCase().includes(subject.toLowerCase()) ? title : subject.toLowerCase() || title;
  const thing = named ? `the ${named.replace(/^the /i, "")}` : "it";
  const choice = CHOICE.exec(wait[2] ?? "")?.[1]?.trim();
  const lead = `${verb || "Go ahead with"} ${thing}${choice ? ` and pick ${choice}` : ""}?`;
  const context = subject ? status.slice(subject.length).trim().replace(/^(?:is|was|has been)\s+/, "") : status;
  return context ? `${lead} · ${capitalFirst(context.replace(/[,;.\s]+$/, ""))}` : lead;
}

const PLAN = /^(.+?)\s*[:\u00b7\u2013\u2014-]\s*(?:the |a )?plan$/i;
const NAMED_ITEM = /^merge request (?:[a-z][\w-]*!|!)?\d+\b/i;

function lowerLead(text: string): string {
  return /^[A-Z][a-z]/.test(text) && !/^[A-Z][a-z]+(?:\s+[A-Z]|$)/.test(text) ? text[0]!.toLowerCase() + text.slice(1) : text;
}

const FIRST_PERSON = /\b(?:I|I'll|I'm|I've|I'd|my|mine|myself|me)\b/;
const TO_YOU: Record<string, string> = { "I'll": "you'll", "I'm": "you're", "I've": "you've", "I'd": "you'd", I: "you", my: "your", mine: "yours", myself: "yourself", me: "you" };

export function askedVoice(option: string, later: boolean): string {
  const plain = stageText(option, true).replace(/\s*\((?:recommended|suggested|default|preferred)\)/gi, "").replace(/[.?!]+$/, "").replace(/^(?:yes|no),\s+(?=\S)/i, "").trim();
  if (!FIRST_PERSON.test(plain)) return plain;
  const turned = plain.replace(/\b(?:I'll|I'm|I've|I'd|I|my|mine|myself|me)\b/g, word => TO_YOU[word] ?? word);
  return later ? turned.replace(/^you(?:'ll| will)\s+/i, "") : turned;
}

function choice(options: readonly string[]): string {
  const said = options.map((option, i) => {
    const plain = askedVoice(option, i > 0);
    return i === 0 ? capitalFirst(plain) : lowerLead(plain);
  });
  const last = said.pop()!;
  return `${said.length ? `${said.join(", ")}, or ${last}` : last}?`;
}

export function questionTopic(question: string): string {
  const head = question.split(" \u00b7 ")[0]!.replace(/[?.!]+\s*$/, "").trim();
  const lead = head.replace(/^(?:can|could|would|will|should|shall|do|did) (?:you|i|we) (?:please )?/i, "").replace(/^(?:do you want me to|want me to|ok to|okay to) /i, "");
  const first = lead.split(/,\s*(?:or|and)\s+|\s+(?:or|and)\s+|\s*\(/)[0]!.trim();
  const topic = first.length >= 8 ? first : lead;
  return capitalFirst(topic.length > 48 ? cutAtWord(topic, 48) : topic);
}

const EITHER_OR = /,?\s+or\s+[^?]*\?\s*$/i;
const NUMBERED = /\b(?:the\s+)?(?:(?:merge request|pull request|MR|PR|job|ticket|issue|invoice|order|redemption|feedback)\s+(?:#|[a-z][\w-]*!|!)?\d+|\d{3,}\s+(?:job|ticket|order|invoice|merge request)|#\d+)/i;

const TOPIC_TITLE = 48;

export function needsTopic(question: string, fallback = ""): string {
  const whole = question.split(" \u00b7 ")[0]!.trim();
  const asked = whole.split(/(?<=[.!?])\s+(?=[A-Z])/).find(sentence => /\?\s*$/.test(sentence));
  const head = asked ?? whole;
  if (!EITHER_OR.test(head)) {
    const topic = questionTopic(head);
    const echoes = topic.length >= 8 && head.toLowerCase().startsWith(topic.toLowerCase().replace(/[?.]$/, ""));
    return echoes && fallback && fallback.length <= TOPIC_TITLE && fallback.toLowerCase() !== topic.toLowerCase() ? fallback : topic;
  }
  const named = NUMBERED.exec(head)?.[0];
  if (named) return capitalFirst(plainText(named.replace(/^the\s+/i, "the ").trim()));
  return fallback || questionTopic(head);
}

export function recordQuestion(text: string, title = "", options: readonly string[] = []): string {
  const body = stageText(text.replace(STATUS_TAG, "").trim(), true).replace(/\s*\([^()]*\b\d{6,}\b[^()]*\)/g, "").trim();
  if (options.length >= 2 && !/\?/.test(body)) return choice(options);
  if (/\?/.test(body)) return askFirst(body, title);
  const plan = PLAN.exec(body);
  if (plan) return `Approve the plan for ${lowerLead(plan[1]!.trim())}?`;
  if (NAMED_ITEM.test(body)) return `Reply needed on ${lowerLead(body)}`;
  return waitedGo(body, title) || needAsk(body, title);
}

export interface DroppedQuestion { id: string; bot: string; why: string; text: string }

function sameAsk(a: string, b: string): boolean {
  const x = normalizedNeedsText(a).slice(0, 60), y = normalizedNeedsText(b).slice(0, 60);
  return x.length >= 12 && y.length >= 12 && (x.includes(y) || y.includes(x));
}

export function withQuestions(data: BotTasksData, records: readonly NeedsItem[] | null, laterAt: (key: string, since?: number) => number | null): { data: BotTasksData; dropped: DroppedQuestion[] } {
  const dropped: DroppedQuestion[] = [];
  if (!records?.length) return { data, dropped };
  const all = data.bots.flatMap(bot => bot.tasks);
  let changed = false;
  const bots = data.bots.map(bot => {
    const mine = records.filter(item => item.bot === bot.key && item.kind === "decision" && (item.state === "open" || item.state === "reminded"));
    if (!mine.length) return bot;
    const rows: BotTaskRow[] = [];
    for (const item of mine) {
      if (item.cleared) { dropped.push({ id: item.id, bot: bot.key, why: item.cleared.why, text: item.text }); continue; }
      if (item.answered && item.followedUp) { dropped.push({ id: item.id, bot: bot.key, why: "you answered and the bot followed up", text: item.text }); continue; }
      const linkedId = /^task-overdue:([^:]+)/.exec(item.key ?? "")?.[1];
      const linked = linkedId ? all.find(task => task.id === linkedId) : undefined;
      if (linked && (isClosed(linked.displayState) || linked.displayState !== "needs" && linked.waitFor !== "you")) { dropped.push({ id: item.id, bot: bot.key, why: "its task moved on", text: item.text }); continue; }
      if (linked?.displayState === "needs" || bot.tasks.some(task => task.displayState === "needs" && sameAsk(task.needs?.question ?? task.line, item.text))) { dropped.push({ id: item.id, bot: bot.key, why: "already asked by its task", text: item.text }); continue; }
      const askedAt = Date.parse(item.createdAt);
      const threadId = item.source.threadId ?? bot.coordinatorThreadId;
      const topicTask = item.taskId ? all.find(task => task.id === item.taskId) : linked;
      const question = recordQuestion(item.text, linked ? stageTitle(linked.title, linked.outcome) : "", item.options ?? []);
      const parkedAt = laterAt(`task:${item.id}`, askedAt);
      const seq = item.askSeq ?? undefined;
      const answered = item.answered ?? null;
      const later = answered ? { reason: "answered" as const, at: answered.at, threadId, messageSeq: answered.seq } : parkedAt !== null ? { reason: "not-now" as const, at: parkedAt } : null;
      rows.push({
        id: item.id, bot: bot.key, title: topicTask ? stageTitle(topicTask.title, topicTask.outcome) : question, displayState: later ? "waiting" : "needs", line: question, waitFor: "you",
        ageMs: Math.max(0, data.observedAt - askedAt), conversationThreadId: null,
        needs: { threadId, interactionId: "", question, askedAt, ...(seq !== undefined ? { messageSeq: seq } : {}), ...(item.options?.length ? { options: item.options } : {}) },
        ...(later ? { later } : {}),
        tags: seq === undefined ? [QUESTION_TAG, IN_PANEL_TAG] : [QUESTION_TAG], origin: "verified", observedAt: data.observedAt,
      });
    }
    if (!rows.length) return bot;
    changed = true;
    return { ...bot, tasks: [...rows, ...bot.tasks] };
  });
  return { data: changed ? { ...data, bots } : data, dropped };
}

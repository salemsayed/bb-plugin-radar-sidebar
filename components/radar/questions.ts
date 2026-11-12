import type { BotTaskRow } from "@/lib/botTasks";
import { IN_PANEL_TAG, QUESTION_TAG } from "@/lib/questionRecords";
import { capitalFirst, cutAtWord, plainText } from "./workText";

export { IN_PANEL_TAG, QUESTION_TAG };

export function isQuestionRow(task: Pick<BotTaskRow, "tags">): boolean {
  return task.tags.includes(QUESTION_TAG);
}

export function questionInPanel(task: Pick<BotTaskRow, "tags">): boolean {
  return task.tags.includes(IN_PANEL_TAG);
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

const STEP_VERB = /^(?:type|enter|paste|log ?in(?:to)?|sign ?in(?:to)?|approve|confirm|tap|plug|scan|press|unlock|open|run|restart|install|reply|send|upload|pick|choose)\b/i;
const PURPOSE = /^(.{16,}?),?\s+(so (?:that )?|to make sure |in order to )(.{8,}?)[.\s]*$/i;

export function stepParts(text: string): { step: string; purpose: string } | null {
  const said = text.trim();
  if (/\?/.test(said) || !STEP_VERB.test(said)) return null;
  const split = PURPOSE.exec(said);
  if (!split) return { step: said.replace(/[.\s]+$/, ""), purpose: "" };
  return { step: split[1]!.replace(/[,;\s]+$/, ""), purpose: `${split[2]}${split[3]}`.trim() };
}

export function isStepAsk(task: Pick<BotTaskRow, "displayState" | "needs" | "line" | "title" | "outcome" | "tags">): boolean {
  return task.displayState === "needs" && !!stepParts(task.needs?.question || task.line);
}


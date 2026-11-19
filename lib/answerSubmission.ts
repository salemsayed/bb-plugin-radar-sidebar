import type { AskStripEntry } from "./askStrip";

export const answerSubmissionKind = "radar-question-answer";

export function answerSubmission(ask: AskStripEntry | null, threadId: string) {
  if (!ask || ask.threadId !== threadId) return undefined;
  const question = ask.questionId || (ask.messageSeq === undefined ? null : JSON.stringify([threadId, ask.messageSeq, ask.key]));
  if (!question) return undefined;
  return { experimental_data: { kind: answerSubmissionKind, question } };
}

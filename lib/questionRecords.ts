import { z } from "zod";
import type { QuestionView } from "./tasks-v2-types";

export const QUESTION_TAG = "radar:question";
export const IN_PANEL_TAG = "radar:question-in-panel";

export const questionSchema = z.object({
  id: z.string(), bot: z.string().nullable(), source: z.string(), state: z.enum(["open", "later"]), threadId: z.string(), askedAt: z.number(), question: z.string(),
  taskId: z.string().optional(), deskId: z.string().optional(), needId: z.string().optional(), interactionId: z.string().optional(), messageSeq: z.number().optional(),
  laterAt: z.number().optional(), options: z.array(z.string()).optional(), recommend: z.string().optional(),
});
export type Question = z.infer<typeof questionSchema>;

const contractCheck: Question extends Omit<QuestionView, "source"> ? true : false = true;
void contractCheck;

export const isTaskQuestion = (q: Pick<Question, "taskId">) => q.taskId !== undefined;
export const isDeskQuestion = (q: Pick<Question, "deskId">) => q.deskId !== undefined;
export const isOutsideQuestion = (q: Pick<Question, "bot">) => q.bot === null;
export const isOwnQuestion = (q: Question) => !isTaskQuestion(q) && !isDeskQuestion(q) && !isOutsideQuestion(q);

export function deskDraft(q: Pick<Question, "question" | "options" | "messageSeq">): { draft: string; options: string[]; messageSeq?: number } | null {
  const options = q.options ?? [];
  const cut = q.question.indexOf("\n");
  const draft = cut < 0 ? "" : q.question.slice(cut + 1).trim();
  return draft && options.length ? { draft, options, ...(q.messageSeq !== undefined ? { messageSeq: q.messageSeq } : {}) } : null;
}

export function rowId(q: Pick<Question, "id" | "needId">): string {
  return q.needId ?? q.id;
}

export function questionRow(q: Question, observedAt: number) {
  const options = q.options ?? [];
  return {
    id: rowId(q), bot: q.bot ?? "", title: q.question, displayState: q.state === "later" ? "waiting" as const : "needs" as const, line: q.question, waitFor: "you",
    ageMs: Math.max(0, observedAt - q.askedAt), conversationThreadId: null,
    needs: { questionId: q.id, threadId: q.threadId, interactionId: q.interactionId ?? "", question: q.question, askedAt: q.askedAt,
      ...(q.messageSeq !== undefined ? { messageSeq: q.messageSeq } : {}), ...(options.length ? { options } : {}),
      ...(q.recommend && options.includes(q.recommend) ? { recommended: q.recommend } : {}) },
    ...(q.state === "later" ? { later: { reason: "not-now" as const, at: q.laterAt ?? q.askedAt, questionId: q.id } } : {}),
    tags: q.messageSeq === undefined ? [QUESTION_TAG, IN_PANEL_TAG] : [QUESTION_TAG], origin: "verified" as const, observedAt,
  };
}

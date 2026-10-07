/**
 * Is a bot waiting on Salem? Coordinators are told to end with
 * "Decision needed: …", but plenty of real asks are plain questions ("Should I
 * book it?") or "Your go: …". Jev, through the Auto Effort plugin, judges each
 * coordinator's latest reply once and picks the sentence that is the ask, so
 * the crew view quotes the bot rather than paraphrasing it.
 *
 * Measured on 271 real coordinator replies across five bots: "Decision
 * needed:" alone caught 78% of the 106 real asks; that rule or Jev at 0.5
 * caught all of them, with 2 false alarms.
 */

import { z } from "zod";

/** Below this probability a reply without "Decision needed:" is not an ask. */
export const WAITING_THRESHOLD = 0.5;

const MAX_SENTENCES = 12;

/** Leading protocol tokens like BOT_READY_x1, HOME_BOT_READY, SESSION_OK or HANDOFF_x. */
const PROTOCOL_TOKEN = /^[A-Z][A-Z0-9]*(?:_[A-Za-z0-9]+)+\b[\s:|—-]*/;

/** The reply's last sentences, as plain text: asks almost always come at the end. */
export function askSentences(reply: string): string[] {
  const sentences: string[] = [];
  for (const raw of reply.split(/\r?\n/)) {
    const line = raw
      .replace(/^[\s#>*\-•|]+/, "")
      .replace(/\*\*|__|`/g, "")
      .replace(PROTOCOL_TOKEN, "")
      .trim();
    if (!line) continue;
    for (const piece of line.split(/(?<=[.?!])\s+(?=[A-Z0-9"“(@])/)) {
      const sentence = piece.trim();
      if (sentence.length > 2) sentences.push(sentence.slice(0, 220));
    }
  }
  return sentences.slice(-MAX_SENTENCES);
}

/** The Jev questions for one reply; model and key are Auto Effort's. */
export function askQuestions(sentences: readonly string[]) {
  const criteria: Record<string, string> = { none: "No sentence asks Salem for anything." };
  sentences.forEach((sentence, index) => { criteria[`s${index + 1}`] = sentence; });
  return {
    state: { reply: sentences.join(" ").slice(0, 3000) },
    questions: {
      waiting: {
        type: "noul" as const,
        instructions:
          "This is a bot's latest message to its owner, Salem. Is the bot blocked on Salem right now? True only if the message asks Salem, now, for a decision, an approval or go-ahead, an answer, some information, or an action only he can take (such as typing a password or rebooting). False if the message only reports progress or results; says nothing is needed; says it is ready for his next request; is waiting on a worker, reviewer or someone else; says something will need his approval later, after other work finishes; restates standing rules about what needs his approval; or only mentions something he could optionally do.",
      },
      ask: {
        type: "choice" as const,
        instructions: "Which sentence states what Salem needs to decide, answer, approve or do? Choose none if no sentence asks anything of Salem.",
        criteria,
      },
    },
  };
}

const answersSchema = z.object({
  waiting: z.object({ noul: z.number().min(0).max(1) }),
  ask: z.object({ choice: z.string() }).optional(),
});

/** Jev's answers as a probability and the chosen sentence; null when the answers are unusable. */
export function readAskAnswers(answers: unknown, sentences: readonly string[]): { waiting: number; ask: string | null } | null {
  const parsed = answersSchema.safeParse(answers);
  if (!parsed.success) return null;
  const choice = /^s(\d+)$/.exec(parsed.data.ask?.choice ?? "");
  return { waiting: parsed.data.waiting.noul, ask: choice ? (sentences[Number(choice[1]) - 1] ?? null) : null };
}

/**
 * One coordinator reply, judged. `waiting` is null when Jev was unavailable.
 * `ask` is the saved Needs You text verbatim and `itemId` the item it was saved
 * as, so the bubble, the card and the rail describe one ask. `dismissed` means
 * Salem closed that item while this reply was current.
 */
export const crewJudgementSchema = z.object({
  threadId: z.string(),
  version: z.number(),
  waiting: z.number().nullable(),
  ask: z.string().nullable(),
  itemId: z.string().nullable().optional(),
  dismissed: z.boolean().optional(),
});
export type CrewJudgement = z.infer<typeof crewJudgementSchema>;

/** Radar's own RPC, shared by the server and the sidebar. */
export const crewRpcContract = {
  crew_asks: {
    input: z.object({
      threads: z.array(z.object({ threadId: z.string().min(1).max(64), version: z.number() })).max(24),
    }).strict(),
    output: z.object({ judgements: z.array(crewJudgementSchema) }),
  },
} as const;

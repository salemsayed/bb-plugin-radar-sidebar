/**
 * Is a bot waiting on Salem? The server answers from its saved Needs You items
 * (lib/needsServer askJudgements); a coordinator's own "Decision needed:" line
 * stands in until that answer arrives.
 */

import { z } from "zod";

/** At or above this a judgement means the bot is waiting on Salem. */
export const WAITING_THRESHOLD = 0.5;

/**
 * One coordinator, judged: `waiting` is 1 while its bot has an open decision
 * or urgent item, `ask` that item's text verbatim and `itemId` its id, so the
 * bubble, the card and the rail describe one ask. `dismissed` is kept for
 * older servers.
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

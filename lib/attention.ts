import { z } from "zod";
export const attentionEventSchema = z.object({ seq: z.number(), id: z.string(), bot: z.string(), source: z.string(), threadId: z.string(), summary: z.string(), needsItemId: z.string().nullable(), createdAt: z.number(), seenAt: z.number().nullable(), resolvedAt: z.number().nullable().default(null), interactionId: z.string().optional(), interactionThreadId: z.string().optional(), kind: z.enum(["question", "reminder", "update", "completion"]).default("update") });
export type AttentionEvent = z.infer<typeof attentionEventSchema>;
export const attentionPageSchema = z.object({ events: z.array(attentionEventSchema), cursor: z.number(), more: z.boolean() });
export const attentionRpcContract = {
  crew_attention_list: { input: z.object({ after: z.number().int().nonnegative().default(0) }).strict(), output: z.object({ page: attentionPageSchema.nullable() }) },
  crew_attention_seen: { input: z.object({ ids: z.array(z.string()).min(1).max(200) }).strict(), output: z.object({ acknowledged: z.number() }) },
} as const;

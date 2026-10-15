import { z } from "zod";
import { NEEDS_PLUGIN } from "./needs";

// Copied from bb-plugin-saelmbot plate.ts: one row per thing Salem asked a bot for that is not finished.
export const PLATE_PLUGIN = NEEDS_PLUGIN;
export const plateStates = ["open", "running", "waiting", "stalled", "done", "dropped"] as const;
export type PlateState = typeof plateStates[number];
export const plateModes = ["off", "shadow", "on"] as const;
export type PlateMode = typeof plateModes[number];
const iso = z.iso.datetime();
export const plateItemSchema = z.object({
  id: z.string(), bot: z.string(), text: z.string(), via: z.enum(["salem", "chatgpt"]),
  sourceThread: z.string(), sourceSeq: z.number().int(), state: z.enum(plateStates),
  owner: z.string().nullable(), workerThread: z.string().nullable(), workerTitle: z.string().nullable(),
  lastWord: z.string().nullable(), relay: z.string().nullable(), followUps: z.number().int(),
  progressAt: iso, createdAt: iso, closedAt: iso.nullable(), evidence: z.string().nullable(), nudgedAt: iso.nullable(), askedAt: iso.nullable(),
});
export type PlateItem = z.infer<typeof plateItemSchema>;
export const plateListInputSchema = z.object({ bot: z.string().optional(), states: z.array(z.enum(plateStates)).optional() }).strict();
export const plateListOutputSchema = z.object({ items: z.array(plateItemSchema), modes: z.record(z.string(), z.enum(plateModes)) });
export const plateUpdateInputSchema = z.object({ id: z.string(), action: z.enum(["done", "drop", "reopen"]), evidence: z.string().max(500).optional() }).strict();
export const plateResultSchema = z.object({ item: plateItemSchema });
export type PlateAction = z.infer<typeof plateUpdateInputSchema>["action"];

/** Radar fronts the plate on the server; a missing or older backend reads as items: null. */
export const plateRpcContract = {
  crew_plate_list: { input: plateListInputSchema, output: z.object({ items: z.array(plateItemSchema).nullable(), modes: plateListOutputSchema.shape.modes }) },
  crew_plate_update: { input: plateUpdateInputSchema, output: plateResultSchema },
} as const;

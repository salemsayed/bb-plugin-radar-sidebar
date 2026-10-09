import { z } from "zod";
import { needsItemSchema } from "./needs";

const id = z.string().min(1).max(160);
export const pilotPlacement = z.enum(["needs_you", "reminders", "later", "history"]);
export const pilotAction = z.enum(["assign", "answer", "later", "withdraw", "summary", "clarify"]);
export const pilotEntrySchema = z.object({
  id, text: z.string(), reply: z.string(), at: z.number(),
  status: z.enum(["pending", "ready", "failed"]),
  action: pilotAction.nullable(), owner: z.string().nullable(),
  needId: z.string().nullable(), sourceVersion: z.string().nullable(),
  review: z.enum(["unreviewed", "correct", "incorrect"]),
  model: z.string().nullable(), latencyMs: z.number().nullable(),
});
export type PilotEntry = z.infer<typeof pilotEntrySchema>;
export const pilotSnapshotSchema = z.object({
  at: z.number(), revision: z.number(),
  items: z.array(needsItemSchema),
  bots: z.array(z.object({ key: z.string(), name: z.string(), current: z.string() })),
});
export type PilotSnapshot = z.infer<typeof pilotSnapshotSchema>;
export const pilotBoardSchema = z.object({
  snapshot: pilotSnapshotSchema.nullable(),
  entries: z.array(pilotEntrySchema),
  placements: z.record(z.string(), z.object({ value: pilotPlacement, version: z.string() })),
  versions: z.record(z.string(), z.string()),
  totalEntries: z.number(),
});
export type PilotBoard = z.infer<typeof pilotBoardSchema>;
export const pilotSendSchema = z.object({
  commandId: id, text: z.string().trim().min(1).max(2000),
  needId: id.optional(), sourceVersion: id.optional(),
}).strict();
export type PilotSend = z.infer<typeof pilotSendSchema>;
export const crewPilotContract = {
  crew_pilot_board: { input: z.object({}).strict(), output: pilotBoardSchema },
  crew_pilot_refresh: { input: z.object({}).strict(), output: pilotBoardSchema },
  crew_pilot_send: { input: pilotSendSchema, output: pilotEntrySchema },
  crew_pilot_review: { input: z.object({ id, review: z.enum(["correct", "incorrect"]) }).strict(), output: pilotBoardSchema },
} as const;

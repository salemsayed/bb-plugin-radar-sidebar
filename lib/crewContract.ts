import { z } from "zod";
import { needsItemSchema } from "./needs";
const id = z.string().min(1).max(200);
const completionCheck = z.object({ status: z.enum(["passed", "not_applicable", "failed"]), evidence: z.string().trim().min(1).max(2000) }).strict();
export const completionChecks = z.object({ delivery: completionCheck, verification: completionCheck, cleanup: completionCheck }).strict();
export const authorizationSchema = z.object({ threadId: id, userSeq: z.number().int().min(1), text: z.string().min(1).max(4000) });
export const crewWorkSchema = z.object({ id, key: id, owner: id, title: z.string().min(1).max(500),
  origin: z.enum(["crew", "direct", "legacy"]), stage: z.enum(["proposed", "queued", "active", "blocked", "stopping", "done", "canceled", "unknown"]),
  revision: z.number().int(), createdAt: z.number(), updatedAt: z.number(), evidence: z.string().nullable(),
  objective: z.string().optional(), authorization: authorizationSchema.optional(), completionRequired: z.boolean().optional(),
  checks: completionChecks.optional(), workerIds: z.array(id).max(50).optional() });
export const crewRequestSchema = z.object({ id, workId: id, key: id, text: z.string().min(1).max(4000), version: z.number().int(),
  state: z.enum(["open", "answer_queued", "answered", "withdrawn", "dismissed"]),
  placement: z.enum(["needs_you", "reminders", "later"]), due: z.string().nullable(), snoozeUntil: z.string().nullable(),
  sourceIds: z.array(id), sourceVersions: z.record(id, z.string()), answer: z.string().nullable(), evidence: z.string().nullable(), updatedAt: z.number() });
export const crewCommandSchema = z.object({ id, workId: id, requestId: id.nullable(), kind: z.enum(["assign", "answer", "cancel", "followup", "wake", "source_update"]),
  state: z.enum(["proposed", "queued", "sending", "received", "uncertain", "obsolete"]), text: z.string(),
  requestVersion: z.number().int().nullable().default(null), recipient: z.string().nullable(), baseline: z.number(), createdAt: z.number(), receivedAt: z.number().nullable() });
export const crewControlSchema = z.object({ mode: z.enum(["shadow", "live"]).default("shadow"), paused: z.boolean().default(false),
  coordinator: z.string().nullable().default(null), projectId: z.string().nullable().default(null), environmentId: z.string().nullable().default(null),
  epoch: z.string().nullable().default(null), creating: z.boolean().default(false) });
export type CrewWork = z.infer<typeof crewWorkSchema>;
export type CrewRequest = z.infer<typeof crewRequestSchema>;
export type CrewCommand = z.infer<typeof crewCommandSchema>;
export type CrewControl = z.infer<typeof crewControlSchema>;
export const crewEventSchema = z.object({ id, workId: id, kind: z.string(), actor: z.string(), at: z.number(), detail: z.string() });
export const crewBoardSchema = z.object({ control: crewControlSchema, work: z.array(crewWorkSchema), requests: z.array(crewRequestSchema), commands: z.array(crewCommandSchema),
  reviews: z.array(z.object({ eventId: id, verdict: z.enum(["correct", "incorrect"]), at: z.number() })),
  events: z.array(crewEventSchema), sources: z.array(needsItemSchema), bots: z.array(z.object({ key: id, name: z.string(), current: id })),
  refreshedAt: z.number().nullable(), warning: z.string().nullable() });
export type CrewBoard = z.infer<typeof crewBoardSchema>;
export const reportSchema = z.object({ eventId: id, workId: id, expectedRevision: z.number().int().min(1),
  kind: z.enum(["accepted", "progress", "blocked", "completed", "cancel_ack", "question", "ack_answer", "direct_answer", "withdraw"]),
  evidence: z.string().min(1).max(4000), requestKey: id.optional(), requestId: id.optional(), expectedVersion: z.number().int().optional(),
  userSeq: z.number().int().min(1).optional(),
  userThreadId: id.optional(),
  checks: completionChecks.optional(), workerIds: z.array(id).max(50).optional(),
  text: z.string().min(1).max(4000).optional(), placement: z.enum(["needs_you", "reminders", "later"]).optional() }).strict();
export const organizeSchema = z.object({ eventId: id, sourceIds: z.array(id).min(1).max(50),
  sourceVersions: z.record(id, z.string()), workKey: id, title: z.string().min(1).max(500), requestKey: id,
  state: z.enum(["open", "answered", "withdrawn"]), placement: z.enum(["needs_you", "reminders", "later"]),
  remaining: z.object({ key: id, text: z.string().min(1).max(4000), placement: z.enum(["needs_you", "reminders", "later"]) }).optional(),
  evidence: z.string().min(1).max(4000), evidenceThread: id.optional(), userSeq: z.number().int().optional(), botSeq: z.number().int().optional(),
}).strict();
export const crewContract = {
  crew_automation_question: { input: z.object({ eventId: id, owner: id, automationId: id, reportId: z.string().min(1).max(500), sourceThreadId: id,
    question: z.string().trim().min(1).max(1000), evidence: z.string().trim().min(1).max(4000) }).strict(),
    output: z.object({ recorded: z.literal(true), workId: id, requestId: id }).strict() },
  crew_board: { input: z.object({}).strict(), output: crewBoardSchema },
  crew_refresh: { input: z.object({}).strict(), output: crewBoardSchema },
  crew_control: { input: z.object({ paused: z.boolean().optional(), mode: z.enum(["shadow", "live"]).optional() }).strict(), output: crewControlSchema },
  crew_setup: { input: z.object({ baseThreadId: id, replace: z.boolean().optional() }).strict(), output: crewControlSchema },
  crew_user_request: { input: z.object({ commandId: id, requestId: id, expectedVersion: z.number().int(),
    action: z.enum(["answer", "later", "dismiss", "reopen"]), text: z.string().trim().min(1).max(4000).optional() }).strict(), output: crewBoardSchema },
  crew_user_cancel: { input: z.object({ commandId: id, workId: id, expectedRevision: z.number().int() }).strict(), output: crewBoardSchema },
  crew_proposal: { input: z.object({ commandId: id, proposalId: id, action: z.enum(["send", "discard"]) }).strict(), output: crewBoardSchema },
  crew_review: { input: z.object({ eventId: id, verdict: z.enum(["correct", "incorrect"]) }).strict(), output: crewBoardSchema },
  crew_reconcile: { input: z.object({ commandId: id }).strict(), output: crewCommandSchema },
} as const;

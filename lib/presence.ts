import { z } from "zod";

export const LEASE_MS = 60_000;
export const HEARTBEAT_MS = 20_000;
export const presenceContract = {
  presence_heartbeat: {
    input: z.object({ clientId: z.string().min(1).max(100), sequence: z.number().int().nonnegative(), threadId: z.string().min(1).max(200).nullable(), visible: z.boolean(), through: z.number().finite().nonnegative().nullable().optional(), messageSeq: z.number().int().positive().safe().nullable().optional() }).strict(),
    output: z.object({ ok: z.literal(true) }),
  },
  presence_read_point: {
    input: z.object({ threadId: z.string().min(1).max(200) }).strict(),
    output: z.object({ through: z.number().nullable(), messageSeq: z.number().int().positive().safe().nullable() }),
  },
  presence_open: {
    input: z.object({ threadId: z.string().min(1).max(200) }).strict(),
    output: z.object({ open: z.boolean() }),
  },
};
export type Heartbeat = z.infer<typeof presenceContract.presence_heartbeat.input>;

export type ReadPoint = { through: number; messageSeq: number };

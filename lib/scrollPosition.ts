import { z } from "zod";

const lineSchema = z.object({
  row: z.string().min(1).max(400).optional(),
  path: z.array(z.number().int().min(0).max(100000)).max(64),
  offset: z.number().finite().min(-1000000).max(1000000),
  hash: z.number().int(),
});
export const positionSchema = z.discriminatedUnion("atBottom", [
  z.object({ atBottom: z.literal(true), messageSeq: z.null(), offset: z.literal(0) }),
  z.object({ atBottom: z.literal(false), messageSeq: z.number().int().positive().safe(), offset: z.number().finite().min(-1000000).max(1000000), line: lineSchema.optional() }),
]);
export type ScrollPosition = z.infer<typeof positionSchema>;
export type LineAnchor = z.infer<typeof lineSchema>;
const keySchema = z.object({ threadId: z.string().min(1).max(200), deviceId: z.string().min(1).max(100) });
const traceEventSchema = z.object({ event: z.string().max(40), threadId: z.string().max(200).nullable(), at: z.number().finite(), wallTime: z.number().finite(), hash: z.string().max(200), data: z.unknown() });
export type TraceEvent = z.infer<typeof traceEventSchema>;
export const scrollContract = {
  scroll_get: { input: keySchema, output: positionSchema.nullable() },
  scroll_set: { input: keySchema.extend({ position: positionSchema }), output: z.object({ ok: z.literal(true) }) },
  scroll_debug: { input: z.object({}), output: z.object({ on: z.boolean() }) },
  scroll_trace: { input: z.object({ deviceId: z.string().min(1).max(100), page: z.string().max(100), agent: z.string().max(400).optional(), events: z.array(traceEventSchema).max(400) }), output: z.object({ on: z.boolean() }) },
};
export const BOTTOM_GAP = 24;
export const AT_BOTTOM: ScrollPosition = { atBottom: true, messageSeq: null, offset: 0 };
export function capturePosition(scrollTop: number, height: number, scrollHeight: number, top: number, anchors: { seq: number; top: number; bottom: number }[]): ScrollPosition | null {
  if (scrollHeight - height - scrollTop <= BOTTOM_GAP) return AT_BOTTOM;
  const anchor = anchors.filter(a => a.bottom > top && a.top < top + height).sort((a, b) => a.top - b.top)[0];
  return anchor ? { atBottom: false, messageSeq: anchor.seq, offset: anchor.top - top } : null;
}
export const restoreDelta = (anchorTop: number, containerTop: number, offset: number) => anchorTop - containerTop - offset;
export function textHash(text: string) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < Math.min(text.length, 96); i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash | 0;
}

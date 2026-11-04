import { z } from "zod";

export const positionSchema = z.discriminatedUnion("atBottom", [
  z.object({ atBottom: z.literal(true), messageSeq: z.null(), offset: z.literal(0) }),
  z.object({ atBottom: z.literal(false), messageSeq: z.number().int().positive().safe(), offset: z.number().finite().min(-1000000).max(1000000) }),
]);
export type ScrollPosition = z.infer<typeof positionSchema>;
const keySchema = z.object({ threadId: z.string().min(1).max(200), deviceId: z.string().min(1).max(100) });
export const scrollContract = {
  scroll_get: { input: keySchema, output: positionSchema.nullable() },
  scroll_set: { input: keySchema.extend({ position: positionSchema }), output: z.object({ ok: z.literal(true) }) },
};
export function capturePosition(scrollTop: number, height: number, scrollHeight: number, top: number, anchors: { seq: number; top: number; bottom: number }[]): ScrollPosition | null {
  const anchor = anchors.filter(a => a.bottom > top && a.top < top + height).sort((a, b) => a.top - b.top)[0];
  return anchor ? { atBottom: false, messageSeq: anchor.seq, offset: anchor.top - top } : scrollHeight - height - scrollTop <= 24 ? { atBottom: true, messageSeq: null, offset: 0 } : null;
}
export const restoreDelta = (anchorTop: number, containerTop: number, offset: number) => anchorTop - containerTop - offset;

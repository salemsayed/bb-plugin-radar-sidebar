import { z } from "zod";
import { cairoInstant } from "./reminderTimes";
import { needsItemSchema, type NeedsItem } from "./needs";
import { attentionEventSchema, type AttentionEvent } from "./attention";
export const workSchema = z.object({ key: z.string(), bot: z.string(), needsItemId: z.string(), kind: z.enum(["decision", "obligation"]), state: z.enum(["pending", "held", "cancelled", "complete"]), generation: z.number(), summary: z.string(), updatedAt: z.number(), evidenceOrder: z.number(), evidenceId: z.string().nullable() });
export const boardSchema = z.object({ bot: z.string(), current: z.string(), version: z.string(), items: z.array(needsItemSchema), events: z.array(attentionEventSchema), work: z.array(workSchema), reviews: z.array(z.object({ itemId: z.string(), version: z.string(), threadId: z.string(), seq: z.number(), order: z.number(), suggestion: z.string(), scoped: z.boolean() })), holds: z.array(z.object({ itemId: z.string(), condition: z.string(), until: z.string().nullable(), evidenceId: z.string(), ownerReviewedAt: z.number().optional() })).default([]), more: z.boolean() });
export type AttentionBoard = z.infer<typeof boardSchema>;
export const botAttentionContract = {
  bot_attention: { input: z.object({ threadId: z.string().min(1) }).strict(), output: z.object({ board: boardSchema.nullable() }) },
} as const;
export function attentionDueAt(due: string): number {
  if (/(?:Z|[+-]\d{2}:\d{2})$/.test(due)) return Date.parse(due);
  const local = due.length === 10 ? `${due}T09:00` : due.slice(0, 16);
  const seconds = due.length > 16 ? Date.parse(`${due}Z`) - Date.parse(`${local}:00Z`) : 0;
  return Date.parse(cairoInstant(local)) + seconds;
}
export type AttentionCard = { id: string; item: NeedsItem | null; events: AttentionEvent[]; section: "attention" | "later" | "history" };
/** Exact saved links, never text similarity. Completion updates remain independent. */
export function attentionCards(board: AttentionBoard, now: number): AttentionCard[] {
  const remaining = new Map(board.events.map(e => [e.id, e]));
  const cards: AttentionCard[] = [];
  for (const item of board.items) {
    const events = board.events.filter(e => e.needsItemId === item.id && (e.kind === "question" || e.kind === "reminder"));
    events.forEach(e => remaining.delete(e.id));
    const closed = item.state === "done" || item.state === "dropped";
    const due = item.due ? attentionDueAt(item.due) : null;
    const later = item.state === "snoozed" || !["decision", "urgent"].includes(item.kind) && (due === null || due > now);
    cards.push({ id: item.id, item, events, section: closed ? "history" : later ? "later" : "attention" });
  }
  for (const e of remaining.values()) cards.push({ id: e.id, item: null, events: [e], section: e.seenAt === null && e.resolvedAt === null ? "attention" : "history" });
  return cards.sort((a, b) => Math.max(...b.events.map(e => e.createdAt), b.item ? Date.parse(b.item.createdAt) : 0) - Math.max(...a.events.map(e => e.createdAt), a.item ? Date.parse(a.item.createdAt) : 0));
}
const ENTRY = "radar:attention-entry";
export function requestBotAttention(current: string, badge: boolean) {
  if (!badge) return;
  sessionStorage.setItem(ENTRY, JSON.stringify({ current, at: Date.now() }));
  window.dispatchEvent(new Event("radar:attention-entry"));
}
export function consumeBotAttention(current: string): boolean {
  try {
    const value = JSON.parse(sessionStorage.getItem(ENTRY) ?? "null");
    if (!value || value.current !== current || Date.now() - value.at > 10_000) return false;
    sessionStorage.removeItem(ENTRY); return true;
  } catch { sessionStorage.removeItem(ENTRY); return false; }
}

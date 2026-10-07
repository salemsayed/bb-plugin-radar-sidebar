import { z } from "zod";
import { cairoInstant } from "./reminderTimes";

export const NEEDS_PLUGIN = "orchestrator-mode";
export const needsItemSchema = z.object({
  id: z.string(), bot: z.string(), kind: z.enum(["decision", "reminder", "deadline", "urgent"]),
  text: z.string(), due: z.string().nullable(), state: z.enum(["open", "snoozed", "reminded", "done", "dropped"]),
  snoozeUntil: z.string().nullable(),
  source: z.object({ threadId: z.string().optional(), messageId: z.string().optional(), automationId: z.string().optional() }),
  key: z.string().nullable(), createdAt: z.string(), closedAt: z.string().nullable(), reminders: z.number(),
});
export type NeedsItem = z.infer<typeof needsItemSchema>;
export const needsListSchema = z.object({ items: z.array(needsItemSchema) });
export const needsResultSchema = z.object({ item: needsItemSchema });
export const needsAddSchema = z.object({
  bot: z.string().min(1), kind: needsItemSchema.shape.kind, text: z.string().min(1).max(500),
  due: z.string().optional(), thread: z.string().optional(), message: z.string().optional(), automation: z.string().optional(), key: z.string().optional(),
}).strict();
export const needsUpdateSchema = z.object({
  id: z.string().min(1), action: z.enum(["done", "drop", "snooze", "reopen"]), until: z.string().optional(),
}).strict();

/** A later human reply exists for a saved decision but the resolver could not confirm it answered: the card says so. */
export const needsSeenSchema = z.record(z.string(), z.object({ version: z.number(), score: z.number() }));
export type NeedsSeen = z.infer<typeof needsSeenSchema>;

/** Radar fronts the bot store on the server, so older/missing backends are optional. */
export const needsRpcContract = {
  crew_needs_list: { input: z.object({}).strict(), output: z.object({ items: z.array(needsItemSchema).nullable(), seen: needsSeenSchema.optional() }) },
  crew_needs_update: { input: needsUpdateSchema, output: needsResultSchema },
  crew_remind: {
    input: z.object({ threadId: z.string().min(1).max(64), messageId: z.string().min(1).max(256), text: z.string().min(1).max(120), until: z.string() }).strict(),
    output: needsResultSchema,
  },
} as const;

export function openNeeds(items: readonly NeedsItem[]): NeedsItem[] {
  const dueAt = (item: NeedsItem) => {
    if (!item.due) return Infinity;
    if (/(Z|[+-]\d{2}:\d{2})$/.test(item.due)) return Date.parse(item.due);
    const local = item.due.length === 10 ? `${item.due}T00:00` : item.due.slice(0, 16);
    try { return Date.parse(cairoInstant(local)); }
    catch { return Date.parse(cairoInstant(`${item.due.slice(0, 10)}T01:00`)); }
  };
  return items.filter(item => item.state === "open" || item.state === "snoozed" || item.state === "reminded").sort((a, b) =>
    (dueAt(a) - dueAt(b)) || a.createdAt.localeCompare(b.createdAt));
}

export function normalizedNeedsText(text: string): string {
  // Keep this equivalent to orchestrator-mode's normalizeNeedsText.
  return text.normalize("NFKC").toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "")
    .replace(/\s+/g, " ").trim();
}

// The relay wrapper bb-plugin-saelmbot puts around automation reports/notices (rollover.ts REPORT_RELAY):
// the reminder is about the finding, never the wrapper.
const RELAY_HEADER = /^Automation (?:report|notice|failed)\b/;
const RELAY_NOISE = /^(?:Your next reply is the alert|Finding:\s*$|Details:|About auto_|::inline-vis)/;

export function reminderText(text: string): string {
  let lines = text.split(/\r?\n/).map(line => line.replace(/^[\s#>*\-•]+/, "").replace(/\*\*|__|`/g, "").trim());
  const finding = lines.findIndex(line => /^Finding:\s*$/.test(line));
  if (RELAY_HEADER.test(lines.find(Boolean) ?? "") && finding >= 0) lines = lines.slice(finding + 1);
  return lines.find(line => line && !RELAY_HEADER.test(line) && !RELAY_NOISE.test(line)
    && !/^(?:(?:[A-Z]+_)*READY_|HANDOFF_|SESSION_OK\b)/.test(line))?.slice(0, 120) ?? "";
}

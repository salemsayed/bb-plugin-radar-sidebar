import type { NeedsItem } from "@/lib/needs";
import type { RosterBot } from "./bots";
export const NEEDS_NOW = Date.parse("2026-10-07T10:00:00Z");
export const NEEDS_BOT: RosterBot = { key: "home", name: "Home Bot", current: "coord", coordinatorIds: ["old"], projectId: "p", projects: [], hostId: "h", providerId: "codex", model: "m", rollover: null };
export function makeNeed(overrides: Partial<NeedsItem> = {}): NeedsItem {
  return { id: "need1", bot: "home", kind: "decision", text: "Approve the repair", due: "2026-10-08", state: "open", snoozeUntil: null, source: { threadId: "coord", messageId: "m1" }, key: "k1", createdAt: "2026-10-07T08:00:00Z", closedAt: null, reminders: 0, ...overrides };
}

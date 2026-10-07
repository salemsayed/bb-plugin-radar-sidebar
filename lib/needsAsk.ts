import { createHash } from "node:crypto";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { rosterSchema } from "../components/radar/bots";
import { NEEDS_PLUGIN, needsListSchema, needsResultSchema, normalizedNeedsText } from "./needs";

/** After a failed or botless capture, leave the store alone this long before trying that ask again. */
const RETRY_MS = 5 * 60_000;
const ACTIVE = ["open", "snoozed", "reminded"];

/** The text an ask is saved and shown as, everywhere: no marker, one space between words, 220 characters. */
export function savedAskText(ask: string): string {
  return ask.replace(/^decision needed:\s*/i, "").replace(/\s+/g, " ").trim().slice(0, 220);
}

/** The store's dedupe key for one ask in one coordinator; the resolver recognises captured decisions by it. */
export function askKey(threadId: string, text: string): string {
  return `${threadId}:${createHash("sha256").update(normalizedNeedsText(text)).digest("hex").slice(0, 24)}`;
}

/**
 * Saves a judged ask on the Needs You list and answers with the item it lives
 * as, or null when the store is unavailable or the thread belongs to no bot.
 * Each reply version is captured once: a repeat of the same ask in a later
 * reply reuses the item while it is open, and is saved again once Salem has
 * closed it. The store itself is never asked about a version it already took.
 */
export function createNeedsAskRecorder(bb: BbPluginApi, now: () => number = Date.now) {
  const pending = new Map<string, Promise<string | null>>();
  const retryAt = new Map<string, number>();
  return async (threadId: string, ask: string, version: number): Promise<string | null> => {
    const text = savedAskText(ask);
    if (!text) return null;
    const key = askKey(threadId, text);
    const memo = `${key}@${version}`;
    if (pending.has(memo)) return pending.get(memo)!;
    const task = (async () => {
      const flag = `needs-captured:${key}`;
      try {
        const captured = await bb.storage.kv.get<{ version: number; itemId: string } | boolean>(flag);
        if (typeof captured === "object" && captured.version === version) return captured.itemId;
        if ((retryAt.get(key) ?? 0) > now()) return null;
        const { bots } = await bb.sdk.plugins.callRpc({ pluginId: NEEDS_PLUGIN, method: "bot_roster", input: null, outputSchema: rosterSchema });
        const bot = bots.find(bot => bot.current === threadId || bot.coordinatorIds?.includes(threadId));
        if (!bot) { retryAt.set(key, now() + RETRY_MS); return null; }
        const { items } = await bb.sdk.plugins.callRpc({ pluginId: NEEDS_PLUGIN, method: "needs_list", input: { bot: bot.key }, outputSchema: needsListSchema });
        const open = items.find(item => item.bot === bot.key && ACTIVE.includes(item.state) && normalizedNeedsText(item.text) === normalizedNeedsText(text));
        const item = open ?? (await bb.sdk.plugins.callRpc({ pluginId: NEEDS_PLUGIN, method: "needs_add", outputSchema: needsResultSchema,
          input: { bot: bot.key, kind: "decision", text, thread: threadId, key } })).item;
        await bb.storage.kv.set(flag, { version, itemId: item.id });
        retryAt.delete(key);
        return item.id;
      } catch (error) {
        // Optional backend: its absence must never change the Crew judgement.
        retryAt.set(key, now() + RETRY_MS);
        bb.log.warn(`Needs You capture failed for ${threadId} at version ${version}: ${error instanceof Error ? error.message : String(error)}`);
        return null;
      }
    })().finally(() => pending.delete(memo));
    pending.set(memo, task);
    return task;
  };
}

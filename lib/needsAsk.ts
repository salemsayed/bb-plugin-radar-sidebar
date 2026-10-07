import { createHash } from "node:crypto";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { rosterSchema } from "../components/radar/bots";
import { NEEDS_PLUGIN, needsListSchema, needsResultSchema, normalizedNeedsText } from "./needs";

/** Storage remembers successful captures even after Done; unavailable stores retry on the next read. */
export function createNeedsAskRecorder(bb: BbPluginApi) {
  const pending = new Map<string, Promise<void>>();
  return async (threadId: string, ask: string): Promise<void> => {
    const text = ask.replace(/^decision needed:\s*/i, "").replace(/\s+/g, " ").trim().slice(0, 220);
    if (!text) return;
    const key = `${threadId}:${createHash("sha256").update(normalizedNeedsText(text)).digest("hex").slice(0, 24)}`;
    if (pending.has(key)) return pending.get(key);
    const task = (async () => {
      try {
        if (await bb.storage.kv.get<boolean>(`needs-captured:${key}`)) return;
        const { bots } = await bb.sdk.plugins.callRpc({ pluginId: NEEDS_PLUGIN, method: "bot_roster", input: null, outputSchema: rosterSchema });
        const bot = bots.find(bot => bot.current === threadId || bot.coordinatorIds?.includes(threadId));
        if (!bot) return;
        const { items } = await bb.sdk.plugins.callRpc({ pluginId: NEEDS_PLUGIN, method: "needs_list", input: { bot: bot.key }, outputSchema: needsListSchema });
        if (items.some(item => item.bot === bot.key && ["open", "snoozed", "reminded"].includes(item.state)
          && normalizedNeedsText(item.text) === normalizedNeedsText(text))) {
          await bb.storage.kv.set(`needs-captured:${key}`, true);
          return;
        }
        await bb.sdk.plugins.callRpc({ pluginId: NEEDS_PLUGIN, method: "needs_add", outputSchema: needsResultSchema,
          input: { bot: bot.key, kind: "decision", text, thread: threadId, key } });
        await bb.storage.kv.set(`needs-captured:${key}`, true);
      } catch {
        // Optional backend: its absence must never change the Crew judgement.
      }
    })().finally(() => pending.delete(key));
    pending.set(key, task);
    return task;
  };
}

import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { z } from "zod";
import { rosterSchema, type RosterBot } from "../components/radar/bots";
import { NEEDS_PLUGIN, needsListSchema, needsResultSchema, needsRpcContract, type NeedsItem } from "./needs";

const ACTIVE = ["open", "snoozed", "reminded"] as const;

/** Follow parents and lifecycle owners, including old coordinators, without guessing from projects. */
export async function threadBot(bb: BbPluginApi, threadId: string, roster: readonly RosterBot[]): Promise<string> {
  const visited = new Set<string>();
  const pending = [threadId];
  while (pending.length && visited.size < 100) {
    const id = pending.shift()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const bot = roster.find(bot => bot.current === id || bot.coordinatorIds?.includes(id));
    if (bot) return bot.key;
    const thread = await bb.sdk.threads.get({ threadId: id });
    if (thread.parentThreadId) pending.push(thread.parentThreadId);
    if (thread.lifecycleOwnerThreadId) pending.push(thread.lifecycleOwnerThreadId);
  }
  return "personal";
}

/**
 * Whether each coordinator is waiting on Salem: its bot's newest open decision
 * or urgent item on the Needs You list, preferring one saved from that thread.
 * Saved items are the one ask record, so a face, a bubble and the list agree,
 * and an ask stops showing as soon as anyone closes or snoozes it.
 */
export function askJudgements(items: readonly NeedsItem[], bots: readonly RosterBot[], threads: readonly { threadId: string; version: number }[]) {
  return threads.map(({ threadId, version }) => {
    const bot = bots.find(bot => bot.current === threadId || bot.coordinatorIds?.includes(threadId));
    const asks = items.filter(item => item.bot === bot?.key && (item.state === "open" || item.state === "reminded") && (item.kind === "decision" || item.kind === "urgent"))
      .sort((a, b) => Number(b.source.threadId === threadId) - Number(a.source.threadId === threadId) || b.createdAt.localeCompare(a.createdAt));
    return { threadId, version, waiting: asks.length ? 1 : 0, ask: asks[0]?.text ?? null, itemId: asks[0]?.id ?? null };
  });
}

export function createNeedsServer(bb: BbPluginApi) {
  const list = () => bb.sdk.plugins.callRpc({ pluginId: NEEDS_PLUGIN, method: "needs_list", input: { states: [...ACTIVE] }, outputSchema: needsListSchema });
  const roster = () => bb.sdk.plugins.callRpc({ pluginId: NEEDS_PLUGIN, method: "bot_roster", input: null, outputSchema: rosterSchema });
  const update = (input: z.infer<typeof needsRpcContract.crew_needs_update.input>) =>
    bb.sdk.plugins.callRpc({ pluginId: NEEDS_PLUGIN, method: "needs_update", input: needsRpcContract.crew_needs_update.input.parse(input), outputSchema: needsResultSchema });
  return {
    async asks(threads: readonly { threadId: string; version: number }[]) {
      const [{ bots }, { items }] = await Promise.all([roster(), list()]);
      return askJudgements(items, bots, threads);
    },
    handlers: {
      async crew_needs_list(): Promise<{ items: NeedsItem[] | null }> {
        // A list read never starts a classifier: bots, Salem and ChatGPT close items.
        try { return { items: (await list()).items }; } catch { return { items: null }; }
      },
      // Closing an item also clears its bot's ask: asks are read from the open items.
      crew_needs_update: (input: z.infer<typeof needsRpcContract.crew_needs_update.input>) => update(input),
      async crew_remind(input: { threadId: string; messageId: string; text: string; until: string }) {
        if (!Number.isFinite(Date.parse(input.until)) || Date.parse(input.until) <= Date.now()) throw new Error("Choose a future time.");
        const bot = await threadBot(bb, input.threadId, (await roster()).bots);
        const result = await bb.sdk.plugins.callRpc({
          pluginId: NEEDS_PLUGIN, method: "needs_add", outputSchema: needsResultSchema,
          input: { bot, kind: "reminder", text: input.text, due: input.until, thread: input.threadId, message: input.messageId, key: `remind:${input.threadId}:${input.messageId}:${input.until}:${input.text}` },
        });
        // Repeating a failed request recovers the same reminder and retries snooze.
        return update({ id: result.item.id, action: "snooze", until: input.until });
      },
    },
  };
}

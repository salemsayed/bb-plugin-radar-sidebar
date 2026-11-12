import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { rosterSchema, type RosterBot } from "../components/radar/bots";
import { NEEDS_PLUGIN, needsListSchema, needsResultSchema, needsRpcContract, type NeedsItem } from "./needs";
import { questionSchema, type Question } from "./questionRecords";

const ACTIVE = ["open", "snoozed", "reminded"] as const;
const questionsOutput = z.object({ questions: z.array(questionSchema) }).passthrough();

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

export function askJudgements(questions: readonly Question[], bots: readonly RosterBot[], threads: readonly { threadId: string; version: number }[]) {
  return threads.map(({ threadId, version }) => {
    const bot = bots.find(bot => bot.current === threadId || bot.coordinatorIds?.includes(threadId));
    const asks = questions.filter(q => q.bot === bot?.key && q.state === "open")
      .sort((a, b) => Number(b.threadId === threadId) - Number(a.threadId === threadId) || b.askedAt - a.askedAt);
    return { threadId, version, waiting: asks.length ? 1 : 0, ask: asks[0]?.question ?? null, itemId: asks[0]?.id ?? null };
  });
}

export function createNeedsServer(bb: BbPluginApi) {
  const list = () => bb.sdk.plugins.callRpc({ pluginId: NEEDS_PLUGIN, method: "needs_list", input: { states: [...ACTIVE] }, outputSchema: needsListSchema });
  const roster = () => bb.sdk.plugins.callRpc({ pluginId: NEEDS_PLUGIN, method: "bot_roster", input: null, outputSchema: rosterSchema });
  const questions = () => bb.sdk.plugins.callRpc({ pluginId: NEEDS_PLUGIN, method: "bot_tasks", input: {}, outputSchema: questionsOutput });
  const update = (input: z.infer<typeof needsRpcContract.crew_needs_update.input>) =>
    bb.sdk.plugins.callRpc({ pluginId: NEEDS_PLUGIN, method: "needs_update", input: needsRpcContract.crew_needs_update.input.parse(input), outputSchema: needsResultSchema });
  return {
    async asks(threads: readonly { threadId: string; version: number }[]) {
      const [{ bots }, out] = await Promise.all([roster(), questions()]);
      return askJudgements(out.questions, bots, threads);
    },
    handlers: {
      async crew_needs_list(): Promise<{ items: NeedsItem[] | null }> {
        try { return { items: (await list()).items }; } catch { return { items: null }; }
      },
      crew_needs_update: (input: z.infer<typeof needsRpcContract.crew_needs_update.input>) => update(input),
      async crew_remind(input: { threadId: string; messageId: string; text: string; until: string }) {
        if (!Number.isFinite(Date.parse(input.until)) || Date.parse(input.until) <= Date.now()) throw new Error("Choose a future time.");
        const bot = await threadBot(bb, input.threadId, (await roster()).bots);
        const result = await bb.sdk.plugins.callRpc({
          pluginId: NEEDS_PLUGIN, method: "needs_add", outputSchema: needsResultSchema,
          input: { bot, kind: "reminder", text: input.text, due: input.until, thread: input.threadId, message: input.messageId, key: `remind:${input.threadId}:${input.messageId}:${input.until}:${input.text}` },
        });
        return update({ id: result.item.id, action: "snooze", until: input.until });
      },
    },
  };
}

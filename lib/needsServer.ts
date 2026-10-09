import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { z } from "zod";
import { rosterSchema, type RosterBot } from "../components/radar/bots";
import { dismissJudgedAsk } from "./crewJudge";
import { NEEDS_PLUGIN, needsListSchema, needsResultSchema, needsRpcContract, type NeedsItem, type NeedsSeen } from "./needs";
import { seenMarkers } from "./needsResolution";

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

export function createNeedsServer(bb: BbPluginApi) {
  const list = () => bb.sdk.plugins.callRpc({ pluginId: NEEDS_PLUGIN, method: "needs_list", input: { states: [...ACTIVE] }, outputSchema: needsListSchema });
  const roster = () => bb.sdk.plugins.callRpc({ pluginId: NEEDS_PLUGIN, method: "bot_roster", input: null, outputSchema: rosterSchema });
  const update = (input: z.infer<typeof needsRpcContract.crew_needs_update.input>) =>
    bb.sdk.plugins.callRpc({ pluginId: NEEDS_PLUGIN, method: "needs_update", input: needsRpcContract.crew_needs_update.input.parse(input), outputSchema: needsResultSchema });
  return {
    handlers: {
      async crew_needs_list(): Promise<{ items: NeedsItem[] | null; seen?: NeedsSeen }> {
        try {
          // Historical sources remain readable; Crew owns evidence-backed
          // reconciliation. A list read never starts another classifier.
          const { items } = await list();
          return { items, seen: await seenMarkers(bb, items) };
        } catch { return { items: null }; }
      },
      async crew_needs_update(input: z.infer<typeof needsRpcContract.crew_needs_update.input>) {
        const result = await update(input);
        if (input.action === "done" || input.action === "drop" || input.action === "reopen") {
          try {
            if (await dismissJudgedAsk(bb, result.item, input.action !== "reopen")) {
              bb.log.info(`Needs You ${result.item.id}: ${input.action === "reopen" ? "reopened, ask shows again" : "closed by Salem, ask dismissed for the current reply"}`);
            }
          } catch (error) {
            bb.log.warn(`Needs You ${result.item.id}: could not mark the judgement ${input.action}: ${error instanceof Error ? error.message : String(error)}`);
          }
        }
        return result;
      },
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

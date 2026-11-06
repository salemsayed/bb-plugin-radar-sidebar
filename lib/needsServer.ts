import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { z } from "zod";
import { rosterSchema, type RosterBot } from "../components/radar/bots";
import { NEEDS_PLUGIN, needsListSchema, needsResultSchema, needsRpcContract, normalizedNeedsText, type NeedsItem } from "./needs";

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

const ASK_PAGES = 5;
const MISS_TTL_MS = 5 * 60_000;
const BEFORE_ASK_MS = 10 * 60_000;

export function askNeedle(text: string): string {
  return normalizedNeedsText(text).slice(0, 60).trim();
}

const TEST_MESSAGE = /^\s*UI\s+test\s*,\s*ignore\b/i;
const REPLY_TTL_MS = 60_000;

export function salemTurn(data: unknown): boolean {
  const d = data as { initiator?: string; senderThreadId?: string | null; originPluginId?: string | null; source?: string; systemMessageKind?: string; input?: { type?: string; text?: string; visibility?: string }[] };
  const text = (d.input ?? []).filter(part => (!part.type || part.type === "text") && !part.visibility).map(part => part.text ?? "").join("\n");
  return d.initiator === "user" && !d.senderThreadId && !d.originPluginId && d.source !== "spawn" && (!d.systemMessageKind || d.systemMessageKind === "unlabeled")
    && !!text.trim() && !/^\s*(?:\[via ChatGPT\]|[\u21b3\u2937]|\/[a-z][\w-]*\s*$)/i.test(text) && !TEST_MESSAGE.test(text);
}

export function createReplyFinder(bb: BbPluginApi) {
  const found = new Map<string, { reply: { seq: number; at: number } | null; at: number }>();
  return async function reply(threadId: string, askSeq: number): Promise<{ seq: number; at: number } | null> {
    const key = `${threadId}#${askSeq}`;
    const hit = found.get(key);
    if (hit && (hit.reply || Date.now() - hit.at < REPLY_TTL_MS)) return hit.reply;
    let reply: { seq: number; at: number } | null = null;
    try {
      const rows = await bb.sdk.threads.events.list({ threadId, afterSeq: String(askSeq), order: "asc", limit: "100", types: ["client/turn/requested"] });
      const first = rows.find(row => salemTurn(row.data));
      reply = first ? { seq: first.seq, at: first.createdAt } : null;
    } catch { reply = null; }
    found.set(key, { reply, at: Date.now() });
    while (found.size > 500) found.delete(found.keys().next().value!);
    return reply;
  };
}

const REPLY_BUTTON = /\bButton\(\s*"([^"\n]{2,90})"\s*(?:,\s*([A-Za-z]+)\s*\()?/g;
const MAX_OPTIONS = 4;

export function replyOptions(text: string): string[] {
  const blocks = text.match(/```ui[\s\S]*?```/g) ?? [];
  const labels = blocks.flatMap(block => [...block.matchAll(REPLY_BUTTON)].filter(match => !match[2] || /^(?:Reply|Send|Answer|Prompt)$/i.test(match[2])).map(match => match[1]!.trim()));
  return [...new Set(labels)].slice(0, MAX_OPTIONS);
}

export interface AskPlace { seq: number | null; options: string[] }

type Said = { type?: string; text?: string; parentToolCallId?: string };

export function createAskFinder(bb: BbPluginApi) {
  const found = new Map<string, AskPlace & { at: number }>();
  return async function askPlace(item: NeedsItem): Promise<AskPlace> {
    const threadId = item.source.threadId;
    if (item.kind !== "decision" || !threadId) return { seq: null, options: [] };
    const hit = found.get(item.id);
    if (hit && (hit.seq !== null || Date.now() - hit.at < MISS_TTL_MS)) return { seq: hit.seq, options: hit.options };
    const needle = askNeedle(item.text);
    const since = Date.parse(item.createdAt) - BEFORE_ASK_MS;
    const named = /^message:(\d+)$/.exec(item.source.messageId ?? "")?.[1];
    let place: AskPlace = { seq: null, options: [] };
    const said = (row: { data: unknown }) => (row.data as { item?: Said }).item;
    try {
      if (named) {
        const rows = await bb.sdk.threads.events.list({ threadId, afterSeq: String(Number(named) - 1), order: "asc", limit: "5", types: ["item/completed"] });
        const row = rows.find(row => row.seq === Number(named));
        place = { seq: Number(named), options: replyOptions(row ? said(row)?.text ?? "" : "") };
      } else if (needle.length >= 12) {
        let before: string | undefined;
        for (let page = 0; page < ASK_PAGES && place.seq === null; page++) {
          const rows = await bb.sdk.threads.events.list({ threadId, order: "desc", limit: "100", types: ["item/completed"], ...(before ? { beforeSeq: before } : {}) });
          for (const row of rows) {
            const message = said(row);
            if (message?.type === "agentMessage" && !message.parentToolCallId && normalizedNeedsText(message.text ?? "").includes(needle)) { place = { seq: row.seq, options: replyOptions(message.text ?? "") }; break; }
          }
          const last = rows.at(-1);
          if (rows.length < 100 || !last || last.createdAt < since) break;
          before = String(last.seq);
        }
      }
    } catch { place = { seq: null, options: [] }; }
    found.set(item.id, { ...place, at: Date.now() });
    while (found.size > 500) found.delete(found.keys().next().value!);
    return place;
  };
}

export function createNeedsServer(bb: BbPluginApi) {
  const askSeq = createAskFinder(bb);
  const replyAfter = createReplyFinder(bb);
  const withPlace = async (item: NeedsItem): Promise<NeedsItem> => {
    const { seq, options } = await askSeq(item);
    const answered = seq !== null && item.source.threadId ? await replyAfter(item.source.threadId, seq) : null;
    return { ...item, askSeq: seq, answered, ...(options.length ? { options } : {}) };
  };
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
        let items: NeedsItem[];
        try { items = (await list()).items; } catch { return { items: null }; }
        return { items: await Promise.all(items.map(item => item.kind === "decision" ? withPlace(item) : item)) };
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

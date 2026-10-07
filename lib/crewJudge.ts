import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { QUIET_LINE } from "../components/radar/bots";
import { askQuestions, askSentences, readAskAnswers, WAITING_THRESHOLD, type CrewJudgement } from "./crewAsk";
import { normalizedNeedsText } from "./needs";
import { savedAskText } from "./needsAsk";

const AUTO_EFFORT = "auto-effort";
/** After a failure (no Auto Effort, no key, Jev down), retry the same reply this much later. */
const RETRY_MS = 5 * 60_000;
const decisionSchema = z.object({ answers: z.unknown() });
const LIVE = new Set(["starting", "active", "stopping"]);

/** Where one coordinator's judgement of its latest reply lives, shared by every client. */
export function judgementKey(threadId: string): string {
  return `crew-ask:${threadId}`;
}

/** A reply that ends "Nothing to do." declares itself quiet: no classifier needed. */
export function isQuietReply(sentences: readonly string[]): boolean {
  const last = sentences.at(-1);
  return last !== undefined && QUIET_LINE.test(last);
}

/** Records what the judge found for the ask, or null to leave the ask unsaved. */
export type AskRecorder = (threadId: string, ask: string, version: number) => Promise<string | null>;

/**
 * Judges coordinator replies through Auto Effort's Jev RPC, once per reply.
 * A reply is identified by its thread and `latestAttentionAt`, read from the
 * thread together with its output so the verdict is filed under the reply it
 * describes, even when a newer reply lands between the client's look and
 * ours. A rollover's new coordinator, or a new bot, is judged the first time
 * anyone opens Crew. Results persist in plugin storage, shared by every
 * client, with the Needs You item the ask was saved as. Failures are not
 * stored: the sidebar falls back to "Decision needed:" lines and asks again
 * after RETRY_MS.
 */
export function createCrewJudge(bb: BbPluginApi, now: () => number = Date.now, recordAsk: AskRecorder = async () => null) {
  const pending = new Map<string, Promise<CrewJudgement>>();
  const retryAt = new Map<string, number>();
  let warned = false;

  async function judge(threadId: string, requested: number, memo: string): Promise<CrewJudgement> {
    const key = judgementKey(threadId);
    const cached = await bb.storage.kv.get<CrewJudgement>(key);
    if (cached?.version === requested) {
      // The store took the ask already, or there is none: nothing to redo on a hit.
      if (cached.itemId != null || (cached.waiting ?? 0) < WAITING_THRESHOLD || !cached.ask) return cached;
      const itemId = await recordAsk(threadId, cached.ask, cached.version);
      if (itemId === null) return cached;
      const saved = { ...cached, itemId };
      await bb.storage.kv.set(key, saved);
      return saved;
    }
    const unknown = { threadId, version: requested, waiting: null, ask: null };
    if ((retryAt.get(memo) ?? 0) > now()) return unknown;
    try {
      const thread = await bb.sdk.threads.get({ threadId });
      // A reply still being written is judged once it settles, under its own version.
      if (LIVE.has(thread.status)) return unknown;
      const version = thread.latestAttentionAt;
      const { output } = await bb.sdk.threads.output({ threadId });
      const sentences = askSentences(output ?? "");
      const explicit = [...sentences].reverse().find(sentence => /^decision needed:\s*\S/i.test(sentence));
      // One capture per reply: the coordinator's explicit ask wins over Jev; a quiet sign-off needs no Jev.
      let verdict: { waiting: number; ask: string | null } | null = explicit
        ? { waiting: 1, ask: explicit }
        : { waiting: 0, ask: null };
      if (!explicit && sentences.length > 0 && !isQuietReply(sentences)) {
        const decision = await bb.sdk.plugins.callRpc({
          pluginId: AUTO_EFFORT, method: "jev_decide", input: askQuestions(sentences), outputSchema: decisionSchema,
        });
        verdict = readAskAnswers(decision.answers, sentences);
        if (!verdict) throw new Error("Jev answered in an unexpected shape");
      }
      const ask = verdict.ask === null ? null : savedAskText(verdict.ask) || null;
      const itemId = verdict.waiting >= WAITING_THRESHOLD && ask ? await recordAsk(threadId, ask, version) : null;
      const judgement: CrewJudgement = { threadId, version, waiting: verdict.waiting, ask, itemId };
      await bb.storage.kv.set(key, judgement);
      retryAt.delete(memo);
      warned = false;
      return judgement;
    } catch (error) {
      for (const [entry, at] of retryAt) if (at <= now()) retryAt.delete(entry);
      retryAt.set(memo, now() + RETRY_MS);
      if (!warned) {
        warned = true;
        bb.log.warn(`Crew asks fall back to "Decision needed:" lines (${threadId} at version ${requested}): ${error instanceof Error ? error.message : String(error)}`);
      }
      return unknown;
    }
  }

  /** Concurrent callers for the same reply share one Jev request. */
  return (threads: readonly { threadId: string; version: number }[]): Promise<CrewJudgement[]> =>
    Promise.all(threads.map(({ threadId, version }) => {
      const memo = `${threadId}@${version}`;
      let request = pending.get(memo);
      if (!request) {
        request = judge(threadId, version, memo).finally(() => pending.delete(memo));
        pending.set(memo, request);
      }
      return request;
    }));
}

/**
 * Salem closed (or reopened) a saved decision: the judgement of the reply it
 * came from must say so, or the bubble and the rail would ask again until the
 * coordinator's next reply. Answers whether a judgement was marked.
 */
export async function dismissJudgedAsk(bb: BbPluginApi, item: { id: string; text: string; source: { threadId?: string } }, dismissed: boolean): Promise<boolean> {
  if (!item.source.threadId) return false;
  const key = judgementKey(item.source.threadId);
  const cached = await bb.storage.kv.get<CrewJudgement>(key);
  if (!cached?.ask) return false;
  const same = cached.itemId != null ? cached.itemId === item.id : normalizedNeedsText(cached.ask) === normalizedNeedsText(item.text);
  if (!same || (cached.dismissed ?? false) === dismissed) return false;
  await bb.storage.kv.set(key, { ...cached, dismissed });
  return true;
}

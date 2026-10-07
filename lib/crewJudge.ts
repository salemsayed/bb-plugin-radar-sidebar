import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { askQuestions, askSentences, readAskAnswers, type CrewJudgement } from "./crewAsk";

const AUTO_EFFORT = "auto-effort";
/** After a failure (no Auto Effort, no key, Jev down), retry the same reply this much later. */
const RETRY_MS = 5 * 60_000;
const decisionSchema = z.object({ answers: z.unknown() });

/**
 * Judges coordinator replies through Auto Effort's Jev RPC, once per reply.
 * A reply is identified by its thread and `latestAttentionAt`, so a rollover's
 * new coordinator, or a new bot, is judged the first time anyone opens Crew.
 * Results persist in plugin storage, shared by every client. Failures are not
 * stored: the sidebar falls back to "Decision needed:" lines and asks again
 * after RETRY_MS.
 */
export function createCrewJudge(bb: BbPluginApi, now: () => number = Date.now) {
  const pending = new Map<string, Promise<CrewJudgement>>();
  const retryAt = new Map<string, number>();
  let warned = false;

  async function judge(threadId: string, version: number, memo: string): Promise<CrewJudgement> {
    const key = `crew-ask:${threadId}`;
    const cached = await bb.storage.kv.get<CrewJudgement>(key);
    if (cached?.version === version) return cached;
    const unknown = { threadId, version, waiting: null, ask: null };
    if ((retryAt.get(memo) ?? 0) > now()) return unknown;
    try {
      const { output } = await bb.sdk.threads.output({ threadId });
      const sentences = askSentences(output ?? "");
      let verdict: { waiting: number; ask: string | null } | null = { waiting: 0, ask: null };
      if (sentences.length > 0) {
        const decision = await bb.sdk.plugins.callRpc({
          pluginId: AUTO_EFFORT, method: "jev_decide", input: askQuestions(sentences), outputSchema: decisionSchema,
        });
        verdict = readAskAnswers(decision.answers, sentences);
        if (!verdict) throw new Error("Jev answered in an unexpected shape");
      }
      const judgement: CrewJudgement = { threadId, version, ...verdict };
      await bb.storage.kv.set(key, judgement);
      retryAt.delete(memo);
      warned = false;
      return judgement;
    } catch (error) {
      for (const [entry, at] of retryAt) if (at <= now()) retryAt.delete(entry);
      retryAt.set(memo, now() + RETRY_MS);
      if (!warned) {
        warned = true;
        bb.log.warn(`Crew asks fall back to "Decision needed:" lines: ${error instanceof Error ? error.message : String(error)}`);
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

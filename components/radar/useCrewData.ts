import { useEffect, useState } from "react";
import { useRpc, type PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { CrewJudgement, crewRpcContract } from "@/lib/crewAsk";
import { NEEDS_CHANGED } from "@/lib/needsClient";

const RETRY_UNKNOWN_MS = 5 * 60_000;

/** A key that changes whenever a saved ask is added, closed or snoozed. */
export function needsKeyOf(items: readonly { id: string; state: string }[] | null): string {
  return items === null ? "unknown" : items.map(item => `${item.id}:${item.state}`).sort().join("|");
}

/**
 * Whether each settled coordinator is waiting on Salem, from its bot's saved
 * Needs You items on the server (lib/needsServer askJudgements). Asks again
 * when a coordinator settles on a new reply and whenever the Needs You list
 * changes, here or elsewhere (a bot or ChatGPT closing an ask). Working
 * coordinators are asked about too: the answer comes from the saved items,
 * not the reply, and skipping them kept a closed ask on screen while its bot
 * was busy (Astra, 2026-10-10).
 */
export function useCrewJudgements(coordinators: readonly PluginSidebarThread[], needsKey = ""): ReadonlyMap<string, CrewJudgement> {
  const rpc = useRpc<typeof crewRpcContract>();
  const [judgements, setJudgements] = useState<ReadonlyMap<string, CrewJudgement>>(() => new Map());
  const [retry, setRetry] = useState(0);
  const threads = coordinators.map((thread) => ({ threadId: thread.id, version: thread.latestAttentionAt }));
  const key = threads.map((entry) => `${entry.threadId}@${entry.version}`).join("|");
  useEffect(() => {
    const changed = () => setRetry((count) => count + 1);
    window.addEventListener(NEEDS_CHANGED, changed);
    return () => window.removeEventListener(NEEDS_CHANGED, changed);
  }, []);
  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const request = key.split("|").map((entry) => {
      const [threadId, version] = entry.split("@");
      return { threadId: threadId!, version: Number(version) };
    });
    rpc.call("crew_asks", { threads: request }).then((result) => {
      if (cancelled) return;
      setJudgements((previous) => {
        const next = new Map(previous);
        for (const judgement of result.judgements) next.set(judgement.threadId, judgement);
        return next;
      });
      if (result.judgements.some((judgement) => judgement.waiting === null)) {
        timer = setTimeout(() => setRetry((count) => count + 1), RETRY_UNKNOWN_MS);
      }
    }).catch(() => {
      // An older Radar server or a transient failure: "Decision needed:" still works.
    });
    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
    };
    // needsKey: Needs You changes made elsewhere (a bot or ChatGPT closing an ask) re-judge too.
  }, [rpc, key, retry, needsKey]);
  return judgements;
}

export { useNeedsYou } from "@/lib/needsClient";

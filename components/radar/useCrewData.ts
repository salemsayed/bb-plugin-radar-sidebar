import { useEffect, useState } from "react";
import { z } from "zod";
import { useRpc, useSdk, type PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { CrewJudgement, crewRpcContract } from "@/lib/crewAsk";
import { NEEDS_CHANGED } from "@/lib/needsClient";
import { automationsOverviewSchema, type CrewAutomation, type CrewJob } from "./crew";
import { isLiveThread } from "./time";

const AUTOMATIONS_PLUGIN = "saelmbot-automations";
const REFRESH_MS = 60_000;

/** Schedules and last runs from saelmbot-automations; null while unknown or when the plugin is absent. */
export function useCrewAutomations(): CrewAutomation[] | null {
  const sdk = useSdk();
  const [automations, setAutomations] = useState<CrewAutomation[] | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const result = await sdk.plugins.callRpc({ pluginId: AUTOMATIONS_PLUGIN, method: "automations_overview", input: null, outputSchema: automationsOverviewSchema });
        if (!cancelled) setAutomations(result.automations.map((entry) => entry.automation));
      } catch {
        // Keep the last answer through a transient failure; a first failure leaves the rows out.
      }
    };
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    window.addEventListener("focus", load);
    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("focus", load);
    };
  }, [sdk]);
  return automations;
}

const RETRY_UNKNOWN_MS = 5 * 60_000;

/**
 * Whether each settled coordinator's latest reply is waiting on Salem, judged
 * by Jev on the server once per reply (see lib/crewAsk). Asks again whenever a
 * coordinator settles on a new reply, after a Needs You change (Done marks the
 * judgement dismissed), and every few minutes while Jev is unavailable. Live
 * coordinators are not asked about, their reply is still changing, but the
 * judgement of their current reply is kept: a queued message must not hide an
 * unanswered ask.
 */
export function useCrewJudgements(coordinators: readonly PluginSidebarThread[]): ReadonlyMap<string, CrewJudgement> {
  const rpc = useRpc<typeof crewRpcContract>();
  const [judgements, setJudgements] = useState<ReadonlyMap<string, CrewJudgement>>(() => new Map());
  const [retry, setRetry] = useState(0);
  const threads = coordinators
    .filter((thread) => !isLiveThread(thread))
    .map((thread) => ({ threadId: thread.id, version: thread.latestAttentionAt }));
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
  }, [rpc, key, retry]);
  return judgements;
}

const archivedRowsSchema = z.array(z.object({
  id: z.string(),
  title: z.string().nullable().optional(),
  status: z.string(),
  createdAt: z.number(),
}));

/**
 * Archived workers per coordinator, for today's feed. `refreshKey` changes
 * whenever a thread is created or archived, which is when the feed can move.
 */
export function useCrewArchivedJobs(coordinatorIds: readonly string[], refreshKey: string): ReadonlyMap<string, readonly CrewJob[]> {
  const sdk = useSdk();
  const [jobs, setJobs] = useState<ReadonlyMap<string, readonly CrewJob[]>>(() => new Map());
  const ids = coordinatorIds.join("|");
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const next = new Map<string, CrewJob[]>();
      await Promise.all((ids ? ids.split("|") : []).map(async (id) => {
        try {
          const rows = archivedRowsSchema.safeParse(await sdk.threads.list({ archived: true, parentThreadId: id, includeHidden: true, limit: 100 }));
          if (rows.success) next.set(id, rows.data.map((row) => ({ id: row.id, title: row.title || "Untitled job", status: row.status, createdAt: row.createdAt })));
        } catch {
          // One coordinator's history failing leaves the others listed.
        }
      }));
      if (!cancelled) setJobs(next);
    };
    void load();
    const timer = setInterval(() => void load(), 2 * REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [sdk, ids, refreshKey]);
  return jobs;
}

export { useNeedsYou } from "@/lib/needsClient";

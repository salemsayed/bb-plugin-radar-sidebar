import { useEffect, useState } from "react";
import { useSdk } from "@get-bb/plugin-sdk/app";
import { isClosed, taskAttempts, taskDetailSchema, type Attempt, type BotTasksData } from "@/lib/botTasks";

export type WorkerSnapshot = { byTask: Record<string, Attempt[]>; byBot: Record<string, Attempt[]>; known: Set<string>; failedChecks: Set<string>; chat: Set<string> };
export const COORDINATOR_REFRESH_MS = 15_000;
const LIVE = ["running", "active"];
type Sdk = ReturnType<typeof useSdk>;
async function chatting(sdk: Sdk, bots: BotTasksData["bots"]): Promise<Set<string> | null> {
  if (!bots.length) return new Set();
  try {
    const threads = await sdk.threads.list({ threadIds: bots.map(bot => bot.coordinatorThreadId), includeHidden: true });
    const live = new Set(threads.filter(t => LIVE.includes(t.status)).map(t => t.id));
    return new Set(bots.filter(bot => live.has(bot.coordinatorThreadId)).map(bot => bot.key));
  } catch { return null; }
}
const empty = (): WorkerSnapshot => ({ byTask: {}, byBot: {}, known: new Set(), failedChecks: new Set(), chat: new Set() });
let lastSnapshot: WorkerSnapshot | null = null;
export function resetWorkerSnapshotCache() { lastSnapshot = null; }
const same = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every(key => b.has(key));
export function useDispatchWorkers(data: BotTasksData, enabled = true): WorkerSnapshot {
  const sdk = useSdk();
  const [snapshot, setState] = useState<WorkerSnapshot>(() => lastSnapshot ?? empty());
  const setSnapshot = (update: WorkerSnapshot | ((previous: WorkerSnapshot) => WorkerSnapshot)) => setState(previous => {
    const next = typeof update === "function" ? update(previous) : update;
    lastSnapshot = next;
    return next;
  });
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async () => {
      const next = empty();
      const chat = chatting(sdk, data.bots);
      await Promise.all(data.bots.map(async bot => {
        let known = true;
        const workers = new Map<string, Attempt>();
        await Promise.all(bot.tasks.filter(task => !isClosed(task.displayState)).map(async task => {
          try {
            const detail = await sdk.plugins.callRpc({ pluginId: "orchestrator-mode", method: "task_detail", input: { taskId: task.id }, outputSchema: taskDetailSchema });
            if (detail.checks.some(check => check.status === "fail" || check.verdict === "insufficient" || check.verdict === "contradicted")) next.failedChecks.add(task.id);
            const ids = detail.workers.map(worker => worker.threadId);
            const threads = ids.length ? await sdk.threads.list({ threadIds: ids, includeHidden: true }) : [];
            const attempts = taskAttempts({ conversationThreadId: null }, detail, threads.map(t => ({ ...t, status: t.status === "active" ? "running" : t.status })));
            next.byTask[task.id] = attempts;
            attempts.filter(a => a.state === "running" && a.threadId !== bot.coordinatorThreadId).forEach(a => workers.set(a.threadId, a));
          } catch { known = false; }
        }));
        if (bot.unlinked.length) {
          try {
            const threads = await sdk.threads.list({ threadIds: bot.unlinked.map(w => w.threadId), includeHidden: true });
            if (threads.length < bot.unlinked.length) known = false;
            threads.filter(t => LIVE.includes(t.status) && t.id !== bot.coordinatorThreadId).forEach(t => workers.set(t.id, { threadId: t.id, title: t.title ?? "Worker", model: null, effort: null, state: "running", startedAt: t.createdAt, endedAt: null, latest: true }));
          } catch { known = false; }
        }
        next.byBot[bot.key] = [...workers.values()];
        if (known) next.known.add(bot.key);
      }));
      next.chat = await chat ?? new Set();
      if (!cancelled) setSnapshot(next);
    })();
    return () => { cancelled = true; };
  }, [data, sdk, enabled]);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const timer = setInterval(() => void chatting(sdk, data.bots).then(chat => {
      if (cancelled || !chat) return;
      setSnapshot(previous => Object.keys(previous.byBot).length && !same(previous.chat, chat) ? { ...previous, chat } : previous);
    }), COORDINATOR_REFRESH_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [data, sdk, enabled]);
  return snapshot;
}

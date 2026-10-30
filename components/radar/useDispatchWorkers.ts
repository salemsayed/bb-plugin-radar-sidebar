import { useEffect, useState } from "react";
import { useSdk } from "@get-bb/plugin-sdk/app";
import { isClosed, taskAttempts, taskDetailSchema, type Attempt, type BotTasksData } from "@/lib/botTasks";

export type WorkerSnapshot = { byTask: Record<string, Attempt[]>; byBot: Record<string, Attempt[]>; known: Set<string> };
export function useDispatchWorkers(data: BotTasksData): WorkerSnapshot {
  const sdk = useSdk();
  const [snapshot, setSnapshot] = useState<WorkerSnapshot>({ byTask: {}, byBot: {}, known: new Set() });
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next: WorkerSnapshot = { byTask: {}, byBot: {}, known: new Set() };
      await Promise.all(data.bots.map(async bot => {
        let known = true;
        const workers = new Map<string, Attempt>();
        await Promise.all(bot.tasks.filter(task => !isClosed(task.displayState)).map(async task => {
          try {
            const detail = await sdk.plugins.callRpc({ pluginId: "orchestrator-mode", method: "task_detail", input: { taskId: task.id }, outputSchema: taskDetailSchema });
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
            threads.filter(t => ["running", "active"].includes(t.status) && t.id !== bot.coordinatorThreadId).forEach(t => workers.set(t.id, { threadId: t.id, title: t.title ?? "Worker", model: null, effort: null, state: "running", startedAt: t.createdAt, endedAt: null, latest: true }));
          } catch { known = false; }
        }
        next.byBot[bot.key] = [...workers.values()];
        if (known) next.known.add(bot.key);
      }));
      if (!cancelled) setSnapshot(next);
    })();
    return () => { cancelled = true; };
  }, [data, sdk]);
  return snapshot;
}

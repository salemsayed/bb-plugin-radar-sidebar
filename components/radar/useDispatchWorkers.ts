import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { experimental_useSidebarThreads, useSdk } from "@get-bb/plugin-sdk/app";
import { isClosed, taskAttempts, taskDetailSchema, type Attempt, type BotTasksData } from "@/lib/botTasks";
import { isQuestionRow } from "./questions";

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
const MIN_TITLE = 8;
const LIVE_STATUS = new Set(["running", "active", "starting"]);

export interface NamedThread { id: string; title: string | null; status: string; parentThreadId: string | null; lifecycleOwnerThreadId: string | null; createdAt?: number }

export function withNamedWorkers(snapshot: WorkerSnapshot, bots: BotTasksData["bots"], threads: Iterable<NamedThread>): WorkerSnapshot {
  const linked = new Set(Object.values(snapshot.byTask).flat().map(attempt => attempt.threadId));
  let next: WorkerSnapshot | null = null;
  const live = [...threads].filter(thread => LIVE_STATUS.has(thread.status) && !linked.has(thread.id));
  for (const bot of bots) {
    const open = bot.tasks.filter(task => !isClosed(task.displayState) && !isQuestionRow(task) && task.title.trim().length >= MIN_TITLE);
    for (const thread of live) {
      if (thread.id === bot.coordinatorThreadId || bot.desks.some(desk => desk.threadId === thread.id)) continue;
      if (thread.lifecycleOwnerThreadId !== bot.coordinatorThreadId && thread.parentThreadId !== bot.coordinatorThreadId) continue;
      const title = (thread.title ?? "").trim().toLowerCase();
      const task = open.filter(task => title.startsWith(task.title.trim().toLowerCase())).sort((a, b) => b.title.length - a.title.length)[0];
      if (!task) continue;
      next ??= { ...snapshot, byTask: { ...snapshot.byTask }, byBot: { ...snapshot.byBot } };
      const attempt: Attempt = { threadId: thread.id, title: thread.title ?? "Worker", model: null, effort: null, state: "running", startedAt: thread.createdAt ?? null, endedAt: null, latest: true };
      next.byTask[task.id] = [...(next.byTask[task.id] ?? []), attempt];
      if (!(next.byBot[bot.key] ?? []).some(worker => worker.threadId === thread.id)) next.byBot[bot.key] = [...(next.byBot[bot.key] ?? []), attempt];
      linked.add(thread.id);
    }
  }
  return next ?? snapshot;
}

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
        await Promise.all(bot.tasks.filter(task => !isClosed(task.displayState) && !isQuestionRow(task)).map(async task => {
          try {
            const detail = await sdk.plugins.callRpc({ pluginId: "orchestrator-mode", method: "task_detail", input: { taskId: task.id }, outputSchema: taskDetailSchema });
            if (detail.checks.some(check => check.status === "fail" || check.verdict === "insufficient" || check.verdict === "contradicted")) next.failedChecks.add(task.id);
            const ids = detail.workers.map(worker => worker.threadId);
            const threads = ids.length ? await sdk.threads.list({ threadIds: ids, includeHidden: true }) : [];
            const attempts = taskAttempts({ conversationThreadId: null }, detail, threads.map(t => ({ ...t, status: t.status === "active" ? "running" : t.status })));
            next.byTask[task.id] = attempts;
            attempts.filter(a => a.state === "running" && a.threadId !== bot.coordinatorThreadId && !bot.desks.some(desk => desk.threadId === a.threadId)).forEach(a => workers.set(a.threadId, a));
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

let shared: WorkerSnapshot = empty();
const sharedListeners = new Set<() => void>();
function publish(snapshot: WorkerSnapshot, bots: BotTasksData["bots"]) {
  const keys = new Set(bots.map(bot => bot.key));
  const taskIds = new Set(bots.flatMap(bot => bot.tasks.map(task => task.id)));
  const keep = <T,>(record: Record<string, T>, drop: (key: string) => boolean) => Object.fromEntries(Object.entries(record).filter(([key]) => !drop(key)));
  const next: WorkerSnapshot = {
    byTask: { ...keep(shared.byTask, key => taskIds.has(key)), ...snapshot.byTask },
    byBot: { ...keep(shared.byBot, key => keys.has(key)), ...keep(snapshot.byBot, key => !keys.has(key)) },
    known: new Set([...[...shared.known].filter(key => !keys.has(key)), ...[...snapshot.known].filter(key => keys.has(key))]),
    failedChecks: new Set([...[...shared.failedChecks].filter(id => !taskIds.has(id)), ...snapshot.failedChecks]),
    chat: new Set([...[...shared.chat].filter(key => !keys.has(key)), ...[...snapshot.chat].filter(key => keys.has(key))]),
  };
  const sameRows = (a: Attempt[] | undefined, b: Attempt[] | undefined) => (a ?? []).map(x => `${x.threadId}:${x.state}:${x.title}`).join() === (b ?? []).map(x => `${x.threadId}:${x.state}:${x.title}`).join();
  const unchanged = [...keys].every(key => sameRows(shared.byBot[key], next.byBot[key]) && shared.known.has(key) === next.known.has(key) && shared.chat.has(key) === next.chat.has(key))
    && same(shared.failedChecks, next.failedChecks) && Object.keys(next.byTask).length === Object.keys(shared.byTask).length && Object.entries(next.byTask).every(([id, rows]) => sameRows(shared.byTask[id], rows));
  if (unchanged) return;
  shared = next;
  for (const listener of sharedListeners) listener();
}
const subscribeShared = (listener: () => void) => { sharedListeners.add(listener); return () => { sharedListeners.delete(listener); }; };
const readShared = () => shared;
export function resetSharedWorkers() { shared = empty(); }

export function useBotWorkers(data: BotTasksData, enabled = true): WorkerSnapshot {
  const linked = useDispatchWorkers(data, enabled);
  const { threads } = experimental_useSidebarThreads();
  const named = useMemo(() => withNamedWorkers(linked, data.bots, threads.map(thread => ({ id: thread.id, title: thread.title, status: thread.status, parentThreadId: thread.parentThreadId, lifecycleOwnerThreadId: thread.lifecycleOwnerThreadId, createdAt: (thread as { createdAt?: number }).createdAt }))), [linked, data.bots, threads]);
  useEffect(() => { if (Object.keys(linked.byBot).length) publish(named, data.bots.filter(bot => bot.key in linked.byBot)); }, [named, linked, data.bots]);
  const current = useSyncExternalStore(subscribeShared, readShared, readShared);
  return [...named.known].every(key => current.known.has(key)) ? current : named;
}

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { experimental_useSidebarThreads, useSdk } from "@get-bb/plugin-sdk/app";
import { z } from "zod";
import { isClosed, taskAttempts, taskDetailSchema, type Attempt, type BotTasksData, type TaskDetail } from "@/lib/botTasks";
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

const THREAD_LIST_MAX_IDS = 200;
async function listThreads(sdk: Sdk, ids: readonly string[]) {
  const rows: Awaited<ReturnType<Sdk["threads"]["list"]>> = [];
  for (let at = 0; at < ids.length; at += THREAD_LIST_MAX_IDS) rows.push(...await sdk.threads.list({ threadIds: ids.slice(at, at + THREAD_LIST_MAX_IDS), includeHidden: true }));
  return rows;
}

const taskDetailsSchema = z.object({ details: z.array(taskDetailSchema.nullable()) });
async function taskDetails(sdk: Sdk, taskIds: readonly string[]): Promise<(TaskDetail | null)[]> {
  if (!taskIds.length) return [];
  try {
    const out: (TaskDetail | null)[] = [];
    for (let at = 0; at < taskIds.length; at += 200) {
      const page = await sdk.plugins.callRpc({ pluginId: "orchestrator-mode", method: "task_details", input: { taskIds: taskIds.slice(at, at + 200) }, outputSchema: taskDetailsSchema });
      if (page.details.length !== Math.min(200, taskIds.length - at)) throw new Error("task_details answered a different number of tasks");
      out.push(...page.details);
    }
    return out;
  } catch {
    return Promise.all(taskIds.map(taskId => sdk.plugins.callRpc({ pluginId: "orchestrator-mode", method: "task_detail", input: { taskId }, outputSchema: taskDetailSchema }).catch(() => null)));
  }
}

export async function scanWorkers(sdk: Sdk, bots: BotTasksData["bots"]): Promise<WorkerSnapshot> {
  const next = empty();
  const chat = chatting(sdk, bots);
  const open = bots.map(bot => bot.tasks.filter(task => !isClosed(task.displayState) && !isQuestionRow(task)));
  const flat = await taskDetails(sdk, open.flat().map(task => task.id));
  let cursor = 0;
  const details = open.map(tasks => tasks.map(() => flat[cursor++] ?? null));
  const ids = [...new Set([...details.flat().flatMap(detail => detail?.workers.map(worker => worker.threadId) ?? []), ...bots.flatMap(bot => bot.unlinked.map(w => w.threadId))])];
  let rows: Awaited<ReturnType<typeof listThreads>> | null = [];
  try { if (ids.length) rows = await listThreads(sdk, ids); } catch { rows = null; }
  const pick = (wanted: readonly string[]) => { const set = new Set(wanted); return (rows ?? []).filter(t => set.has(t.id)); };
  bots.forEach((bot, b) => {
    let known = true;
    const workers = new Map<string, Attempt>();
    open[b]!.forEach((task, i) => {
      const detail = details[b]![i];
      if (!detail) { known = false; return; }
      if (detail.checks.some(check => check.status === "fail" || check.verdict === "insufficient" || check.verdict === "contradicted")) next.failedChecks.add(task.id);
      const workerIds = detail.workers.map(worker => worker.threadId);
      if (workerIds.length && rows === null) { known = false; return; }
      const threads = workerIds.length ? pick(workerIds) : [];
      const attempts = taskAttempts({ conversationThreadId: null }, detail, threads.map(t => ({ ...t, status: t.status === "active" ? "running" : t.status })));
      next.byTask[task.id] = attempts;
      attempts.filter(a => a.state === "running" && a.threadId !== bot.coordinatorThreadId && !bot.desks.some(desk => desk.threadId === a.threadId)).forEach(a => workers.set(a.threadId, a));
    });
    if (bot.unlinked.length) {
      if (rows === null) known = false;
      else {
        const threads = pick(bot.unlinked.map(w => w.threadId));
        if (threads.length < bot.unlinked.length) known = false;
        threads.filter(t => LIVE.includes(t.status) && t.id !== bot.coordinatorThreadId).forEach(t => workers.set(t.id, { threadId: t.id, title: t.title ?? "Worker", model: null, effort: null, state: "running", startedAt: t.createdAt, endedAt: null, latest: true }));
      }
    }
    next.byBot[bot.key] = [...workers.values()];
    if (known) next.known.add(bot.key);
  });
  next.chat = await chat ?? new Set();
  return next;
}

export function workerScanKey(data: BotTasksData, threads: readonly { id: string; status: string; parentThreadId: string | null; lifecycleOwnerThreadId: string | null }[], watched: ReadonlySet<string>, tick: number): string {
  const coordinators = new Set(data.bots.map(bot => bot.coordinatorThreadId));
  const live = threads.filter(t => coordinators.has(t.id) || watched.has(t.id) || coordinators.has(t.parentThreadId ?? "") || coordinators.has(t.lifecycleOwnerThreadId ?? ""))
    .map(t => `${t.id}:${t.status}`).sort();
  return JSON.stringify([tick, data.observedAt, data.bots, live]);
}

export function useDispatchWorkers(data: BotTasksData, enabled = true): WorkerSnapshot {
  const sdk = useSdk();
  const { threads } = experimental_useSidebarThreads();
  const [snapshot, setState] = useState<WorkerSnapshot>(() => lastSnapshot ?? empty());
  const [tick, setTick] = useState(0);
  const setSnapshot = (update: WorkerSnapshot | ((previous: WorkerSnapshot) => WorkerSnapshot)) => setState(previous => {
    const next = typeof update === "function" ? update(previous) : update;
    lastSnapshot = next;
    return next;
  });
  const latest = useRef(data);
  latest.current = data;
  const watched = useMemo(() => new Set(Object.values(snapshot.byTask).flat().map(attempt => attempt.threadId)), [snapshot]);
  const key = useMemo(() => workerScanKey(data, threads, watched, tick), [data, threads, watched, tick]);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void scanWorkers(sdk, latest.current.bots).then(next => { if (!cancelled) setSnapshot(next); });
    return () => { cancelled = true; };
  }, [key, sdk, enabled]);
  useEffect(() => {
    if (!enabled) return;
    const timer = setInterval(() => setTick(value => value + 1), COORDINATOR_REFRESH_MS);
    return () => clearInterval(timer);
  }, [enabled]);
  return snapshot;
}

const SEED_KEY = "radar.workers.seed.v1";
const SEED_FRESH_MS = 3 * 60_000;
function seeded(): WorkerSnapshot {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(SEED_KEY);
    if (!raw) return empty();
    const saved = JSON.parse(raw) as { at: number; byTask?: Record<string, Attempt[]>; byBot: Record<string, Attempt[]>; known: string[]; chat: string[] };
    if (!saved || typeof saved.at !== "number" || Date.now() - saved.at > SEED_FRESH_MS || typeof saved.byBot !== "object") return empty();
    return { byTask: saved.byTask && typeof saved.byTask === "object" ? saved.byTask : {}, byBot: saved.byBot, known: new Set(saved.known), failedChecks: new Set(), chat: new Set(saved.chat) };
  } catch { return empty(); }
}
function save(snapshot: WorkerSnapshot) {
  try { localStorage.setItem(SEED_KEY, JSON.stringify({ at: Date.now(), byTask: snapshot.byTask, byBot: snapshot.byBot, known: [...snapshot.known], chat: [...snapshot.chat] })); } catch {}
}
let shared: WorkerSnapshot = seeded();
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
  if (unchanged) { save(shared); return; }
  shared = next;
  save(next);
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

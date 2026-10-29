import { useEffect, useRef, useState } from "react";
import { useSdk } from "@get-bb/plugin-sdk/app";
import { taskAttempts, taskDetailSchema, type Attempt, type AttemptThread, type BotTaskRow, type TaskDetail } from "@/lib/botTasks";
import { isPluginAbsentError } from "./useBotRoster";

const TASKS_PLUGIN = "orchestrator-mode";

export type AttemptsStatus =
  | "loading"
  | "ready"
  /** This core has no `task_detail` (older release): only the task's conversation is known. */
  | "missing"
  | "error";

export interface AttemptsState { status: AttemptsStatus; attempts: Attempt[] }

// Last answers survive the panel closing, so reopening a task's details paints at once.
const remembered = new Map<string, { detail: TaskDetail | null; threads: AttemptThread[] }>();
/** Tests and the harness start from nothing remembered. */
export function resetTaskAttempts(): void { remembered.clear(); }

/**
 * A task's attempts: its workers from the core's `task_detail`, then each
 * worker thread's start, last activity and status from `threads.list`. A
 * core that lacks the method, or a failed read, still yields the task's
 * conversation as the one attempt the row would open. `refreshKey` (the
 * Bots data's observedAt, new on every bots push or poll) reads both again
 * while the details stay open, so a worker started meanwhile appears.
 */
export function useTaskAttempts(task: BotTaskRow | null, refreshKey?: number): AttemptsState {
  const sdk = useSdk();
  const taskId = task?.id ?? null;
  const conversation = task?.conversationThreadId ?? null;
  const [state, setState] = useState<AttemptsState>(() => initial(task));
  const shown = useRef<string | null>(null);
  useEffect(() => {
    if (!taskId) return;
    const row = { conversationThreadId: conversation };
    // A refresh of the same task keeps what is shown until the new answer lands.
    const subject = `${taskId}\u0000${conversation ?? ""}`;
    if (shown.current !== subject) {
      shown.current = subject;
      const known = remembered.get(taskId);
      setState({ status: known ? "ready" : "loading", attempts: taskAttempts(row, known?.detail ?? null, known?.threads ?? []) });
    }
    let cancelled = false;
    (async () => {
      let detail: TaskDetail | null = null;
      let status: AttemptsStatus = "ready";
      try {
        detail = await sdk.plugins.callRpc({ pluginId: TASKS_PLUGIN, method: "task_detail", input: { taskId }, outputSchema: taskDetailSchema });
      } catch (error) {
        status = isPluginAbsentError(error) ? "missing" : "error";
      }
      const ids = [...new Set([...(detail?.workers ?? []).map(worker => worker.threadId), ...(conversation ? [conversation] : [])])].slice(0, 200);
      let threads: AttemptThread[] = [];
      try {
        if (ids.length) threads = (await sdk.threads.list({ threadIds: ids, includeHidden: true })).map(thread => ({ id: thread.id, title: thread.title, status: thread.status, createdAt: thread.createdAt, updatedAt: thread.updatedAt }));
      } catch {
        // The core's list still shows, without times.
      }
      if (cancelled) return;
      // A failed refresh keeps the last good list rather than dropping to the latest attempt alone.
      if (status === "error" && remembered.has(taskId)) return;
      if (status === "ready") remembered.set(taskId, { detail, threads });
      setState({ status, attempts: taskAttempts(row, detail, threads) });
    })();
    return () => { cancelled = true; };
  }, [sdk, taskId, conversation, refreshKey]);
  return taskId ? state : { status: "ready", attempts: [] };
}

function initial(task: BotTaskRow | null): AttemptsState {
  if (!task) return { status: "ready", attempts: [] };
  const known = remembered.get(task.id);
  return { status: known ? "ready" : "loading", attempts: taskAttempts(task, known?.detail ?? null, known?.threads ?? []) };
}

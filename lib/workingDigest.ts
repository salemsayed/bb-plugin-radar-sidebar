/**
 * What a running thread is up to, boiled down from its latest timeline
 * segment on the server: a full segment runs to ~90 KB, the digest to a few
 * hundred bytes, so the Working peek stays cheap on a phone over a remote
 * link. Everything here is derived from the timeline; nothing asks a model.
 */

import { z } from "zod";

export const PHASES = ["thinking", "exploring", "editing", "testing", "building", "shipping", "researching", "delegating", "running"] as const;
export type Phase = (typeof PHASES)[number];

export const workingDigestSchema = z.object({
  threadId: z.string(),
  /** When the current run's request arrived. */
  runningSince: z.number().nullable(),
  /** The newest row, thought or background update. */
  lastActivityAt: z.number().nullable(),
  /** The agent's latest words to the user, flattened to one line. */
  saying: z.string().nullable(),
  /** The newest step, still pending or just done. */
  doing: z.object({ label: z.string(), detail: z.string().nullable(), pending: z.boolean(), at: z.number() }).nullable(),
  phase: z.enum(PHASES).nullable(),
  /** Tool calls, commands and edits in this run. */
  steps: z.number(),
  /** Commands failing back to back at the end of the run. */
  failingStreak: z.number(),
  todos: z.object({ done: z.number(), total: z.number(), current: z.string().nullable() }).nullable(),
  goal: z.string().nullable(),
  /** Share of the context window in use, 0..1. */
  context: z.number().nullable(),
  /** Background commands and workflows still running. */
  background: z.number(),
  /** The model it fell back to, when the requested one refused or failed. */
  fallback: z.string().nullable(),
});
export type WorkingDigest = z.infer<typeof workingDigestSchema>;

export const workingRpcContract = {
  working_digest: {
    input: z.object({ threadIds: z.array(z.string().min(1).max(64)).max(12) }).strict(),
    output: z.object({ digests: z.array(workingDigestSchema) }),
  },
} as const;

/** The timeline fields the digest reads; everything is optional on purpose. */
export interface TimelineRowLike {
  kind?: string;
  role?: string | null;
  text?: string | null;
  workKind?: string;
  status?: string | null;
  startedAt?: number;
  createdAt?: number;
  completedAt?: number | null;
  exitCode?: number | null;
  command?: string | null;
  path?: string | null;
  queries?: readonly string[] | null;
  change?: { path?: string | null } | null;
  presentation?: { title?: string; detail?: string; label?: { pending?: string; completed?: string } } | null;
  children?: readonly TimelineRowLike[] | null;
}
interface TaskLike { status?: string; taskStatus?: string; updatedAt?: number; createdAt?: number }
export interface TimelineLike {
  rows?: readonly TimelineRowLike[];
  activeThinking?: { text?: string; updatedAt?: number } | null;
  activeBackgroundCommands?: readonly TaskLike[];
  activeWorkflows?: readonly TaskLike[];
  pendingTodos?: { items?: readonly { status?: string; text?: string }[] } | null;
  goal?: { objective?: string; status?: string } | null;
  modelFallback?: { fallbackModel?: string } | null;
  contextWindowUsage?: {
    usedTokens?: number;
    modelContextWindow?: number;
    snapshot?: { usedTokens?: number; contextWindowTokens?: number } | null;
  } | null;
}

const LABELS: Record<string, [pending: string, completed: string]> = {
  command: ["Running", "Ran"],
  fileChange: ["Editing", "Edited"],
  fileRead: ["Reading", "Read"],
  search: ["Searching", "Searched"],
  webSearch: ["Searching the web", "Searched the web"],
  webFetch: ["Fetching", "Fetched"],
  delegation: ["Delegating", "Delegated"],
  workflow: ["Running a workflow", "Ran a workflow"],
  tool: ["Using a tool", "Used a tool"],
};

function flatten(rows: readonly TimelineRowLike[]): TimelineRowLike[] {
  return rows.flatMap((row) => (row.children?.length ? [row, ...flatten(row.children)] : [row]));
}

/** One line of plain text: no markdown marks, links reduced to their words. */
export function oneLine(text: string, max = 180): string {
  const plain = text
    .replace(/```[\s\S]*?```/g, " ")
    // BB chat directives such as ::browser-preview{session="…"} are not words.
    .replace(/^\s*::[a-z][\w-]*\{[^}\n]*\}\s*$/gim, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`#>|]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > max ? `${plain.slice(0, max - 1).trimEnd()}…` : plain;
}

function phaseOf(row: TimelineRowLike): Phase | null {
  switch (row.workKind) {
    case "fileChange": return "editing";
    case "fileRead":
    case "search": return "exploring";
    case "webSearch":
    case "webFetch": return "researching";
    case "delegation":
    case "workflow": return "delegating";
    case "command": {
      const command = row.command ?? row.presentation?.title ?? "";
      if (/\b(vitest|jest|pytest|playwright|cargo test|go test|(npm|pnpm|yarn|bun)( run)? test|tsc|typecheck|eslint|lint)\b/.test(command)) return "testing";
      if (/\bgit (commit|push|merge|rebase|tag)\b|\bgh (pr|release)\b|\bglab mr\b/.test(command)) return "shipping";
      if (/\b(build|bundle|compile)\b/.test(command)) return "building";
      if (/^\s*(cat|sed|head|tail|less|grep|rg|find|ls|tree|wc|git (log|diff|show|status))\b/.test(command)) return "exploring";
      return "running";
    }
    default: return null;
  }
}

function isRunning(task: TaskLike): boolean {
  return task.taskStatus === "running" || task.taskStatus === "pending" || task.status === "pending";
}

export function digestTimeline(threadId: string, timeline: TimelineLike): WorkingDigest {
  const rows = flatten(timeline.rows ?? []);
  const at = (row: TimelineRowLike) => row.startedAt ?? row.createdAt ?? 0;
  const work = rows.filter((row) => row.kind === "work");
  const request = [...rows].reverse().find((row) => row.kind === "conversation" && row.role === "user");
  const said = [...rows].reverse().find((row) => row.kind === "conversation" && row.role === "assistant" && row.text?.trim());
  const last = work.at(-1);

  let failingStreak = 0;
  for (const row of [...work].reverse()) {
    if (row.workKind !== "command" || row.status === "pending") continue;
    if (row.status === "error" || (row.exitCode != null && row.exitCode !== 0)) failingStreak += 1;
    else break;
  }

  const thinking = timeline.activeThinking;
  const lastRowAt = rows.reduce((latest, row) => Math.max(latest, row.completedAt ?? 0, at(row)), 0);
  const tasks = [...(timeline.activeBackgroundCommands ?? []), ...(timeline.activeWorkflows ?? [])];
  const taskAt = tasks.reduce((latest, task) => Math.max(latest, task.updatedAt ?? task.createdAt ?? 0), 0);
  const lastActivityAt = Math.max(lastRowAt, thinking?.updatedAt ?? 0, taskAt) || null;

  const thinkingNow = !!thinking && (thinking.updatedAt ?? 0) >= lastRowAt;
  const phase = thinkingNow ? "thinking" : (() => {
    for (const row of [...work].reverse().slice(0, 4)) {
      const found = phaseOf(row);
      if (found) return found;
    }
    return null;
  })();

  const doing = last ? (() => {
    const pending = last.status === "pending";
    const [pendingWord, doneWord] = LABELS[last.workKind ?? ""] ?? ["Working", "Worked"];
    const label = (pending ? last.presentation?.label?.pending : last.presentation?.label?.completed) ?? (pending ? pendingWord : doneWord);
    const raw = last.presentation?.title ?? last.command ?? last.change?.path ?? last.path ?? last.queries?.[0] ?? null;
    const detail = raw ? oneLine(raw.split("\n")[0] ?? raw, 90) : null;
    return { label, detail: detail || null, pending, at: at(last) };
  })() : null;

  const items = timeline.pendingTodos?.items ?? [];
  const todos = items.length > 0 ? {
    done: items.filter((item) => item.status === "completed").length,
    total: items.length,
    current: (items.find((item) => item.status === "in_progress") ?? items.find((item) => item.status === "pending"))?.text ?? null,
  } : null;

  const usage = timeline.contextWindowUsage;
  const used = usage?.snapshot?.usedTokens ?? usage?.usedTokens;
  const window = usage?.snapshot?.contextWindowTokens ?? usage?.modelContextWindow;
  const goal = timeline.goal && timeline.goal.status !== "complete" ? timeline.goal.objective ?? null : null;

  return {
    threadId,
    runningSince: request ? at(request) : rows.length > 0 ? Math.min(...rows.map(at).filter(Boolean)) || null : null,
    lastActivityAt,
    saying: said?.text ? oneLine(said.text) || null : null,
    doing,
    phase,
    steps: work.length,
    failingStreak,
    todos: todos ? { ...todos, current: todos.current ? oneLine(todos.current, 90) : null } : null,
    goal: goal ? oneLine(goal, 120) : null,
    context: typeof used === "number" && window ? Math.min(1, used / window) : null,
    background: tasks.filter(isRunning).length,
    fallback: timeline.modelFallback?.fallbackModel ?? null,
  };
}

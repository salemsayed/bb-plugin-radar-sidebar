// Copied verbatim from bots/core tasks-v2-types.ts (tasks v2 CONTRACT.md, Shared types). Do not edit here.
export type DisplayState = "needs" | "working" | "queued" | "offline" | "retrying" | "waiting" | "overdue" | "checking" | "ready" | "stopped" | "done" | "cancelled";
export type MessageKind = "decision" | "question" | "info" | "steer" | "new-task" | "chat";
export interface TaskRow {
  id: string; bot: string; title: string; displayState: DisplayState; line: string;
  waitFor?: string; ageMs: number; completedAt?: number; conversationThreadId: string | null;
  needs?: { threadId: string; interactionId: string; question: string; options?: string[] };
  tags: string[]; origin: "verified" | "unverified" | "imported"; observedAt: number;
}
export interface BotTasks {
  key: string; name: string; order: number; color?: string; faceUrl?: string; coordinatorThreadId: string;
  tasksV2: boolean; summary: { needs: number; working: number; queued: number; offline: number; waiting: number; done: number };
  tasks: TaskRow[]; unlinked: { threadId: string; title: string }[];
}
export interface BotTasksOutput { bots: BotTasks[]; needs: { bot: string; taskId: string; threadId: string; interactionId: string; question: string }[]; notFiled: { threadId: string; title: string; suggestedBot?: string }[]; observedAt: number }
export interface RouteSuggestion { parts: { bot: string; kind: MessageKind; taskId?: string; outcome: string; confidence: "high" | "medium" | "low"; reason: string }[]; ask: boolean }
export interface IntakeSubmitInput { clientSubmissionId: string; text: string; parts: { bot: string; kind: MessageKind; taskId?: string; outcome: string }[]; threadId?: string }
export interface IntakeSubmitOutput { submissionId: string; parts: { partId: string; bot: string; kind: MessageKind; taskId?: string; deliveredTo?: { threadId: string } }[] }
export interface LaunchIntentInput { taskId: string; bot: string; target: { projectId?: string; environment: "reuse" | "worktree"; machine?: string } }
export interface LaunchIntentOutput { intentId: string }
export interface LaunchResultInput { intentId: string; threadId?: string; deferred?: { reason: string; retryAfterMs?: number }; failed?: string }
export type TaskActionInput = { taskId: string; action: "done" | "stop" | "reopen" } | { taskId: string; action: "move"; toBot: string };

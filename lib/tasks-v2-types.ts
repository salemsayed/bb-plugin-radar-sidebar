export type DisplayState = "needs" | "working" | "queued" | "offline" | "retrying" | "waiting" | "overdue" | "checking" | "ready" | "stopped" | "done" | "cancelled";
export type MessageKind = "decision" | "question" | "info" | "steer" | "new-task" | "chat";
export interface TaskRow {
  ask?: { excerpt: string; label: string; ref: { threadId: string; seq: number }; at?: number }; outcome?: string;
  id: string; bot: string; title: string; displayState: DisplayState; line: string;
  waitFor?: string; ageMs: number; completedAt?: number; conversationThreadId: string | null;
  /** Timestamps behind the line's times (a wake, a queued start's retry), for clients that format them locally. */
  wakeAt?: number; retryAt?: number;
  needs?: { questionId?: string; threadId: string; interactionId: string; question: string; options?: string[]; askedAt?: number; messageSeq?: number };
  tags: string[]; origin: "verified" | "unverified" | "imported"; observedAt: number;
}
export interface BotTasks {
  key: string; name: string; order: number; color?: string; faceUrl?: string; coordinatorThreadId: string;
  /** notStarted: filed, not started and not queued (a "ready" task). */
  tasksV2: boolean; summary: { needs: number; working: number; queued: number; offline: number; waiting: number; done: number; notStarted: number };
  tasks: TaskRow[]; unlinked: { threadId: string; title: string }[];
}
export type QuestionSource = "form" | "thread" | "ask" | "card" | "decision" | "need" | "desk";
export interface QuestionView { id: string; bot: string | null; source: QuestionSource; state: "open" | "later"; threadId: string; askedAt: number; question: string; taskId?: string; deskId?: string; needId?: string; interactionId?: string; messageSeq?: number; laterAt?: number; options?: string[]; recommend?: string }
export interface BotTasksOutput { bots: BotTasks[]; questions: QuestionView[]; notFiled: { threadId: string; title: string; suggestedBot?: string }[]; observedAt: number }
/** refused: the bot this part is for has tasks v2 off; it is never sent from Tell the bots (send it in that bot's chat). */
export interface RouteSuggestion { parts: { bot: string; kind: MessageKind; taskId?: string; outcome: string; confidence: "high" | "medium" | "low"; reason: string; refused?: string }[]; ask: boolean }
export interface IntakeSubmitInput { clientSubmissionId: string; text: string; input?: unknown[] /* bb PromptInput[] from the composer: attachments and mentions, delivered intact */; parts: { bot: string; kind: MessageKind; taskId?: string; outcome: string }[]; threadId?: string }
/** Per part: delivered, still sending (resumed by a retry), failed, or refused (its bot has tasks v2 off; nothing sent). */
export interface IntakeSubmitOutput { submissionId: string; parts: { partId: string; bot: string; kind: MessageKind; taskId?: string; deliveredTo?: { threadId: string }; status: "pending" | "sending" | "delivered" | "failed" | "refused"; error?: string }[] }
export interface LaunchIntentInput { taskId: string; bot: string; target: { projectId?: string; environment: "reuse" | "worktree"; machine?: string }; launchKey?: string /* "<taskId>:g<generation>:<purpose>" */ }
export interface LaunchIntentOutput { intentId: string }
export interface LaunchResultInput { intentId: string; launchKey?: string; threadId?: string; deferred?: { reason: string; retryAfterMs?: number }; failed?: string; uncertain?: string }
export type TaskActionInput = { taskId: string; action: "done" | "stop" | "reopen" } | { taskId: string; action: "move"; toBot: string };

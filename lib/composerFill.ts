import type { ComposerDraftReplacement } from "@get-bb/plugin-sdk/app";
import { currentAskStrip, type AskStripEntry } from "./askStrip";
const KEEP_MS = 15_000;

export type FillRequest = { threadId: string; text: string; at: number; swap: readonly string[]; send: boolean; draft: ComposerDraftReplacement; key?: string };
export type FillOutcome = { key: string; text: string; result: "sending" | "sent" | "draft" | "failed"; at: number };

let pending: FillRequest | null = null;
let outcomes: ReadonlyMap<string, FillOutcome> = new Map();
const listeners = new Set<() => void>();

function changed() {
  for (const listener of listeners) listener();
}

export function requestFill(threadId: string, text: string, swap: readonly string[] = [], send = false, key?: string): void {
  pending = { threadId, text, draft: answerDraft(text, threadId), at: Date.now(), swap, send, ...(key ? { key } : {}) };
  if (key && send) outcomes = new Map(outcomes).set(key, { key, text, result: "sending", at: Date.now() });
  changed();
}

export function pendingFill(): FillRequest | null {
  if (pending && Date.now() - pending.at > KEEP_MS) pending = null;
  return pending;
}

export function clearFill(request: FillRequest): void {
  if (pending === request) pending = null;
  changed();
}

export function reportFill(request: FillRequest, result: FillOutcome["result"]): void {
  if (!request.key) return;
  outcomes = new Map(outcomes).set(request.key, { key: request.key, text: request.text, result, at: Date.now() });
  changed();
}

export function forgetFill(key: string): void {
  if (!outcomes.has(key)) return;
  const next = new Map(outcomes);
  next.delete(key);
  outcomes = next;
  changed();
}

export function fillOutcomes(): ReadonlyMap<string, FillOutcome> {
  return outcomes;
}

export function subscribeFill(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

const CHIP_LABEL = 60;

export function answerBinding(key: string): { provider: "task" | "question"; id: string } | null {
  const id = /^ask:(.+)$/.exec(key)?.[1];
  if (!id) return null;
  if (id.startsWith("ptask_")) return { provider: "task", id };
  if (id.startsWith("need_")) return { provider: "question", id };
  return null;
}

export function answerDraft(text: string, threadId: string, ask: AskStripEntry | null = currentAskStrip()): ComposerDraftReplacement {
  const bound = ask?.threadId === threadId ? answerBinding(ask.key) : null;
  if (!bound || !ask) return { text, mentions: [] };
  const named = (ask.title || (bound.provider === "task" ? "Task" : "Question")).trim();
  const label = named.length > CHIP_LABEL ? `${named.slice(0, CHIP_LABEL - 1).trimEnd()}\u2026` : named;
  const prefix = `@${label}`;
  return { text: `${prefix} ${text}`, mentions: [{ from: 0, to: prefix.length, label, kind: "plugin", pluginId: "orchestrator-mode", provider: bound.provider, id: bound.id }] };
}

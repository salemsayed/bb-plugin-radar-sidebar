import { useSyncExternalStore } from "react";
import { useSdk } from "@get-bb/plugin-sdk/app";
import { z } from "zod";
import { needsChanged } from "./needsClient";
import type { BotTasksData } from "./botTasks";

export const NOT_NOW_PLUGIN = "orchestrator-mode";
const resultSchema = z.object({ id: z.string(), state: z.enum(["open", "later", "closed"]), at: z.number().nullable() });
const UNDO_MS = 8_000;
const SETTLE_MS = 20_000;

export type NotNowToast = { key: string; label: string; expiresAt: number; busy: boolean; error: string | null };
type Store = { local: ReadonlyMap<string, { on: boolean; at: number }>; toast: NotNowToast | null };

let state: Store = { local: new Map(), toast: null };
const listeners = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | undefined;
let sdk: ReturnType<typeof useSdk> | null = null;

function set(next: Partial<Store>) {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
const read = () => state;

function scheduleToastEnd(toast: NotNowToast | null) {
  clearTimeout(timer);
  if (!toast) return;
  timer = setTimeout(() => { if (state.toast?.key === toast.key && !state.toast.busy) set({ toast: null }); }, Math.max(0, toast.expiresAt - Date.now()));
}

async function call(id: string, on: boolean) {
  if (!sdk) throw new Error("Not now is unavailable here");
  return sdk.plugins.callRpc({ pluginId: NOT_NOW_PLUGIN, method: "needs_not_now", input: { id, on }, outputSchema: resultSchema });
}

function withLocal(id: string, value: { on: boolean; at: number } | null) {
  const local = new Map(state.local);
  if (value) local.set(id, value); else local.delete(id);
  return local;
}

export async function notNow(id: string, label: string) {
  const at = Date.now();
  const toast: NotNowToast = { key: id, label, expiresAt: at + UNDO_MS, busy: false, error: null };
  set({ local: withLocal(id, { on: true, at }), toast });
  scheduleToastEnd(toast);
  try {
    await call(id, true);
    needsChanged();
  } catch {
    const failed = { ...toast, error: "Couldn't move it to Later. Try again in a moment.", expiresAt: Date.now() + UNDO_MS };
    set({ local: withLocal(id, null), toast: failed });
    scheduleToastEnd(failed);
  }
}

export async function bringBack(id: string, label?: string) {
  const current = state.toast?.key === id ? state.toast : null;
  if (current) set({ toast: { ...current, busy: true, error: null } });
  set({ local: withLocal(id, { on: false, at: Date.now() }) });
  try {
    await call(id, false);
    if (state.toast?.key === id) set({ toast: null });
    needsChanged();
  } catch {
    const failed: NotNowToast = { key: id, label: label ?? current?.label ?? "this", expiresAt: Date.now() + UNDO_MS, busy: false, error: "Couldn't bring it back. Try Bring back in the bot's panel." };
    set({ local: withLocal(id, { on: true, at: Date.now() }), toast: failed });
    scheduleToastEnd(failed);
  }
}

export function dismissToast() { clearTimeout(timer); set({ toast: null }); }

export interface NotNowView {
  toast: NotNowToast | null;
  pending: (id: string) => { on: boolean; at: number } | null;
}

export function useNotNow(): NotNowView {
  sdk = useSdk();
  const store = useSyncExternalStore(subscribe, read, read);
  return {
    toast: store.toast,
    pending: id => {
      const local = store.local.get(id);
      return local && Date.now() - local.at < SETTLE_MS ? local : null;
    },
  };
}

export function questionIdOf(task: { needs?: { questionId?: string }; later?: unknown; id: string }, data: Pick<BotTasksData, "questions">): string | null {
  return task.needs?.questionId ?? data.questions.find(q => q.taskId === task.id)?.id ?? null;
}

export function applyNotNow(data: BotTasksData, view: NotNowView): BotTasksData {
  if (!data.questions.some(q => view.pending(q.id))) return data;
  const parked = (id: string | undefined) => { const local = id ? view.pending(id) : null; return local?.on ? local.at : null; };
  const bots = data.bots.map(bot => ({
    ...bot,
    tasks: bot.tasks.map(task => {
      const at = task.displayState === "needs" ? parked(task.needs?.questionId) : null;
      return at === null ? task : { ...task, displayState: "waiting" as const, waitFor: "you", later: { reason: "not-now" as const, at } };
    }),
    desks: bot.desks.map(desk => {
      const at = desk.question?.state === "open" ? parked(desk.question.id) : null;
      return at === null ? desk : { ...desk, question: { ...desk.question!, state: "later" as const, laterAt: at } };
    }),
  }));
  const questions = data.questions.map(q => { const at = q.state === "open" ? parked(q.id) : null; return at === null ? q : { ...q, state: "later" as const, laterAt: at }; });
  return { ...data, bots, questions };
}

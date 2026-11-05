import { useSyncExternalStore } from "react";
import { useSdk } from "@get-bb/plugin-sdk/app";
import { z } from "zod";
import { needsChanged } from "./needsClient";
import type { BotTasksData } from "./botTasks";

export const NOT_NOW_PLUGIN = "orchestrator-mode";
const resultSchema = z.object({ key: z.string(), at: z.number().nullable() });
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

async function call(key: string, on: boolean) {
  if (!sdk) throw new Error("Not now is unavailable here");
  return sdk.plugins.callRpc({ pluginId: NOT_NOW_PLUGIN, method: "needs_not_now", input: { key, on }, outputSchema: resultSchema });
}

function withLocal(key: string, value: { on: boolean; at: number } | null) {
  const local = new Map(state.local);
  if (value) local.set(key, value); else local.delete(key);
  return local;
}

export async function notNow(key: string, label: string) {
  const at = Date.now();
  const toast: NotNowToast = { key, label, expiresAt: at + UNDO_MS, busy: false, error: null };
  set({ local: withLocal(key, { on: true, at }), toast });
  scheduleToastEnd(toast);
  try {
    await call(key, true);
    needsChanged();
  } catch (error) {
    const failed = { ...toast, error: `Couldn't move it to Later: ${error instanceof Error ? error.message : String(error)}`, expiresAt: Date.now() + UNDO_MS };
    set({ local: withLocal(key, null), toast: failed });
    scheduleToastEnd(failed);
  }
}

export async function bringBack(key: string, label?: string) {
  const current = state.toast?.key === key ? state.toast : null;
  if (current) set({ toast: { ...current, busy: true, error: null } });
  set({ local: withLocal(key, { on: false, at: Date.now() }) });
  try {
    await call(key, false);
    if (state.toast?.key === key) set({ toast: null });
    needsChanged();
  } catch (error) {
    const failed: NotNowToast = { key, label: label ?? current?.label ?? "this", expiresAt: Date.now() + UNDO_MS, busy: false, error: `Couldn't bring it back: ${error instanceof Error ? error.message : String(error)}` };
    set({ local: withLocal(key, { on: true, at: Date.now() }), toast: failed });
    scheduleToastEnd(failed);
  }
}

export function dismissToast() { clearTimeout(timer); set({ toast: null }); }

export interface NotNowView {
  toast: NotNowToast | null;
  laterAt: (key: string, since?: number) => number | null;
  pending: (key: string) => number | null;
}

export function taskNotNowKey(task: { id: string; waitFor?: string; needs?: { interactionId: string } }): string {
  return task.waitFor === "you" || !task.needs?.interactionId ? `task:${task.id}` : `form:${task.needs.interactionId}`;
}

export function useNotNow(server: BotTasksData["notNow"] | undefined): NotNowView {
  sdk = useSdk();
  const store = useSyncExternalStore(subscribe, read, read);
  const saved = new Map((server ?? []).map(entry => [entry.key, entry.at]));
  return {
    toast: store.toast,
    laterAt: (key, since) => {
      const local = store.local.get(key);
      if (local && !local.on) return null;
      const at = local?.on ? local.at : saved.get(key) ?? null;
      return at !== null && (since === undefined || at >= since) ? at : null;
    },
    pending: key => {
      const local = store.local.get(key);
      return local?.on && Date.now() - local.at < SETTLE_MS ? local.at : null;
    },
  };
}

export function applyNotNow(data: BotTasksData, view: NotNowView): BotTasksData {
  let changed = false;
  const bots = data.bots.map(bot => {
    let touched = false;
    const tasks = bot.tasks.map(task => {
      if (task.displayState !== "needs") return task;
      const at = view.pending(taskNotNowKey(task));
      if (at === null) return task;
      touched = true;
      return { ...task, displayState: "waiting" as const, waitFor: "you", later: { reason: "not-now" as const, at } };
    });
    const desks = bot.desks.map(desk => {
      if (desk.status !== "draft" && desk.status !== "blocked") return desk;
      const at = view.laterAt(`desk:${desk.id}`, desk.updatedAt);
      if (at === null) return desk;
      touched = true;
      return { ...desk, later: at };
    });
    if (!touched) return bot;
    changed = true;
    return { ...bot, tasks, desks };
  });
  return changed ? { ...data, bots } : data;
}

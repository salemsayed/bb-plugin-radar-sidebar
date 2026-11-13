import type { z } from "zod";
import type { PluginSidebarThread, PluginThreadActionEntry } from "@get-bb/plugin-sdk/app";
import type { botTasksSchema, taskDetailSchema } from "@/lib/botTasks";
import type { needsItemSchema } from "@/lib/needs";
import type { rosterSchema } from "@/components/radar/bots";

export type BotTasksInput = z.input<typeof botTasksSchema>;
export type NeedsInput = z.input<typeof needsItemSchema> & { options?: string[]; asked?: string; consequence?: string; advice?: string; askSeq?: number };
export type TaskDetailInput = z.input<typeof taskDetailSchema>;
export type RosterInput = z.input<typeof rosterSchema>;

export interface ThreadRow { id: string; title: string | null; status: string; createdAt: number; updatedAt: number }

export interface World {
  now: number;
  tasks: BotTasksInput;
  needs: NeedsInput[];
  roster: RosterInput;
  sidebarThreads: PluginSidebarThread[];
  projects: { id: string; name: string }[];
  taskDetails: Record<string, TaskDetailInput>;
  threadRows: ThreadRow[];
  threadActions: PluginThreadActionEntry[];
  calls: { plugin: string; method: string; input: unknown }[];
}

let world: World | null = null;

export function setWorld(next: World): void {
  world = next;
}

export function currentWorld(): World {
  if (!world) throw new Error("The harness world is read before a scenario set it");
  return world;
}

export function answerRpc(plugin: string, method: string, input: unknown): unknown {
  const state = currentWorld();
  state.calls.push({ plugin, method, input });
  if (method === "bot_tasks") return state.tasks;
  if (method === "bot_roster") return state.roster;
  if (method === "bots_version") return { version: 1 };
  if (method === "crew_needs_list") return { items: state.needs };
  if (method === "crew_answer_check") return { checks: [] };
  if (method === "task_details") {
    const ids = (input as { taskIds: string[] }).taskIds;
    return { details: ids.map(id => state.taskDetails[id] ?? { taskId: id, workers: [] }) };
  }
  if (method === "task_detail") {
    const id = (input as { taskId: string }).taskId;
    return state.taskDetails[id] ?? { taskId: id, workers: [] };
  }
  if (method === "desk_draft") return { messageSeq: 41 };
  if (method === "needs_not_now") {
    const { key, on } = input as { key: string; on: boolean };
    return { key, at: on ? state.now : null };
  }
  throw new Error(`The harness has no answer for ${plugin}.${method}`);
}

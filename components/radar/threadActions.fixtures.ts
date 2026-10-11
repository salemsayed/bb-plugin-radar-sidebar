import type { RenderedSlot, TestThreadActionsResolver } from "@get-bb/plugin-sdk/testing/app";

interface ActionCall {
  method: string;
  threadId?: string;
  pinned?: boolean;
  read?: boolean;
  title?: string;
  options?: { split?: boolean };
}
const hostCalls = new WeakMap<RenderedSlot, ActionCall[]>();

/** The SDK harness deliberately does not emulate core registrations. Supply
 * their public shape, recording requests without faking confirmation or Undo. */
export function threadActionsFixture() {
  const calls: ActionCall[] = [];
  const threadActions: TestThreadActionsResolver = (thread, { requestRename }) => [
    { key: "bb--core/archive", pluginId: "bb--core", group: "4_lifecycle", action: {
      label: thread.archivedAt === null ? "Archive" : "Unarchive", icon: "Archive",
      run: async () => { calls.push({ method: "archive", threadId: thread.id }); },
    } },
    { key: "bb--core/delete", pluginId: "bb--core", group: "4_lifecycle", action: {
      label: "Delete", icon: "Trash", run: async () => { calls.push({ method: "requestDelete", threadId: thread.id }); },
    } },
    { key: "bb--core/pin", pluginId: "bb--core", group: "2_organize", action: {
      label: thread.pinnedAt === null ? "Pin" : "Unpin", icon: "Pin",
      run: async () => { calls.push({ method: "setPinned", threadId: thread.id, pinned: thread.pinnedAt === null }); },
    } },
    { key: "bb--core/rename", pluginId: "bb--core", group: "2_organize", action: {
      label: "Rename", icon: "Edit", run: async () => requestRename(thread.id),
    } },
  ];
  return { threadActions, capture: (slot: RenderedSlot) => { hostCalls.set(slot, calls); return slot; } };
}

/** Observe navigation, writes and registered actions through public test APIs. */
export function recordedActions(slot: RenderedSlot): ActionCall[] {
  const result: ActionCall[] = [];
  for (const call of slot.inspection.navigateCalls) {
    if (call.method === "toThread") result.push({ method: "open", threadId: call.threadId,
      ...(call.options ? { options: call.options } : {}) });
  }
  for (const call of slot.inspection.sdkCalls) {
    const args = call.args[0] as { threadId?: string; title?: string };
    const threadId = args?.threadId;
    if (call.method === "threads.pin" || call.method === "threads.unpin") result.push({ method: "setPinned", threadId, pinned: call.method === "threads.pin" });
    if (call.method === "threads.markRead" || call.method === "threads.markUnread") result.push({ method: "setRead", threadId, read: call.method === "threads.markRead" });
    if (call.method === "threads.update" && args.title !== undefined) result.push({ method: "rename", threadId, title: args.title });
  }
  return result.concat(hostCalls.get(slot) ?? []);
}

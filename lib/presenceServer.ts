import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { LEASE_MS, presenceContract, type Heartbeat } from "./presence";

export function createPresenceServer(now = () => performance.now()) {
  const clients = new Map<string, Heartbeat & { expires: number }>();
  let closed = false;
  const sweep = () => {
    for (const [id, client] of clients) if (client.expires + LEASE_MS <= now()) clients.delete(id);
  };
  return {
    open: (threadId: string) => !closed && [...clients.values()].some(c => c.visible && c.threadId === threadId && c.expires > now()),
    sweep,
    heartbeat(input: Heartbeat) {
      if (!closed) {
        const previous = clients.get(input.clientId);
        if (!previous || input.sequence > previous.sequence) clients.set(input.clientId, { ...input, expires: now() + LEASE_MS });
      }
      return { ok: true as const };
    },
    dispose() { closed = true; clients.clear(); },
  };
}

export async function registerPresence(bb: BbPluginApi) {
  const presence = createPresenceServer();
  bb.rpc.register(presenceContract, {
    presence_heartbeat: async input => presence.heartbeat(input),
    presence_open: async ({ threadId }) => ({ open: presence.open(threadId) }),
  });
  const timer = setInterval(presence.sweep, 5_000);
  bb.onDispose(() => { clearInterval(timer); presence.dispose(); });
}

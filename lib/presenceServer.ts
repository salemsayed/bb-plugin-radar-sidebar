import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { LEASE_MS, presenceContract, type Heartbeat } from "./presence";

function memorySequenceGuard() {
  const sequences = new Map<string, number>();
  return (clientId: string, sequence: number) => {
    const previous = sequences.get(clientId);
    if (previous !== undefined && sequence <= previous) return false;
    sequences.set(clientId, sequence);
    return true;
  };
}

export function createPresenceServer(now = () => performance.now(), acceptSequence = memorySequenceGuard()) {
  const clients = new Map<string, Heartbeat & { expires: number }>();
  let closed = false;
  const sweep = () => {
    for (const [id, client] of clients) if (client.expires + LEASE_MS <= now()) clients.delete(id);
  };
  return {
    open: (threadId: string) => !closed && [...clients.values()].some(c => c.visible && c.threadId === threadId && c.expires > now()),
    sweep,
    heartbeat(input: Heartbeat) {
      if (!closed && acceptSequence(input.clientId, input.sequence)) clients.set(input.clientId, { ...input, expires: now() + LEASE_MS });
      return { ok: true as const };
    },
    dispose() { closed = true; clients.clear(); },
  };
}

export async function registerPresence(bb: BbPluginApi) {
  const db = bb.storage.database();
  db.exec("CREATE TABLE IF NOT EXISTS presence_client_sequences(client_id TEXT PRIMARY KEY,sequence INTEGER NOT NULL)");
  const acceptSequence = db.prepare("INSERT INTO presence_client_sequences VALUES(?,?) ON CONFLICT(client_id) DO UPDATE SET sequence=excluded.sequence WHERE sequence<excluded.sequence");
  const presence = createPresenceServer(() => performance.now(), (clientId, sequence) => acceptSequence.run(clientId, sequence).changes === 1);
  bb.rpc.register(presenceContract, {
    presence_heartbeat: async input => presence.heartbeat(input),
    presence_open: async ({ threadId }) => ({ open: presence.open(threadId) }),
  });
  const timer = setInterval(presence.sweep, 5_000);
  bb.onDispose(() => { clearInterval(timer); presence.dispose(); });
}

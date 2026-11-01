import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { LEASE_MS, presenceContract, type Heartbeat } from "./presence";

type ReadPoints = { get: (threadId: string) => number | undefined; set: (threadId: string, through: number) => unknown };

export function createPresenceServer(now = () => performance.now(), points: ReadPoints = new Map<string, number>()) {
  const clients = new Map<string, Heartbeat & { expires: number }>();
  let closed = false;
  const sweep = () => {
    for (const [id, client] of clients) if (client.expires + LEASE_MS <= now()) clients.delete(id);
  };
  return {
    open: (threadId: string) => !closed && [...clients.values()].some(c => c.visible && c.threadId === threadId && c.expires > now()),
    readPoint: (threadId: string) => closed ? null : points.get(threadId) ?? null,
    sweep,
    heartbeat(input: Heartbeat) {
      if (!closed) {
        const previous = clients.get(input.clientId);
        if (!previous || input.sequence > previous.sequence) {
          clients.set(input.clientId, { ...input, expires: now() + LEASE_MS });
          if (input.visible && input.threadId && input.through != null && Number.isFinite(input.through) && input.through >= 0 && input.through > (points.get(input.threadId) ?? -Infinity)) points.set(input.threadId, input.through);
        }
      }
      return { ok: true as const };
    },
    dispose() { closed = true; clients.clear(); },
  };
}

export async function registerPresence(bb: BbPluginApi) {
  const db = bb.storage.database();
  db.exec("CREATE TABLE IF NOT EXISTS presence_read_points(thread_id TEXT PRIMARY KEY,through INTEGER NOT NULL)");
  const presence = createPresenceServer(() => performance.now(), {
    get: threadId => (db.prepare("SELECT through FROM presence_read_points WHERE thread_id=?").get(threadId) as { through: number } | undefined)?.through,
    set: (threadId, through) => db.prepare("INSERT INTO presence_read_points VALUES(?,?) ON CONFLICT(thread_id) DO UPDATE SET through=MAX(through,excluded.through)").run(threadId, through),
  });
  bb.rpc.register(presenceContract, {
    presence_heartbeat: async input => presence.heartbeat(input),
    presence_read_point: async ({ threadId }) => ({ through: presence.readPoint(threadId) }),
    presence_open: async ({ threadId }) => ({ open: presence.open(threadId) }),
  });
  const timer = setInterval(presence.sweep, 5_000);
  bb.onDispose(() => { clearInterval(timer); presence.dispose(); });
}

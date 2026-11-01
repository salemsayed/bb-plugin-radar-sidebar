import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { LEASE_MS, presenceContract, type Heartbeat, type ReadPoint } from "./presence";

type ReadPoints = { get: (threadId: string) => ReadPoint | undefined; set: (threadId: string, point: ReadPoint) => unknown };
type Confirmations = { get: (threadId: string) => number | undefined; set: (threadId: string, at: number) => unknown };

function memorySequenceGuard() {
  const sequences = new Map<string, number>();
  return (clientId: string, sequence: number) => {
    const previous = sequences.get(clientId);
    if (previous !== undefined && sequence <= previous) return false;
    sequences.set(clientId, sequence);
    return true;
  };
}

export function createPresenceServer(now = () => performance.now(), points: ReadPoints = new Map<string, ReadPoint>(), confirmations: Confirmations = new Map<string, number>(), wallNow = Date.now, acceptSequence = memorySequenceGuard()) {
  const clients = new Map<string, Heartbeat & { expires: number }>();
  let closed = false;
  const sweep = () => {
    for (const [id, client] of clients) if (client.expires + LEASE_MS <= now()) clients.delete(id);
  };
  return {
    open: (threadId: string) => !closed && [...clients.values()].some(c => c.visible && c.threadId === threadId && c.expires > now()),
    readPoint: (threadId: string) => closed ? null : points.get(threadId) ?? null,
    confirmedAt: (threadId: string) => closed ? null : confirmations.get(threadId) ?? null,
    sweep,
    heartbeat(input: Heartbeat) {
      if (!closed) {
        if (acceptSequence(input.clientId, input.sequence)) {
          clients.set(input.clientId, { ...input, expires: now() + LEASE_MS });
          if (input.visible && input.threadId && input.through != null && Number.isFinite(input.through) && input.through >= 0 && input.messageSeq != null && Number.isSafeInteger(input.messageSeq) && input.messageSeq > 0) {
            if (input.messageSeq > (points.get(input.threadId)?.messageSeq ?? 0)) points.set(input.threadId, { through: input.through, messageSeq: input.messageSeq });
            const at = input.confirmed === true ? wallNow() : null;
            if (at !== null && Number.isFinite(at) && at >= 0) confirmations.set(input.threadId, Math.max(at, confirmations.get(input.threadId) ?? 0));
          }
        }
      }
      return { ok: true as const };
    },
    dispose() { closed = true; clients.clear(); },
  };
}

export async function registerPresence(bb: BbPluginApi) {
  const db = bb.storage.database();
  db.exec("CREATE TABLE IF NOT EXISTS presence_display_points(thread_id TEXT PRIMARY KEY,through INTEGER NOT NULL,message_seq INTEGER NOT NULL)");
  db.exec("CREATE TABLE IF NOT EXISTS presence_view_confirmations(thread_id TEXT PRIMARY KEY,confirmed_at INTEGER NOT NULL)");
  db.exec("CREATE TABLE IF NOT EXISTS presence_client_sequences(client_id TEXT PRIMARY KEY,sequence INTEGER NOT NULL)");
  const acceptSequence = db.prepare("INSERT INTO presence_client_sequences VALUES(?,?) ON CONFLICT(client_id) DO UPDATE SET sequence=excluded.sequence WHERE sequence<excluded.sequence");
  const presence = createPresenceServer(() => performance.now(), {
    get: threadId => {
      const row = db.prepare("SELECT through,message_seq AS messageSeq FROM presence_display_points WHERE thread_id=?").get(threadId) as ReadPoint | undefined;
      return row;
    },
    set: (threadId, point) => db.prepare("INSERT INTO presence_display_points VALUES(?,?,?) ON CONFLICT(thread_id) DO UPDATE SET through=excluded.through,message_seq=excluded.message_seq WHERE message_seq<excluded.message_seq").run(threadId, point.through, point.messageSeq),
  }, {
    get: threadId => (db.prepare("SELECT confirmed_at FROM presence_view_confirmations WHERE thread_id=?").get(threadId) as { confirmed_at: number } | undefined)?.confirmed_at,
    set: (threadId, at) => db.prepare("INSERT INTO presence_view_confirmations VALUES(?,?) ON CONFLICT(thread_id) DO UPDATE SET confirmed_at=MAX(confirmed_at,excluded.confirmed_at)").run(threadId, at),
  }, Date.now, (clientId, sequence) => acceptSequence.run(clientId, sequence).changes === 1);
  bb.rpc.register(presenceContract, {
    presence_heartbeat: async input => presence.heartbeat(input),
    presence_read_point: async ({ threadId }) => ({ ...(presence.readPoint(threadId) ?? { through: null, messageSeq: null }), confirmedAt: presence.confirmedAt(threadId) }),
    presence_open: async ({ threadId }) => ({ open: presence.open(threadId) }),
  });
  const timer = setInterval(presence.sweep, 5_000);
  bb.onDispose(() => { clearInterval(timer); presence.dispose(); });
}

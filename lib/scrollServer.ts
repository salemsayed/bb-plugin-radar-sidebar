import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { scrollContract, positionSchema, type ScrollPosition } from "./scrollPosition";

export function registerScroll(bb: BbPluginApi) {
  const db = bb.storage.database();
  db.exec("CREATE TABLE IF NOT EXISTS radar_scroll_positions(thread_id TEXT NOT NULL,device_id TEXT NOT NULL,position TEXT NOT NULL,PRIMARY KEY(thread_id,device_id))");
  const get = db.prepare("SELECT position FROM radar_scroll_positions WHERE thread_id=? AND device_id=?");
  const set = db.prepare("INSERT INTO radar_scroll_positions VALUES(?,?,?) ON CONFLICT(thread_id,device_id) DO UPDATE SET position=excluded.position");
  bb.rpc.register(scrollContract, {
    scroll_get: async ({ threadId, deviceId }) => {
      const row = get.get(threadId, deviceId) as { position: string } | undefined;
      return row ? positionSchema.parse(JSON.parse(row.position)) : null;
    },
    scroll_set: async ({ threadId, deviceId, position }: { threadId: string; deviceId: string; position: ScrollPosition }) => {
      set.run(threadId, deviceId, JSON.stringify(position));
      return { ok: true as const };
    },
  });
}

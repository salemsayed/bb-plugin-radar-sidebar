import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { cliCommand, defineCli } from "@get-bb/plugin-sdk";
import { scrollContract, positionSchema, type ScrollPosition } from "./scrollPosition";

const DEBUG_HOURS = 6;

export function registerScroll(bb: BbPluginApi) {
  const db = bb.storage.database();
  db.exec("CREATE TABLE IF NOT EXISTS radar_scroll_positions(thread_id TEXT NOT NULL,device_id TEXT NOT NULL,position TEXT NOT NULL,PRIMARY KEY(thread_id,device_id))");
  db.exec("CREATE TABLE IF NOT EXISTS radar_scroll_debug(id INTEGER PRIMARY KEY CHECK(id=1),until INTEGER NOT NULL)");
  db.exec("CREATE TABLE IF NOT EXISTS radar_scroll_traces(id INTEGER PRIMARY KEY AUTOINCREMENT,received INTEGER NOT NULL,device_id TEXT NOT NULL,page TEXT NOT NULL,agent TEXT,events TEXT NOT NULL)");
  const get = db.prepare("SELECT position FROM radar_scroll_positions WHERE thread_id=? AND device_id=?");
  const set = db.prepare("INSERT INTO radar_scroll_positions VALUES(?,?,?) ON CONFLICT(thread_id,device_id) DO UPDATE SET position=excluded.position");
  const debugUntil = db.prepare("SELECT until FROM radar_scroll_debug WHERE id=1");
  const setDebug = db.prepare("INSERT INTO radar_scroll_debug VALUES(1,?) ON CONFLICT(id) DO UPDATE SET until=excluded.until");
  const addTrace = db.prepare("INSERT INTO radar_scroll_traces(received,device_id,page,agent,events) VALUES(?,?,?,?,?)");
  const traceCount = db.prepare("SELECT COUNT(*) AS n, MAX(received) AS last FROM radar_scroll_traces WHERE received>?");
  const debugOn = () => ((debugUntil.get() as { until: number } | undefined)?.until ?? 0) > Date.now();
  bb.rpc.register(scrollContract, {
    scroll_get: async ({ threadId, deviceId }) => {
      const row = get.get(threadId, deviceId) as { position: string } | undefined;
      return row ? positionSchema.parse(JSON.parse(row.position)) : null;
    },
    scroll_set: async ({ threadId, deviceId, position }: { threadId: string; deviceId: string; position: ScrollPosition }) => {
      set.run(threadId, deviceId, JSON.stringify(position));
      return { ok: true as const };
    },
    scroll_debug: async () => ({ on: debugOn() }),
    scroll_trace: async ({ deviceId, page, agent, events }) => {
      if (!debugOn()) return { on: false };
      addTrace.run(Date.now(), deviceId, page, agent ?? null, JSON.stringify(events));
      return { on: true };
    },
  });
  bb.cli.register(defineCli({
    name: "radar-scroll",
    summary: "Radar scroll memory diagnostics",
    description: "Turn on scroll traces from every browser and app (stored in this plugin's database, table radar_scroll_traces).",
    commands: {
      debug: cliCommand({
        summary: "Turn scroll tracing on or off, or show its state",
        positionals: [{ name: "state", description: "on, off or status", required: true }],
        options: { hours: { type: "integer", min: 1, max: 48, default: DEBUG_HOURS, description: "How long tracing stays on" } },
        run(input) {
          const state = input.positionals.state;
          if (state === "on") setDebug.run(Date.now() + input.options.hours * 3600000);
          else if (state === "off") setDebug.run(0);
          else if (state !== "status") return { exitCode: 1, stderr: "state must be on, off or status\n" };
          const until = (debugUntil.get() as { until: number } | undefined)?.until ?? 0;
          const recent = traceCount.get(Date.now() - 3600000) as { n: number; last: number | null };
          return { exitCode: 0, stdout: `${until > Date.now() ? `on until ${new Date(until).toISOString()}` : "off"}; ${recent.n} trace batches in the last hour${recent.last ? `, last ${new Date(recent.last).toISOString()}` : ""}\n` };
        },
      }),
    },
  }));
}

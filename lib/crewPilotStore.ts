import { createHash } from "node:crypto";
import type Database from "better-sqlite3";
import type { NeedsItem } from "./needs";
import { pilotBoardSchema, pilotEntrySchema, pilotSnapshotSchema, type PilotBoard, type PilotEntry, type PilotSend, type PilotSnapshot } from "./crewPilot";

export const PILOT_MIGRATIONS = [
  "CREATE TABLE crew_pilot_state (id INTEGER PRIMARY KEY CHECK(id=1), json TEXT NOT NULL)",
  "CREATE TABLE crew_pilot_entries (id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, json TEXT NOT NULL, at INTEGER NOT NULL)",
];
export function sourceVersion(item: NeedsItem): string {
  return createHash("sha256").update(JSON.stringify(item)).digest("hex");
}
export function createPilotStore(db: Database.Database) {
  const readState = () => {
    const row = db.prepare("SELECT json FROM crew_pilot_state WHERE id=1").get() as { json: string } | undefined;
    return row ? pilotBoardSchema.parse(JSON.parse(row.json)) : { snapshot: null, entries: [], placements: {}, versions: {}, totalEntries: 0 } satisfies PilotBoard;
  };
  const writeState = (state: PilotBoard) => db.prepare("INSERT INTO crew_pilot_state VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET json=excluded.json").run(JSON.stringify({ ...state, entries: [] }));
  const get = (id: string): PilotEntry | undefined => {
    const row = db.prepare("SELECT json FROM crew_pilot_entries WHERE id=?").get(id) as { json: string } | undefined;
    return row ? pilotEntrySchema.parse(JSON.parse(row.json)) : undefined;
  };
  const save = (entry: PilotEntry) => db.prepare("UPDATE crew_pilot_entries SET json=? WHERE id=?").run(JSON.stringify(pilotEntrySchema.parse(entry)), entry.id);
  const board = (): PilotBoard => ({ ...readState(),
    entries: (db.prepare("SELECT json FROM crew_pilot_entries ORDER BY at DESC, rowid DESC LIMIT 100").all() as { json: string }[]).reverse().map(row => pilotEntrySchema.parse(JSON.parse(row.json))),
    totalEntries: (db.prepare("SELECT count(*) AS n FROM crew_pilot_entries").get() as { n: number }).n,
  });
  return {
    board, get, save,
    recover() {
      for (const row of db.prepare("SELECT json FROM crew_pilot_entries").all() as { json: string }[]) {
        const entry = pilotEntrySchema.parse(JSON.parse(row.json));
        if (entry.status === "pending") save({ ...entry, status: "failed", reply: "The pilot restarted before this proposal finished. Send a new message to try again. Nothing was dispatched." });
      }
    },
    snapshot(items: NeedsItem[], bots: PilotSnapshot["bots"], now: number) {
      return db.transaction(() => {
        const state = readState();
        const snapshot = pilotSnapshotSchema.parse({ items, bots, at: now, revision: (state.snapshot?.revision ?? 0) + 1 });
        const versions = Object.fromEntries(items.map(item => [item.id, sourceVersion(item)]));
        // An overlay describes one exact source revision. A changed or missing source invalidates it.
        const placements = Object.fromEntries(Object.entries(state.placements).filter(([id, overlay]) => versions[id] === overlay.version));
        writeState({ ...state, snapshot, versions, placements });
        return board();
      })();
    },
    begin(input: PilotSend, now: number) {
      return db.transaction(() => {
        const fingerprint = createHash("sha256").update(JSON.stringify(input)).digest("hex");
        const existing = db.prepare("SELECT fingerprint FROM crew_pilot_entries WHERE id=?").get(input.commandId) as { fingerprint: string } | undefined;
        if (existing) {
          if (existing.fingerprint !== fingerprint) throw new Error("This command ID already belongs to another message.");
          return { fresh: false, entry: get(input.commandId)! };
        }
        const state = readState();
        if (!state.snapshot) throw new Error("Load a source snapshot first.");
        if (!!input.needId !== !!input.sourceVersion) throw new Error("An answer needs its request and source version.");
        if (input.needId && state.versions[input.needId] !== input.sourceVersion) throw new Error("That request changed. Refresh and select it again.");
        const entry: PilotEntry = { id: input.commandId, text: input.text, at: now, status: "pending", reply: "Preparing a proposal…", action: null, owner: null,
          needId: input.needId ?? null, sourceVersion: input.sourceVersion ?? null, review: "unreviewed", model: null, latencyMs: null };
        db.prepare("INSERT INTO crew_pilot_entries VALUES(?,?,?,?)").run(entry.id, fingerprint, JSON.stringify(entry), now);
        return { fresh: true, entry };
      })();
    },
    review(id: string, review: "correct" | "incorrect") {
      return db.transaction(() => {
        const entry = get(id);
        if (!entry || entry.status !== "ready") throw new Error("This proposal is not ready for review.");
        if (entry.review !== "unreviewed") {
          if (entry.review === review) return board();
          throw new Error("This review was already recorded.");
        }
        const state = readState();
        if (entry.needId && state.versions[entry.needId] !== entry.sourceVersion) throw new Error("The source changed. Make a new proposal from the current card.");
        if (review === "correct" && entry.needId && entry.sourceVersion && ["later", "withdraw"].includes(entry.action ?? "")) {
          state.placements[entry.needId] = { value: entry.action === "later" ? "later" : "history", version: entry.sourceVersion };
          writeState(state);
        }
        save({ ...entry, review });
        return board();
      })();
    },
  };
}

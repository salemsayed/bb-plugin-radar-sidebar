import { execFileSync, spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { here } from "./paths.mjs";

const KEYS = ["S", "L", "NODE_BIN", "ISO_URL", "DAEMON_PORT", "SERVER_PORT", "BB_VERSION"];

export function isoConfig() {
  const out = execFileSync("bash", ["-c", `source ${join(here, "env.sh")}; printf '%s\\n' ${KEYS.map(k => `"$${k}"`).join(" ")}`], { encoding: "utf8" }).trim().split("\n");
  return Object.fromEntries(KEYS.map((key, i) => [key, out[i]]));
}

export const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export class Iso {
  constructor(config = isoConfig()) {
    this.config = config;
    this.url = config.ISO_URL;
    this.data = join(config.S, "data");
  }

  env(thread) {
    const { S, NODE_BIN, ISO_URL, DAEMON_PORT } = this.config;
    return { HOME: process.env.HOME, PATH: `${NODE_BIN}:/usr/bin:/bin`, TMPDIR: join(S, "tmp"), BB_DATA_DIR: this.data, BB_SERVER_URL: ISO_URL, BB_HOST_DAEMON_PORT: DAEMON_PORT, ...(thread ? { BB_THREAD_ID: thread } : {}) };
  }

  run(args, { thread, allowFail = false, timeout = 120_000 } = {}) {
    const { NODE_BIN, L } = this.config;
    const result = spawnSync(join(NODE_BIN, "node"), [join(L, "host-daemon/dist/bb"), ...args], { env: this.env(thread), encoding: "utf8", timeout, maxBuffer: 64 * 1024 * 1024 });
    if (result.status !== 0 && !allowFail) throw new Error(`isolated bb ${args.slice(0, 3).join(" ")} failed (${result.status}): ${(result.stderr || result.stdout).trim().slice(0, 600)}`);
    return { ok: result.status === 0, out: result.stdout.trim(), err: result.stderr.trim() };
  }

  json(args, options) {
    const { out } = this.run([...args, "--json"], options);
    return JSON.parse(out);
  }

  rpc(plugin, method, input) {
    const file = join(this.config.S, "tmp", `rpc-${process.pid}-${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(file, JSON.stringify(input ?? null));
    return this.json(["plugin", "rpc", "call", plugin, method, "--input-file", file]);
  }

  botTasks() {
    return this.rpc("orchestrator-mode", "bot_tasks", {});
  }

  bot(key) {
    return this.botTasks().bots.find(bot => bot.key === key);
  }

  needs() {
    return this.rpc("orchestrator-mode", "needs_list", { states: ["open", "snoozed", "reminded", "done", "dropped"] }).items;
  }

  db() {
    return new DatabaseSync(join(this.data, "bb.db"), { readOnly: true });
  }

  coreDb() {
    return new DatabaseSync(join(this.data, "plugins/orchestrator-mode/data.db"), { readOnly: true });
  }

  query(sql, ...params) {
    const db = this.db();
    try { return db.prepare(sql).all(...params); } finally { db.close(); }
  }

  coreQuery(sql, ...params) {
    const db = this.coreDb();
    try { return db.prepare(sql).all(...params); } finally { db.close(); }
  }

  lastSeq(threadId, type) {
    return this.query(`SELECT COALESCE(MAX(sequence),0) AS seq FROM events WHERE thread_id=?${type ? " AND type=?" : ""}`, ...[threadId, type].filter(Boolean))[0].seq;
  }

  messages(threadId, afterSeq = 0) {
    return this.query("SELECT sequence AS seq, type, created_at AS at, data FROM events WHERE thread_id=? AND sequence>? AND type IN ('client/turn/requested','item/completed') ORDER BY sequence", threadId, afterSeq)
      .map(row => ({ ...row, data: JSON.parse(row.data) }))
      .filter(row => row.type === "client/turn/requested" || row.data.item?.type === "agentMessage")
      .map(row => row.type === "client/turn/requested"
        ? { seq: row.seq, at: row.at, from: row.data.senderThreadId ? "thread" : row.data.initiator === "user" ? "salem" : row.data.initiator, source: row.data.source, text: (row.data.input ?? []).filter(part => !part.visibility).map(part => part.text ?? "").join(" "), mentions: (row.data.input ?? []).flatMap(part => part.mentions ?? []), hidden: (row.data.input ?? []).some(part => part.visibility) }
        : { seq: row.seq, at: row.at, from: "bot", text: row.data.item.text ?? "", mentions: [] });
  }

  async relay() {
    if (this.relayThread) return this.relayThread;
    const root = join(this.config.S, "workspaces", "harness-relay");
    execFileSync("bash", ["-c", `mkdir -p "${root}" && cd "${root}" && [ -d .git ] || (git init -q && echo relay > README.md && git add -A && git -c user.email=harness@test -c user.name=harness commit -qm init)`]);
    const project = this.json(["project", "create", "--name", "Harness relay", "--root", root]);
    const thread = this.json(["thread", "spawn", "--project", project.id ?? project.project.id, "--environment", root, "--provider", "scripted-echo", "--model", "claude-sonnet-5-5", "--title", "Harness relay", "--prompt", "relay ready"]);
    this.relayThread = thread.id ?? thread.thread.id;
    await this.idle(this.relayThread);
    return this.relayThread;
  }

  pending(threadId) {
    const { ok, out } = this.run(["thread", "interactions", "list", threadId, "--json"], { allowFail: true });
    if (!ok) return [];
    const list = JSON.parse(out);
    return (Array.isArray(list) ? list : list.interactions ?? list.items ?? []).filter(i => i.status === "pending");
  }

  answer(threadId, interaction) {
    const question = interaction.payload?.questions?.[0];
    const value = question?.options?.[0]?.value ?? "staging";
    return this.run(["thread", "interactions", "answer", interaction.id, threadId, "--choice", `${question?.id ?? "question-1"}=${value}`], { allowFail: true });
  }

  questions() {
    return this.botTasks().questions ?? null;
  }

  records() {
    const db = this.coreDb();
    try {
      if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='needs_you_questions'").get()) return null;
      return db.prepare("SELECT * FROM needs_you_questions ORDER BY created_at").all().map(r => ({ ...r, body: JSON.parse(r.body) }));
    } finally { db.close(); }
  }

  thread(threadId) {
    return this.json(["thread", "show", threadId]).thread;
  }

  queued(threadId) {
    const { ok, out } = this.run(["thread", "queue", "list", threadId, "--json"], { allowFail: true });
    if (!ok) return 0;
    const list = JSON.parse(out);
    return (Array.isArray(list) ? list : list.queuedMessages ?? list.items ?? []).length;
  }

  async idle(threadId, timeoutMs = 90_000) {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      const status = this.thread(threadId).status;
      if (status !== "active" && this.queued(threadId) === 0) return status;
      await sleep(700);
    }
    throw new Error(`${threadId} still busy after ${timeoutMs / 1000} s`);
  }

  async until(what, check, timeoutMs = 60_000, every = 1_000) {
    const until = Date.now() + timeoutMs;
    let last;
    while (Date.now() < until) {
      last = await check();
      if (last) return last;
      await sleep(every);
    }
    throw new Error(`timed out after ${timeoutMs / 1000} s waiting for ${what}`);
  }
}

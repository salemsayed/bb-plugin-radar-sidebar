import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { sleep } from "./bb.mjs";

const PROVIDER = ["--provider", "scripted-echo", "--model", "claude-sonnet-5-5"];

const quote = text => JSON.stringify(text);
const fence = lines => `\`\`\`ui\n${lines.join("\n")}\n\`\`\``;
const choices = (values, recommended) => `[${values.map(value => value === recommended ? `{value: ${quote(value)}, detail: "Recommended"}` : `{value: ${quote(value)}}`).join(", ")}]`;

export function radio(title, label, options, { recommended } = {}) {
  return fence(['$pick = ""', `Card(${quote(title)}, [Form([`, `  Radio($pick, ${choices(options, recommended)}, label: ${quote(label)})`, "])])"]);
}

export function buttons(title, labels) {
  return fence([`Card(${quote(title)}, [${labels.map(label => `Button(${quote(label)})`).join(", ")}])`]);
}

export function form(title, fields) {
  const field = (item, i) => item.options ? `  Radio($f${i}, ${choices(item.options)}, label: ${quote(item.label)})` : `  Input($f${i}, label: ${quote(item.label)})`;
  return fence([...fields.map((_, i) => `$f${i} = ""`), `Card(${quote(title)}, [Form([`, fields.map(field).join(",\n"), "])])"]);
}

export const chip = taskId => `::task{id="${taskId}"}`;

export class Bot {
  constructor(iso, { key, name }) {
    this.iso = iso;
    this.key = key;
    this.name = name;
    this.files = join(iso.config.S, "tmp", "say");
    this.offset = 0;
    mkdirSync(this.files, { recursive: true });
  }

  static async register(iso, { key, name }) {
    const bot = new Bot(iso, { key, name });
    const workspace = join(iso.config.S, "workspaces", key);
    mkdirSync(workspace, { recursive: true });
    writeFileSync(join(workspace, "AGENTS.md"), `# ${name}\nTest coordinator for the Radar panel actions harness.\n`);
    execFileSync("bash", ["-c", `cd "${workspace}" && git init -q && git add -A && git -c user.email=harness@test -c user.name=harness commit -qm init`]);
    const project = iso.json(["project", "create", "--name", name, "--root", workspace]);
    bot.project = project.id ?? project.project.id;
    bot.workspace = workspace;
    const thread = iso.json(["thread", "spawn", "--project", bot.project, "--environment", workspace, ...PROVIDER, "--prompt", `${name} starting`]);
    bot.coordinator = thread.id ?? thread.thread.id;
    await iso.idle(bot.coordinator);
    iso.json(["saelmbot", "bot", "register", "--bot", key, "--thread", bot.coordinator, "--name", name]);
    iso.run(["saelmbot", "result-close", "on", "--bot", key]);
    return bot;
  }

  at(fromNowMs) {
    return Date.now() + this.offset + fromNowMs;
  }

  as(command, { allowFail = false } = {}) {
    return this.iso.run(["saelmbot", ...command], { thread: this.coordinator, allowFail });
  }

  asJson(command) {
    return JSON.parse(this.as(command).out);
  }

  async salem(text, from) {
    const before = this.iso.lastSeq(this.coordinator, "client/turn/requested");
    this.iso.run(["thread", "tell", this.coordinator, "--mode", "auto", text], from ? { thread: from } : {});
    const seq = await this.iso.until(`Salem's message in ${this.name}`, () => { const now = this.iso.lastSeq(this.coordinator, "client/turn/requested"); return now > before ? now : 0; });
    await this.iso.idle(this.coordinator);
    return seq;
  }

  async say(markdown, { about } = {}) {
    const file = join(this.files, `${this.key}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}.md`);
    writeFileSync(file, markdown);
    if (about) await this.salem(`${chip(about)} say_file:${file}`);
    else await this.salem(`say_file:${file}`, await this.iso.relay());
    const seq = this.iso.query("SELECT MAX(sequence) AS seq FROM events WHERE thread_id=? AND type='item/completed' AND json_extract(data,'$.item.type')='agentMessage' AND json_extract(data,'$.item.text')=?", this.coordinator, markdown)[0].seq;
    if (!seq) throw new Error(`${this.name} did not say the prepared reply`);
    return seq;
  }

  async task({ ask, title, outcome = title, nextStep = "Work on it", criteria = [`${title} is done`] }) {
    const seq = await this.salem(ask);
    const task = this.asJson(["task", "create", "--bot", this.key, "--input", JSON.stringify({ request: { threadId: this.coordinator, seq }, title, outcome, nextStep, criteria })]);
    return task.id;
  }

  change(id, input, options) {
    return this.as(["task", "change", "--bot", this.key, "--input", JSON.stringify({ id, ...input })], options);
  }

  get(id) {
    return this.asJson(["task", "get", "--bot", this.key, "--id", id]);
  }

  waitOnSalem(id, reason) {
    this.change(id, { action: "wait", owner: "salem", reason });
  }

  async askThenWait(id, question) {
    const seq = await this.say(`${chip(id)}\n${question}`, { about: id });
    this.waitOnSalem(id, question);
    return seq;
  }

  waitOutside(id, reason, wakeAt) {
    this.change(id, { action: "wait", owner: "external", reason, ...(wakeAt ? { wakeAt: new Date(wakeAt).toISOString() } : {}) });
  }

  resume(id) {
    this.change(id, { action: "resume" });
  }

  async finish(id, result) {
    const seq = await this.say(result);
    const task = this.get(id);
    if (task.state === "waiting") this.resume(id);
    this.change(id, { action: "finish", source: { threadId: this.coordinator, seq } });
  }

  async cancel(id, words) {
    const seq = await this.salem(words);
    this.change(id, { action: "cancel", source: { threadId: this.coordinator, seq } });
  }

  async worker(id, { title, prompt = "hold_turn working" }) {
    const thread = this.iso.json(["thread", "spawn", "--project", this.project, "--environment", this.workspace, ...PROVIDER, "--parent-thread", this.coordinator, "--title", title, "--prompt", prompt]);
    const threadId = thread.id ?? thread.thread.id;
    await sleep(1500);
    if (id) this.as(["task-v2", "move-worker", "--worker", threadId, "--id", id, "--json"]);
    return threadId;
  }

  async desk({ desk = "chat", key, title, prompt = "Desk opened" }) {
    const args = ["desk", "open", "--bot", this.key, "--desk", desk, "--key", key, "--title", title, "--prompt", prompt, "--json"];
    const opened = this.asJson(args);
    if (opened.kind === "deferred") return { ...opened, threadId: null };
    if (!opened.threadId) throw new Error(`desk ${key} did not open: ${JSON.stringify(opened)}`);
    await this.iso.idle(opened.threadId, 20_000);
    return opened;
  }

  deskStatus(threadId, status, extra = []) {
    return this.as(["desk", "status", status, "--thread", threadId, ...extra]);
  }

  deskWake(threadId, at, reason) {
    return this.as(["desk", "wake", "--thread", threadId, "--at", new Date(at).toISOString(), "--reason", reason]);
  }

  need(text, { kind = "decision", recommend, message } = {}) {
    const args = ["saelmbot", "needs", "add", "--json", "--bot", this.key, "--kind", kind, "--text", text, "--thread", this.coordinator];
    if (recommend) args.push("--recommend", recommend);
    if (message) args.push("--message", `message:${message}`);
    return JSON.parse(this.iso.run(args, { thread: this.coordinator }).out);
  }

  scheduleFor(threadId, when, text) {
    return this.iso.run(["thread", "tell", threadId, "--mode", "queue", "--send-at", when, text]);
  }

  needDone(id) {
    return this.as(["needs", "done", id, "--json"]);
  }

  async outsideQuestion(title) {
    const workspace = join(this.iso.config.S, "workspaces", `${this.key}-outside`);
    mkdirSync(workspace, { recursive: true });
    writeFileSync(join(workspace, "README.md"), `# ${title}\nA project no bot owns.\n`);
    execFileSync("bash", ["-c", `cd "${workspace}" && git init -q && git add -A && git -c user.email=harness@test -c user.name=harness commit -qm init`]);
    const project = this.iso.json(["project", "create", "--name", `${title} project`, "--root", workspace]);
    const projectId = project.id ?? project.project.id;
    const thread = this.iso.json(["thread", "spawn", "--project", projectId, "--environment", workspace, ...PROVIDER, "--title", title, "--prompt", "ask_user which path"]);
    const threadId = thread.id ?? thread.thread.id;
    await this.iso.until(`${title} to ask`, () => this.iso.pending(threadId).length > 0, 60_000);
    return { threadId, projectId };
  }

  tasks() {
    return this.iso.bot(this.key)?.tasks ?? [];
  }

  row(id) {
    return this.tasks().find(task => task.id === id);
  }
}

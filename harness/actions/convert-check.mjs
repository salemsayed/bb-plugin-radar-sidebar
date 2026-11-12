import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { Iso, sleep } from "./lib/bb.mjs";
import { Bot, chip } from "./lib/seed.mjs";
import { Setup, resolveBuilds } from "./lib/setup.mjs";
import { PHASES, SCENARIOS, seed } from "./lib/world.mjs";
import { Driver } from "./lib/panel.mjs";

const { values } = parseArgs({ options: { "old-core": { type: "string" }, "old-radar": { type: "string" }, core: { type: "string" }, radar: { type: "string" }, out: { type: "string" }, view: { type: "string", default: "desktop" } } });
const out = resolve(values.out);
mkdirSync(out, { recursive: true });
const lines = [];
const log = line => { const stamped = `${new Date().toISOString().slice(11, 19)} ${line}`; lines.push(stamped); console.log(stamped); };
const KEEP = new Set(["buttons", "later", "questions", "native", "desks", "old", "stale", "arabic"]);

const iso = new Iso();
const before = resolveBuilds({ radar: values["old-radar"], core: values["old-core"] });
const after = resolveBuilds({ radar: values.radar, core: values.core });
log(`before: core ${before.core.commit} radar ${before.radar.commit}; after: core ${after.core.commit} radar ${after.radar.commit}`);
const setup = new Setup(iso, before, log);
await setup.fresh(PHASES[0].offset);
const bots = {};
for (const scenario of SCENARIOS.filter(s => KEEP.has(s.key))) { bots[scenario.key] = await Bot.register(iso, scenario); bots[scenario.key].world = {}; }
for (const [i, phase] of PHASES.entries()) { if (i > 0) await setup.restart(phase.offset); await seed(iso, bots, phase, KEEP, log); }

const w = key => bots[key].world;
const notNow = key => iso.rpc("orchestrator-mode", "needs_not_now", { key, on: true });
await bots.buttons.salem(`${chip(w("buttons").drums)} Which margin? 15 percent`);
const form = () => iso.pending(w("native").loginWorker)[0]?.id;
await iso.until("the native question", () => form(), 60_000);
const desk = iso.bot("desks").desks.find(d => d.threadId === w("desks").draftDesk.threadId);
const parked = [`task:${w("later").deploy}`, `desk:${desk.id}`, `form:${form()}`, `task:${w("questions").renew}`];
for (const key of parked) { try { notNow(key); log(`old core: Not now ${key}`); } catch (error) { log(`old core: Not now ${key} refused: ${String(error).slice(0, 200)}`); } }
await sleep(5000);

async function look(label) {
  const driver = await Driver.open(iso, values.view, join(out, label), log);
  const seen = {};
  try {
    for (const key of Object.keys(bots)) {
      await driver.openPanel(bots[key]);
      await sleep(1500);
      const state = await driver.state();
      seen[key] = (state?.items ?? []).filter(item => ["needs", "later", "waiting"].includes(item.group)).map(item => ({ key: item.key, group: item.group, text: item.text.slice(0, 120) }));
      await driver.shot(`${key}`);
      await driver.closePanel();
    }
    await driver.home();
    seen.strip = await driver.strip();
    await driver.shot("sidebar");
  } finally { await driver.close(); }
  return seen;
}

const old = await look("before");
writeFileSync(join(out, "before.json"), JSON.stringify({ seen: old, botTasks: iso.botTasks() }, null, 1));
log("installing the rebuilt core and Radar over the old ones");
setup.install(setup.copy(after.core.dir, "core-after"));
setup.install(setup.copy(after.radar.dir, "radar-after"));
await setup.restart(0);
await iso.until("the rebuilt core to answer with questions", () => Array.isArray(iso.botTasks().questions), 90_000);
await sleep(4000);
const now = await look("after");
writeFileSync(join(out, "after.json"), JSON.stringify({ seen: now, botTasks: iso.botTasks(), records: iso.records() }, null, 1));

const rows = [];
for (const key of Object.keys(bots)) {
  for (const item of old[key]) {
    const later = now[key].find(i => i.key === item.key) ?? (item.key.startsWith("task:need_") ? now[key].find(i => i.text === item.text) : undefined);
    const same = later && (later.group === item.group || item.group === "waiting" && later.group === "waiting");
    rows.push({ bot: key, key: item.key, before: item.group, after: later?.group ?? "missing", ok: !!same, text: item.text });
  }
  for (const item of now[key].filter(i => !old[key].some(o => o.key === i.key))) rows.push({ bot: key, key: item.key, before: "absent", after: item.group, ok: item.group !== "needs", text: item.text });
}
const md = ["# Conversion check: what Salem saw before the upgrade against after it", "", `before core ${before.core.commit} radar ${before.radar.commit}; after core ${after.core.commit} radar ${after.radar.commit}; view ${values.view}`, "",
  "| Bot | Item | Before | After | Same |", "| --- | --- | --- | --- | --- |", ...rows.map(r => `| ${r.bot} | ${r.key} ${r.text.replace(/\|/g, "/").slice(0, 70)} | ${r.before} | ${r.after} | ${r.ok ? "yes" : "**no**"} |`),
  "", `Strip before: ${old.strip.length} items; after: ${now.strip.length} items.`].join("\n");
writeFileSync(join(out, "convert.md"), md);
writeFileSync(join(out, "run.log"), lines.join("\n"));
log(`${rows.filter(r => !r.ok).length} of ${rows.length} items changed; ${join(out, "convert.md")}`);
process.exitCode = rows.some(r => !r.ok) ? 1 : 0;

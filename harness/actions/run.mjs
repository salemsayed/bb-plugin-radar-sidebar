import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { Iso } from "./lib/bb.mjs";
import { Bot } from "./lib/seed.mjs";
import { Setup, resolveBuilds } from "./lib/setup.mjs";
import { PHASES, SCENARIOS, seed } from "./lib/world.mjs";
import { CASES } from "./lib/cases.mjs";
import { Driver } from "./lib/panel.mjs";
import { Results } from "./lib/results.mjs";
import { here } from "./lib/paths.mjs";
import { holdRunLock } from "./lib/lock.mjs";

const { values } = parseArgs({ options: {
  radar: { type: "string" }, core: { type: "string" }, out: { type: "string" },
  only: { type: "string" }, views: { type: "string", default: "desktop,phone" }, case: { type: "string" }, "seed-only": { type: "boolean", default: false }, reuse: { type: "boolean", default: false },
} });

const out = resolve(values.out ?? join(here, "results"));
mkdirSync(out, { recursive: true });
const only = values.only ? new Set(values.only.split(",")) : null;
const caseFilter = values.case ? new RegExp(values.case) : null;
const logLines = [];
const log = line => { const stamped = `${new Date().toISOString().slice(11, 19)} ${line}`; logLines.push(stamped); console.log(stamped); };

const iso = new Iso();
await holdRunLock({ port: Number(iso.config.LOCK_PORT), file: join(iso.config.S, "run-lock"), holder: `pid ${process.pid} started ${new Date().toISOString().slice(11, 19)}, out ${out}`, log });
const builds = resolveBuilds({ radar: values.radar, core: values.core });
log(`Radar ${builds.radar.commit ?? "?"} from ${builds.radar.dir}`);
log(`core ${builds.core.commit ?? "?"} from ${builds.core.dir}`);
const setup = new Setup(iso, builds, log);
const results = new Results(out, builds);

async function build(view) {
  log(`== ${view}: fresh isolated bb`);
  await setup.fresh(PHASES[0].offset);
  const bots = {};
  for (const scenario of SCENARIOS) {
    if (only && !only.has(scenario.key)) continue;
    bots[scenario.key] = await Bot.register(iso, scenario);
    bots[scenario.key].world = {};
  }
  for (const [i, phase] of PHASES.entries()) {
    if (i > 0) await setup.restart(phase.offset);
    await seed(iso, bots, phase, only, log);
  }
  writeFileSync(join(out, `world-${view}.json`), JSON.stringify(Object.fromEntries(Object.entries(bots).map(([key, bot]) => [key, { key, name: bot.name, coordinator: bot.coordinator, project: bot.project, workspace: bot.workspace, world: bot.world }])), null, 2));
  return bots;
}

function reuse(view) {
  log(`== ${view}: reusing the seeded isolated bb as it is now (development only)`);
  const saved = JSON.parse(readFileSync(join(out, `world-${view}.json`), "utf8"));
  return Object.fromEntries(Object.entries(saved).map(([key, entry]) => [key, Object.assign(new Bot(iso, entry), entry)]));
}

for (const view of values.views.split(",")) {
  const bots = values.reuse ? reuse(view) : await build(view);
  if (values["seed-only"]) continue;
  const driver = await Driver.open(iso, view, join(out, view), log);
  try {
    for (const item of CASES) {
      if (only && !only.has(item.scenario)) continue;
      if (caseFilter && !caseFilter.test(item.id)) continue;
      if (item.views && !item.views.includes(view)) continue;
      await results.run(item, { iso, bot: bots[item.scenario], world: bots[item.scenario].world, bots, driver, view, log });
    }
  } finally {
    await driver.close();
    results.write(logLines);
  }
}
results.write(logLines);
log(`results: ${join(out, "results.md")}`);
process.exitCode = results.failed() ? 1 : 0;

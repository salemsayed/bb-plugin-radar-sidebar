import { writeFileSync } from "node:fs";
import { join } from "node:path";

const cell = text => String(text ?? "").replace(/\|/g, "\\|").replace(/\n+/g, " ");

export class Results {
  constructor(out, builds) {
    this.out = out;
    this.builds = builds;
    this.rows = [];
  }

  async run(item, context) {
    const started = Date.now();
    const evidence = [];
    const note = (label, value) => evidence.push({ label, value: typeof value === "string" ? value : JSON.stringify(value) });
    let pass = true, error = null, shot = null, owner = item.owner ?? null;
    const owners = [];
    try {
      const checks = await item.run({ ...context, note });
      for (const check of checks ?? []) { note(check.what, `${check.ok ? "ok" : "FAIL"}: ${check.saw}`); if (!check.ok) { pass = false; owners.push(check.owner ?? null); } }
      if (!item.owner && owners.length) owner = owners.every(Boolean) ? owners[0] : null;
    } catch (failure) {
      pass = false;
      error = String(failure?.stack ?? failure).split("\n").slice(0, 4).join(" | ");
    }
    try { shot = await context.driver.shot(`${item.scenario}-${item.id}`); } catch { shot = null; }
    const row = { view: context.view, scenario: item.scenario, id: item.id, action: item.action, expect: item.expect, owner, pass, error, evidence, shot, ms: Date.now() - started };
    this.rows.push(row);
    const failedChecks = evidence.filter(e => e.value.startsWith("FAIL: ")).map(e => `${e.label}: ${e.value.slice(6)}`).join("; ");
    context.log(`${pass ? "PASS" : "FAIL"} ${context.view} ${item.scenario}/${item.id}${error ? ` (${error.slice(0, 200)})` : ""}${failedChecks ? `: ${failedChecks.slice(0, 300)}` : ""}`);
    return row;
  }

  failed() {
    return this.rows.filter(row => !row.pass).length;
  }

  write(log = []) {
    const passed = this.rows.filter(row => row.pass).length;
    const lines = [
      "# Radar panel actions: results",
      "",
      `Radar ${this.builds.radar.commit ?? "?"} (${this.builds.radar.label}), core ${this.builds.core.commit ?? "?"} (${this.builds.core.label}). ${passed} of ${this.rows.length} passed.`,
      "",
      "| View | Scenario | Action | Expected | Result | Evidence | Screenshot |",
      "| --- | --- | --- | --- | --- | --- | --- |",
      ...this.rows.map(row => `| ${row.view} | ${row.scenario} | ${cell(row.action)} | ${cell(row.expect)} | ${row.pass ? "pass" : row.owner ? `FAIL, recorded (${row.owner})` : "FAIL"} | ${cell([row.error, ...row.evidence.map(e => `${e.label}: ${e.value}`)].filter(Boolean).join("; ").slice(0, 900))} | ${row.shot ? `[png](${row.shot})` : ""} |`),
    ];
    writeFileSync(join(this.out, "results.md"), `${lines.join("\n")}\n`);
    writeFileSync(join(this.out, "results.json"), JSON.stringify({ builds: this.builds, rows: this.rows }, null, 2));
    writeFileSync(join(this.out, "run.log"), `${log.join("\n")}\n`);
  }
}

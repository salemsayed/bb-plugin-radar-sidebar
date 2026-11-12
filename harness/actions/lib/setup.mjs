import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { basename, join } from "node:path";
import { sleep } from "./bb.mjs";
import { here } from "./paths.mjs";

const LIVE = join(process.env.HOME, ".bb-machines/salem.getbb.app");
const STAND_INS = ["echo-provider", "judge", "automations"];

function liveRoot(pluginId) {
  const db = new DatabaseSync(join(LIVE, "bb.db"), { readOnly: true });
  try { return db.prepare("SELECT root_dir AS root FROM plugins WHERE id=? AND removed_at IS NULL").get(pluginId)?.root ?? null; } finally { db.close(); }
}

export function resolveBuilds({ radar, core }) {
  const pick = (given, id) => {
    const dir = given ?? liveRoot(id);
    if (!dir || !existsSync(join(dir, "package.json"))) throw new Error(`no ${id} build at ${dir}`);
    const release = existsSync(join(dir, "RELEASE.json")) ? JSON.parse(readFileSync(join(dir, "RELEASE.json"), "utf8")) : null;
    return { dir, commit: release?.commit?.slice(0, 7) ?? null, label: release ? `${basename(join(dir, ".."))}` : dir };
  };
  return { radar: pick(radar, "radar-sidebar"), core: pick(core, "orchestrator-mode"), genui: pick(undefined, "genui") };
}

function liveRadarSettings() {
  const out = execFileSync("bb", ["plugin", "config", "radar-sidebar", "--json"], { encoding: "utf8" });
  const { schema, values } = JSON.parse(out);
  return Object.fromEntries(Object.keys(schema).filter(key => values?.[key] !== undefined).map(key => [key, values[key]]));
}

export class Setup {
  constructor(iso, builds, log) {
    this.iso = iso;
    this.builds = builds;
    this.log = log;
    this.root = iso.config.S;
    if (!/\/bb-tmp\/[^/]+$/.test(this.root)) throw new Error(`refusing to manage ${this.root}: the isolated bb lives under ~/.cache/bb-tmp/<name>`);
  }

  script(name, env = {}) {
    return execFileSync(join(here, name), { encoding: "utf8", env: { ...process.env, ...env } }).trim();
  }

  stop() {
    this.log(this.script("stop.sh"));
  }

  async start(offsetMs = 0, attempt = 1) {
    this.log(this.script("start.sh", { PANEL_CLOCK_OFFSET_MS: String(offsetMs) }));
    const version = this.iso.run(["--version"]).out;
    if (version !== this.iso.config.BB_VERSION) throw new Error(`isolated bb reports ${version}, expected ${this.iso.config.BB_VERSION}`);
    const ready = await this.iso.until("plugins to load", () => !this.installed || /orchestrator-mode@[^\n]*running/.test(this.iso.run(["plugin", "list"], { allowFail: true }).out), 90_000).catch(() => false);
    if (!ready) {
      if (attempt >= 3) throw new Error(`isolated bb did not load its plugins after ${attempt} starts; see ${join(this.root, "logs/bb-app.log")}`);
      this.log(`plugins did not load; starting again (attempt ${attempt + 1})`);
      this.stop();
      return this.start(offsetMs, attempt + 1);
    }
    const threads = this.iso.json(["thread", "list"]);
    const running = (Array.isArray(threads) ? threads : threads.threads ?? []).filter(thread => thread.status === "active").length;
    this.log(`isolated bb ${version} at ${this.iso.url}, clock offset ${offsetMs} ms, ${running} running threads`);
    await sleep(2000);
  }

  async restart(offsetMs) {
    this.stop();
    await this.start(offsetMs);
  }

  wipe() {
    this.installed = false;
    for (const dir of ["data", "tmp", "workspaces", "src", "logs"]) rmSync(join(this.root, dir), { recursive: true, force: true });
    mkdirSync(join(this.root, "src"), { recursive: true });
  }

  copy(from, name) {
    const to = join(this.root, "src", name);
    cpSync(from, to, { recursive: true, filter: source => !/\/(?:\.git)$/.test(source) });
    return to;
  }

  install(dir) {
    const { out } = this.iso.run(["plugin", "install", `path:${dir}`, "--yes"], { timeout: 600_000 });
    this.log(out.split("\n").slice(-2).join(" | "));
  }

  async fresh(offsetMs) {
    this.stop();
    this.wipe();
    await this.start(offsetMs);
    this.install(this.copy(this.builds.genui.dir, "genui"));
    for (const name of STAND_INS) {
      const dir = this.copy(join(here, "stand-ins", name), name);
      execFileSync("npm", ["install", "--no-audit", "--no-fund", "--prefer-offline"], { cwd: dir, stdio: "ignore" });
      this.install(dir);
    }
    this.install(this.copy(this.builds.core.dir, "core"));
    this.install(this.copy(this.builds.radar.dir, "radar"));
    this.installed = true;
    for (const [key, value] of Object.entries(liveRadarSettings())) this.iso.run(["plugin", "config", "radar-sidebar", "set", key, String(value)], { allowFail: true });
    this.iso.run(["saelmbot", "reliability", "on"]);
    this.iso.run(["settings", "general", "onboardingCompletedAt", String(Date.now())]);
    this.iso.run(["plugin", "disable", "bb--github-star"], { allowFail: true });
    await this.restart(offsetMs);
  }
}

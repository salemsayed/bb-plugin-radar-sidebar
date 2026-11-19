import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { launch } from "./browser.mjs";
import { buildHarness } from "./build.mjs";
import { serve } from "./serve.mjs";

const run = promisify(execFile);
const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const DESKTOP = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 };
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true, userAgent: IPHONE_UA };
const FILM_FPS = 12;

const STILLS = [
  { name: "sidebar-desktop", query: "s=busy-crew&view=desktop&panel=closed", device: DESKTOP, clip: { x: 0, y: 0, width: 340, height: 900 } },
  { name: "panel-desktop", query: "s=busy-crew&view=desktop", device: DESKTOP, clip: { x: 0, y: 0, width: 800, height: 900 } },
  { name: "tab-desktop", query: "s=busy-crew&view=desktop&surface=tab", device: DESKTOP, clip: { x: 0, y: 0, width: 720, height: 900 } },
  { name: "tab-phone", query: "s=busy-crew&view=phone&surface=tab", device: PHONE },
  { name: "sidebar-phone", query: "s=busy-crew&view=phone&panel=closed", device: PHONE },
  { name: "panel-phone", query: "s=busy-crew&view=phone", device: PHONE },
  { name: "gallery-desktop", query: "gallery=all", device: DESKTOP, fullPage: true, ready: ".gallery" },
  { name: "gallery-phone", query: "gallery=all", device: PHONE, fullPage: true, ready: ".gallery" },
];
const FILMS = [
  { name: "film-states", query: "gallery=live", device: { viewport: { width: 1340, height: 190 }, deviceScaleFactor: 1 }, seconds: 25, ready: ".gallery" },
  { name: "film-sidebar", query: "s=busy-crew&view=desktop&panel=closed", device: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 }, clip: { x: 48, y: 0, width: 272, height: 760 }, seconds: 8 },
];

function parseArgs(argv) {
  const args = { out: "faces", themes: ["light", "dark"], film: false, stills: true };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out") args.out = argv[++i];
    else if (argv[i] === "--themes") args.themes = argv[++i].split(",");
    else if (argv[i] === "--film") args.film = true;
    else if (argv[i] === "--no-stills") args.stills = false;
    else throw new Error(`Unknown option ${argv[i]}. Options: --out <dir> --themes light,dark --film --no-stills`);
  }
  return args;
}

async function open(browser, origin, shot, theme, reducedMotion, problems) {
  const context = await browser.newContext({ ...shot.device, colorScheme: theme, locale: "en-GB", timezoneId: "Africa/Cairo", reducedMotion });
  const page = await context.newPage();
  page.on("pageerror", error => problems.push(`${shot.name}: ${error.message}`));
  page.on("console", message => { if (message.type() === "error") problems.push(`${shot.name}: ${message.text()}`); });
  await page.goto(`${origin}/?${shot.query}${theme === "dark" ? "&theme=dark" : ""}`);
  await page.waitForSelector(shot.ready ?? "html[data-harness-ready]", { timeout: 15_000 });
  await page.evaluate(() => document.fonts.ready);
  return { context, page };
}

async function film(page, shot, file) {
  const frames = await mkdtemp(join(tmpdir(), "faces-film-"));
  const taken = [];
  const started = Date.now();
  while (Date.now() - started < shot.seconds * 1000) {
    const at = Date.now() - started;
    taken.push({ at, data: await page.screenshot({ type: "png", ...(shot.clip ? { clip: shot.clip } : {}) }) });
    const next = (taken.length) * (1000 / (FILM_FPS * 2));
    const spare = next - (Date.now() - started);
    if (spare > 0) await new Promise(done => setTimeout(done, spare));
  }
  const total = Math.floor(shot.seconds * FILM_FPS);
  let cursor = 0;
  for (let index = 0; index < total; index++) {
    const at = index * 1000 / FILM_FPS;
    while (cursor + 1 < taken.length && taken[cursor + 1].at <= at) cursor++;
    await writeFile(join(frames, `${String(index).padStart(5, "0")}.png`), taken[cursor].data);
  }
  await run("ffmpeg", ["-y", "-loglevel", "error", "-framerate", String(FILM_FPS), "-i", join(frames, "%05d.png"), "-vf", `fps=${FILM_FPS},scale=720:-1:flags=lanczos`, "-loop", "0", "-c:v", "libwebp", "-quality", "82", "-compression_level", "6", file]);
  await rm(frames, { recursive: true, force: true });
  return taken.length;
}

const args = parseArgs(process.argv.slice(2));
const out = resolve(args.out);
await buildHarness();
await mkdir(out, { recursive: true });
const server = await serve();
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await launch();
const problems = [];
const made = [];
try {
  if (args.stills) for (const theme of args.themes) for (const shot of STILLS) {
    const { context, page } = await open(browser, origin, shot, theme, "reduce", problems);
    await page.waitForTimeout(400);
    const file = `${shot.name}${theme === "dark" ? "-dark" : ""}.png`;
    await page.screenshot({ path: join(out, file), ...(shot.clip ? { clip: shot.clip } : {}), fullPage: !!shot.fullPage });
    made.push(file);
    await context.close();
  }
  if (args.film) for (const theme of args.themes) for (const shot of FILMS) {
    const { context, page } = await open(browser, origin, shot, theme, "no-preference", problems);
    await page.waitForTimeout(600);
    const file = `${shot.name}${theme === "dark" ? "-dark" : ""}.webp`;
    const captured = await film(page, shot, join(out, file));
    made.push(`${file} (${captured} captures over ${shot.seconds} s)`);
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}
console.log(`${made.length} files in ${out}:\n${made.join("\n")}`);
if (problems.length) {
  console.error(`${problems.length} page errors:\n${[...new Set(problems)].join("\n")}`);
  process.exitCode = 1;
}

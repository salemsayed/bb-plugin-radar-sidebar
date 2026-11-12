import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import { launch } from "./browser.mjs";
import { buildHarness, dist } from "./build.mjs";

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".map": "application/json" };
const VIEWS = {
  desktop: { viewport: { width: 1280, height: 860 }, deviceScaleFactor: 2, clip: { x: 0, y: 0, width: 760, height: 860 } },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true },
};
const FULL_PANEL = ".dispatch-overlay { position: absolute !important; inset: 0 auto auto 0 !important; width: 100%; height: auto !important; align-items: flex-start !important; } .dispatch-panel { max-height: none !important; height: auto !important; } .dispatch-panel-body { overflow: visible !important; flex: none !important; }";

function parseArgs(argv) {
  const args = { out: "shots", only: [], themes: ["light"], views: Object.keys(VIEWS) };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out") args.out = argv[++i];
    else if (argv[i] === "--only") args.only = argv[++i].split(",");
    else if (argv[i] === "--themes") args.themes = argv[++i].split(",");
    else if (argv[i] === "--views") args.views = argv[++i].split(",");
    else throw new Error(`Unknown option ${argv[i]}. Options: --out <dir> --only <id,id> --themes light,dark --views desktop,phone`);
  }
  return args;
}

function serve() {
  const server = createServer(async (request, response) => {
    const path = new URL(request.url, "http://harness").pathname;
    const file = join(dist, path === "/" ? "index.html" : path);
    try {
      const body = await readFile(file);
      response.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream" }).end(body);
    } catch {
      response.writeHead(404).end();
    }
  });
  return new Promise(done => server.listen(0, "127.0.0.1", () => done(server)));
}

const args = parseArgs(process.argv.slice(2));
const out = resolve(args.out);
await buildHarness();
await mkdir(out, { recursive: true });
const server = await serve();
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await launch();
const problems = [];
const index = [];
try {
  const probe = await browser.newPage();
  await probe.goto(origin);
  const scenarios = await probe.$$eval(".harness-index li", items => items.map(item => ({ id: new URL(item.querySelector("a").href).searchParams.get("s"), title: item.querySelector("b").textContent, look: item.querySelector("span").textContent })));
  await probe.close();
  const wanted = args.only.length ? scenarios.filter(item => args.only.includes(item.id)) : scenarios;
  for (const theme of args.themes) for (const view of args.views) {
    const { clip, ...device } = VIEWS[view];
    const context = await browser.newContext({ ...device, colorScheme: theme, locale: "en-GB", timezoneId: "Africa/Cairo", reducedMotion: "reduce" });
    for (const scenario of wanted) {
      const page = await context.newPage();
      const name = `${scenario.id}-${view}${theme === "dark" ? "-dark" : ""}`;
      page.on("pageerror", error => problems.push(`${name}: ${error.message}`));
      page.on("console", message => { if (message.type() === "error") problems.push(`${name}: ${message.text()}`); });
      await page.goto(`${origin}/?s=${scenario.id}&view=${view}${theme === "dark" ? "&theme=dark" : ""}`);
      await page.waitForSelector("html[data-harness-ready]", { timeout: 15_000 });
      await page.waitForTimeout(250);
      await page.screenshot({ path: join(out, `${name}.png`), ...(clip ? { clip } : {}) });
      const facts = await page.evaluate(() => {
        const body = document.querySelector(".dispatch-panel-body");
        return { scrollHeight: body?.scrollHeight ?? 0, clientHeight: body?.clientHeight ?? 0, text: document.querySelector(".dispatch-panel")?.innerText ?? "" };
      });
      await page.addStyleTag({ content: FULL_PANEL });
      await page.locator(".dispatch-panel").screenshot({ path: join(out, `${name}-full.png`) });
      await writeFile(join(out, `${name}.txt`), `${facts.text}\n`);
      index.push({ ...scenario, view, theme, file: `${name}.png`, full: `${name}-full.png`, screens: Number((facts.scrollHeight / Math.max(1, facts.clientHeight)).toFixed(2)) });
      await page.close();
    }
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}
const indexFile = join(out, "index.json");
const earlier = await readFile(indexFile, "utf8").then(JSON.parse, () => []);
const merged = [...earlier.filter(row => !index.some(fresh => fresh.file === row.file)), ...index];
await writeFile(indexFile, `${JSON.stringify(merged, null, 1)}\n`);
console.log(`${index.length} screenshots in ${out}`);
if (problems.length) {
  console.error(`${problems.length} page errors:\n${[...new Set(problems)].join("\n")}`);
  process.exitCode = 1;
}

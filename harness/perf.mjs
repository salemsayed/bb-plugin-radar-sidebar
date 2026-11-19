import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { launch } from "./browser.mjs";
import { buildHarness } from "./build.mjs";
import { serve } from "./serve.mjs";

const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";
const DESKTOP = { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 };
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, isMobile: true, userAgent: IPHONE_UA };
const SHORT_PHONE = { ...PHONE, viewport: { width: 390, height: 150 } };

const SCENES = [
  { id: "sidebar-desktop", what: "Sidebar with all ten bots, panel closed, 1440 px desktop", query: "s=busy-crew&view=desktop&panel=closed", device: DESKTOP },
  { id: "panel-desktop", what: "Same sidebar with a working bot's panel open, 1440 px desktop", query: "s=busy-crew&view=desktop", device: DESKTOP },
  { id: "sidebar-phone", what: "Sidebar with all ten bots, panel closed, 390 px touch phone", query: "s=busy-crew&view=phone&panel=closed", device: PHONE },
];
const PROBES = [
  { id: "offscreen", what: "Phone sidebar scrolled so every working bot is out of view", query: "s=busy-crew&view=phone&panel=closed", device: SHORT_PHONE, prepare: "scroll-end" },
  { id: "hidden-tab", what: "Desktop sidebar while another tab is in front", query: "s=busy-crew&view=desktop&panel=closed", device: DESKTOP, prepare: "hide" },
  { id: "reduced-motion", what: "Desktop sidebar with prefers-reduced-motion: reduce", query: "s=busy-crew&view=desktop&panel=closed", device: DESKTOP, reducedMotion: "reduce" },
];

const TRACE_CATEGORIES = ["devtools.timeline", "disabled-by-default-devtools.timeline", "disabled-by-default-devtools.timeline.frame", "cc", "benchmark", "blink.animations", "toplevel"];
const SCRIPTING = new Set(["FunctionCall", "EvaluateScript", "v8.compile", "v8.run", "TimerFire", "FireAnimationFrame", "EventDispatch", "RunMicrotasks", "MajorGC", "MinorGC", "V8.GC_MC_BACKGROUND_MARKING", "FireIdleCallback", "v8.callFunction", "IntersectionObserverController::computeIntersections"]);
const STYLE = new Set(["UpdateLayoutTree", "RecalculateStyles", "Document::updateStyle", "Animation"]);
const LAYOUT = new Set(["Layout"]);
const PAINT = new Set(["PrePaint", "Paint", "PaintImage", "Layerize", "UpdateLayer", "UpdateLayerTree", "Commit", "CompositeLayers"]);

function parseArgs(argv) {
  const args = { out: "perf.json", label: "run", runs: 3, seconds: 8, names: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out") args.out = argv[++i];
    else if (argv[i] === "--label") args.label = argv[++i];
    else if (argv[i] === "--runs") args.runs = Number(argv[++i]);
    else if (argv[i] === "--seconds") args.seconds = Number(argv[++i]);
    else if (argv[i] === "--names") args.names = true;
    else throw new Error(`Unknown option ${argv[i]}. Options: --out <file.json> --label <name> --runs <n> --seconds <n> --names`);
  }
  return args;
}

const wait = ms => new Promise(done => setTimeout(done, ms));
const round = (value, digits = 2) => Number(value.toFixed(digits));

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

async function pageMetrics(session) {
  const { metrics } = await session.send("Performance.getMetrics");
  return Object.fromEntries(metrics.map(metric => [metric.name, metric.value]));
}

async function processCpu(browserSession) {
  const { processInfo } = await browserSession.send("SystemInfo.getProcessInfo");
  const byType = {};
  for (const info of processInfo) byType[info.type] = (byType[info.type] ?? 0) + info.cpuTime;
  return byType;
}

function inventory() {
  const skip = new Set(["offset", "easing", "composite", "computedOffset"]);
  const describe = element => {
    const owner = element.closest?.(".stage-row, .radar-rail-bot, .bot-hero, .dispatch-panel");
    const cls = typeof element.className === "string" ? element.className : element.className?.baseVal ?? "";
    return `${element.tagName.toLowerCase()}${cls ? `.${cls.trim().split(/\s+/).join(".")}` : ""}${owner?.dataset?.bot ? ` @${owner.dataset.bot}` : owner ? ` @${owner.className.toString().split(" ")[0]}` : ""}`;
  };
  return document.getAnimations().map(animation => {
    const target = animation.effect?.target;
    const box = target?.getBoundingClientRect();
    const timing = animation.effect?.getTiming() ?? {};
    return {
      name: animation.animationName ?? `transition:${animation.transitionProperty}`,
      state: animation.playState,
      target: target ? describe(target) : "",
      pseudo: animation.effect?.pseudoElement ?? null,
      properties: [...new Set((animation.effect?.getKeyframes() ?? []).flatMap(frame => Object.keys(frame)))].filter(key => !skip.has(key)),
      durationMs: Number(timing.duration) || 0,
      endless: timing.iterations === Infinity,
      insideSvg: target instanceof SVGElement && target.ownerSVGElement !== null,
      inViewport: !!box && box.bottom > 0 && box.top < innerHeight && box.right > 0 && box.left < innerWidth && box.width > 0,
    };
  });
}

function summarizeTrace(events, seconds) {
  const mainThreads = new Set(events.filter(event => event.ph === "M" && event.name === "thread_name" && event.args?.name === "CrRendererMain").map(event => `${event.pid}:${event.tid}`));
  const start = Math.min(...events.filter(event => event.ts > 0).map(event => event.ts));
  const end = Math.max(...events.filter(event => event.ts > 0).map(event => event.ts + (event.dur ?? 0)));
  const span = (end - start) / 1e6;
  const self = { scripting: 0, style: 0, layout: 0, paint: 0, other: 0 };
  const counts = {};
  const names = {};
  const bump = (name, by = 1) => { counts[name] = (counts[name] ?? 0) + by; };
  let rasterMs = 0;
  const complete = events.filter(event => event.ph === "X" && mainThreads.has(`${event.pid}:${event.tid}`)).sort((a, b) => a.ts - b.ts || b.dur - a.dur);
  const stack = [];
  const close = frame => {
    const own = (frame.event.dur - frame.children) / 1000;
    const name = frame.event.name;
    const bucket = SCRIPTING.has(name) ? "scripting" : STYLE.has(name) ? "style" : LAYOUT.has(name) ? "layout" : PAINT.has(name) ? "paint" : "other";
    self[bucket] += own;
    names[name] = round((names[name] ?? 0) + own, 3);
  };
  for (const event of complete) {
    while (stack.length && stack.at(-1).event.ts + stack.at(-1).event.dur <= event.ts) close(stack.pop());
    if (stack.length) stack.at(-1).children += event.dur;
    stack.push({ event, children: 0 });
    if (["UpdateLayoutTree", "Layout", "PrePaint", "Paint", "Layerize", "Commit"].includes(event.name)) bump(event.name);
  }
  while (stack.length) close(stack.pop());
  for (const event of events) {
    if (event.name === "RasterTask" && event.ph === "X") { bump("RasterTask"); rasterMs += event.dur / 1000; }
    if (event.name === "BeginMainThreadFrame") bump("BeginMainThreadFrame");
    if (event.name === "DrawFrame") bump("DrawFrame");
    if (event.name === "ActivateLayerTree") bump("ActivateLayerTree");
  }
  const perSecond = value => round(value / span);
  return {
    traceSeconds: round(span),
    requestedSeconds: seconds,
    mainThreadMsPerSecond: { scripting: perSecond(self.scripting), style: perSecond(self.style), layout: perSecond(self.layout), paint: perSecond(self.paint), other: perSecond(self.other), total: perSecond(self.scripting + self.style + self.layout + self.paint + self.other) },
    rasterMsPerSecond: perSecond(rasterMs),
    perSecond: Object.fromEntries(["UpdateLayoutTree", "Layout", "PrePaint", "Paint", "Layerize", "Commit", "BeginMainThreadFrame", "RasterTask", "ActivateLayerTree", "DrawFrame"].map(name => [name, perSecond(counts[name] ?? 0)])),
    names,
  };
}

async function trace(session, seconds) {
  const events = [];
  const onData = chunk => { events.push(...chunk.value); };
  session.on("Tracing.dataCollected", onData);
  const finished = new Promise(done => session.once("Tracing.tracingComplete", done));
  await session.send("Tracing.start", { traceConfig: { includedCategories: TRACE_CATEGORIES }, transferMode: "ReportEvents" });
  await wait(seconds * 1000);
  await session.send("Tracing.end");
  await finished;
  session.off("Tracing.dataCollected", onData);
  return events;
}

async function layerFacts(session) {
  let layers = [];
  const onChange = event => { if (event.layers) layers = event.layers; };
  session.on("LayerTree.layerTreeDidChange", onChange);
  await session.send("LayerTree.enable");
  await wait(600);
  const drawn = layers.filter(layer => layer.drawsContent);
  const reasons = {};
  for (const layer of drawn) {
    const { compositingReasonIds = [] } = await session.send("LayerTree.compositingReasons", { layerId: layer.layerId }).catch(() => ({}));
    for (const reason of compositingReasonIds) reasons[reason] = (reasons[reason] ?? 0) + 1;
  }
  await session.send("LayerTree.disable");
  session.off("LayerTree.layerTreeDidChange", onChange);
  return { layers: layers.length, drawingLayers: drawn.length, drawingLayerPixels: drawn.reduce((sum, layer) => sum + layer.width * layer.height, 0), reasons };
}

async function measure(browser, browserSession, origin, scene, seconds, withNames) {
  const context = await browser.newContext({ ...scene.device, colorScheme: "light", locale: "en-GB", timezoneId: "Africa/Cairo", reducedMotion: scene.reducedMotion ?? "no-preference" });
  const page = await context.newPage();
  const problems = [];
  page.on("pageerror", error => problems.push(error.message));
  await page.goto(`${origin}/?${scene.query}`);
  await page.waitForSelector("html[data-harness-ready]", { timeout: 15_000 });
  if (scene.prepare === "scroll-end") await page.evaluate(() => { const box = document.querySelector(".harness-sidebar"); box.scrollTop = box.scrollHeight; });
  let front = null;
  if (scene.prepare === "hide") { front = await context.newPage(); await front.goto("about:blank"); await front.bringToFront(); }
  await wait(2000);
  const session = await context.newCDPSession(page);
  await session.send("Performance.enable");
  const animations = await page.evaluate(inventory);
  const visibility = await page.evaluate(() => document.visibilityState);
  const layers = front ? null : await layerFacts(session);
  const [metricsBefore, cpuBefore] = [await pageMetrics(session), await processCpu(browserSession)];
  const startedAt = Date.now();
  await wait(seconds * 1000);
  const [metricsAfter, cpuAfter] = [await pageMetrics(session), await processCpu(browserSession)];
  const elapsed = (Date.now() - startedAt) / 1000;
  const delta = name => (metricsAfter[name] - metricsBefore[name]) / elapsed;
  const cpu = type => ((cpuAfter[type] ?? 0) - (cpuBefore[type] ?? 0)) * 1000 / elapsed;
  const quiet = {
    seconds: round(elapsed),
    styleRecalcsPerSecond: round(delta("RecalcStyleCount")),
    layoutsPerSecond: round(delta("LayoutCount")),
    styleMsPerSecond: round(delta("RecalcStyleDuration") * 1000),
    layoutMsPerSecond: round(delta("LayoutDuration") * 1000),
    scriptMsPerSecond: round(delta("ScriptDuration") * 1000),
    mainThreadTaskMsPerSecond: round(delta("TaskDuration") * 1000),
    cpuMsPerSecond: { renderer: round(cpu("renderer")), gpu: round(cpu("GPU")), browser: round(cpu("browser")), all: round(cpu("renderer") + cpu("GPU") + cpu("browser")) },
  };
  const traced = summarizeTrace(await trace(session, seconds), seconds);
  if (!withNames) delete traced.names;
  await context.close();
  return { visibility, animations, layers, quiet, traced, problems };
}

function fold(runs) {
  const pick = path => median(runs.map(run => path.split(".").reduce((value, key) => value?.[key], run)).filter(value => typeof value === "number"));
  const running = runs[0].animations.filter(animation => animation.state === "running");
  const layers = runs[0].layers;
  return {
    visibility: runs[0].visibility,
    animationsRunning: running.length,
    animationsRunningEndless: running.filter(animation => animation.endless).length,
    animationsRunningInsideSvg: running.filter(animation => animation.insideSvg).length,
    animationsRunningOutOfView: running.filter(animation => !animation.inViewport).length,
    layers: layers ? { total: layers.layers, drawing: layers.drawingLayers, drawingPixels: layers.drawingLayerPixels } : null,
    mainThreadMsPerSecond: Object.fromEntries(["scripting", "style", "layout", "paint", "other", "total"].map(key => [key, pick(`traced.mainThreadMsPerSecond.${key}`)])),
    rasterMsPerSecond: pick("traced.rasterMsPerSecond"),
    perSecond: Object.fromEntries(Object.keys(runs[0].traced.perSecond).map(key => [key, pick(`traced.perSecond.${key}`)])),
    untraced: {
      styleRecalcsPerSecond: pick("quiet.styleRecalcsPerSecond"),
      layoutsPerSecond: pick("quiet.layoutsPerSecond"),
      styleMsPerSecond: pick("quiet.styleMsPerSecond"),
      scriptMsPerSecond: pick("quiet.scriptMsPerSecond"),
      mainThreadTaskMsPerSecond: pick("quiet.mainThreadTaskMsPerSecond"),
      cpuMsPerSecond: Object.fromEntries(["renderer", "gpu", "browser", "all"].map(key => [key, pick(`quiet.cpuMsPerSecond.${key}`)])),
    },
  };
}

const args = parseArgs(process.argv.slice(2));
await buildHarness();
const server = await serve();
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await launch();
const browserSession = await browser.newBrowserCDPSession();
const result = { label: args.label, measuredAt: new Date().toISOString(), chrome: browser.version(), runs: args.runs, secondsPerPass: args.seconds, method: "Headless Chrome on solom-dedi over the harness scene busy-crew. Each run idles 2 s, then one untraced pass (Performance.getMetrics and SystemInfo.getProcessInfo deltas) and one traced pass (main-thread self time by category, raster tasks, frames). Figures are medians of the runs, per second of idling with animations on.", scenes: {}, probes: {}, raw: {} };
try {
  for (const [group, list] of [["scenes", SCENES], ["probes", PROBES]]) {
    for (const scene of list) {
      const runs = [];
      for (let run = 0; run < (group === "scenes" ? args.runs : 1); run++) runs.push(await measure(browser, browserSession, origin, scene, group === "scenes" ? args.seconds : Math.min(args.seconds, 5), args.names));
      result[group][scene.id] = { what: scene.what, ...fold(runs) };
      result.raw[scene.id] = runs;
      const folded = result[group][scene.id];
      console.log(`${scene.id}: ${folded.animationsRunning} running animations (${folded.animationsRunningInsideSvg} inside SVG, ${folded.animationsRunningOutOfView} out of view), main thread ${folded.mainThreadMsPerSecond.total} ms/s, style recalcs ${folded.untraced.styleRecalcsPerSecond}/s, paints ${folded.perSecond.Paint}/s, main frames ${folded.perSecond.BeginMainThreadFrame}/s, raster ${folded.rasterMsPerSecond} ms/s, CPU ${folded.untraced.cpuMsPerSecond.all} ms/s, layers ${folded.layers?.total ?? "n/a"}`);
    }
  }
} finally {
  await browser.close();
  server.close();
}
const out = resolve(args.out);
await mkdir(dirname(out), { recursive: true });
await writeFile(out, `${JSON.stringify(result, null, 1)}\n`);
console.log(`Saved ${out}`);

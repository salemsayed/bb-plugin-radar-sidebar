import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sleep } from "./bb.mjs";
import { Bot, chip } from "./seed.mjs";
import { Driver } from "./panel.mjs";
import { CASES } from "./cases.mjs";
import { SCENARIOS } from "./world.mjs";

const MODES = ["idle", "busy", "reconnected"];
const VIEWS = ["desktop", "phone"];
const METRICS = ["typing", "receipt", "result"];

async function prepareState(driver, bot, mode) {
  const { iso } = driver;
  if (mode === "reconnected") {
    await driver.context.setOffline(true);
    await sleep(600);
    await driver.context.setOffline(false);
  }
  if (mode === "busy") {
    iso.run(["thread", "tell", bot.coordinator, "delay:8000 speed check"], { thread: await iso.relay() });
    await iso.until("active coordinator", () => iso.thread(bot.coordinator).status === "active");
  }
}

async function measure(driver, bot, taskId, chipSeq, mode, index) {
  const { page, iso } = driver;
  await driver.home();
  await driver.sidebar(bot.key);
  await prepareState(driver, bot, mode);
  const marker = `Speed receipt ${driver.view} ${mode} ${index}`;
  let start = performance.now();
  await driver.press(page.locator(`.stage-chat[data-rove="${bot.key}"]`));
  await page.waitForURL(url => url.pathname.endsWith(bot.coordinator));
  const editor = page.locator('[data-scroll-footer] [contenteditable="true"]:visible').last();
  await editor.fill(marker);
  assert.equal(await editor.innerText(), marker);
  const typing = Math.round(performance.now() - start);

  start = performance.now();
  const send = page.locator(mode === "busy" ? '[data-scroll-footer] button:is([title^="Queue"], [aria-label^="Queue"]):visible' : '[data-scroll-footer] button:is([title^="Submit"], [aria-label^="Submit"]):visible').last();
  if (mode === "busy") await send.waitFor({ state: "visible", timeout: 3500 });
  await page.evaluate(text => {
    const stamp = () => Math.round(performance.timeOrigin + performance.now());
    const sample = { armedAt: stamp() };
    window.sendSample = sample;
    function frame() {
      const nodes = document.evaluate('//*[text()="' + text + '"]', document.body, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
      for (let index = 0; index < nodes.snapshotLength; index++) {
        const node = nodes.snapshotItem(index);
        const box = node.getBoundingClientRect();
        if (node.closest('[contenteditable], textarea, script, style') || !box.height || box.top >= innerHeight || box.bottom <= 0) continue;
        const x = Math.max(0, Math.min(innerWidth - 1, box.left + box.width / 2));
        const y = (Math.max(0, box.top) + Math.min(innerHeight, box.bottom)) / 2;
        if (node.contains(document.elementFromPoint(x, y))) {
          sample.visibleAt = stamp();
          return;
        }
      }
      requestAnimationFrame(frame);
    }
    document.addEventListener("pointerdown", () => {
      sample.downAt = stamp();
      requestAnimationFrame(frame);
    }, { once: true, capture: true });
    document.addEventListener("click", () => { sample.clickAt = stamp(); }, { once: true, capture: true });
  }, marker);
  if (driver.phone) await send.tap();
  else await send.click();
  const sendTapMs = Math.round(performance.now() - start);
  await page.waitForFunction(text => Array.from(document.querySelectorAll("body *")).some(node =>
    node.childElementCount === 0 && node.textContent.trim() === text && !node.closest("[contenteditable], textarea, script, style") && node.getBoundingClientRect().height > 0
  ), marker, { timeout: 15000 });
  const receipt = Math.round(performance.now() - start);
  await page.waitForFunction(() => window.sendSample?.visibleAt, null, { timeout: 10000 });
  const sendSample = await page.evaluate(() => window.sendSample);
  if (mode === "busy") {
    const queued = await iso.until("durable queue receipt", () => {
      const rows = iso.query("SELECT created_at FROM queued_thread_messages WHERE thread_id=? AND instr(content,?)>0", bot.coordinator, marker);
      return rows.length ? rows : null;
    }, 4000, 30);
    assert.equal(queued.length, 1);
    sendSample.acceptedAt = queued[0].created_at;
    assert.equal(iso.thread(bot.coordinator).status, "active", "Queue receipt appeared after the active turn ended");
    const queue = page.getByText("Queue", { exact: true }).last();
    assert.ok(await queue.evaluate(node => {
      const box = node.getBoundingClientRect();
      const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
      return hit && node.contains(hit);
    }), "The queue indicator is obscured");
  }
  if (mode === "busy" && index === 0) await page.screenshot({ path: join(driver.dir, driver.view + "-queue.png") });
  const delivered = () => iso.messages(bot.coordinator).filter(message => message.from === "salem" && message.text === marker);
  await iso.until("message delivered", () => delivered().length, 30000);
  sendSample.acceptedAt ??= delivered()[0].at;
  assert.ok(sendSample.downAt && sendSample.visibleAt >= sendSample.downAt && sendSample.acceptedAt >= sendSample.downAt);
  await iso.idle(bot.coordinator);

  await page.goto(`${iso.url}/projects/${bot.project}/threads/${bot.coordinator}#msg=${chipSeq}`, { waitUntil: "domcontentloaded" });
  await driver.settle();
  const button = page.locator(`button.tv2-chip[data-task-id="${taskId}"]`).last();
  await button.scrollIntoViewIfNeeded();
  await prepareState(driver, bot, mode);
  start = performance.now();
  await driver.press(button);
  const sheet = page.getByRole("dialog").filter({ has: page.locator(".tv2-info") });
  await sheet.getByText("Speed fixture completed.", { exact: false }).first().waitFor({ state: "visible", timeout: 10000 });
  const result = Math.round(performance.now() - start);
  if (mode === "idle" && index === 0) await page.screenshot({ path: join(driver.dir, driver.view + "-result.png") });
  await page.keyboard.press("Escape");
  await driver.reload();
  await iso.idle(bot.coordinator);
  assert.equal(delivered().length, 1);
  return { view: driver.view, mode, index, typing, receipt, result, sendTapMs, sendSample };
}

async function measureSavedReply(driver, bot, text) {
  await driver.home();
  await driver.sidebar(bot.key);
  const row = driver.page.locator(`.stage-chat[data-rove="${bot.key}"]`);
  await row.evaluate((button, { threadId, text }) => {
    button.addEventListener("pointerdown", () => {
      const start = performance.now();
      const check = () => {
        if (location.pathname.endsWith("/" + threadId)) {
          for (const paragraph of document.querySelectorAll("[data-markdown-preview] p")) {
            if (paragraph.textContent.trim() !== text) continue;
            const box = paragraph.getBoundingClientRect();
            const hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
            if (hit && paragraph.contains(hit)) {
              window.savedReplyMs = performance.now() - start;
              return;
            }
          }
        }
        requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    }, { once: true, capture: true });
  }, { threadId: bot.coordinator, text });
  await driver.press(row);
  const result = await driver.page.waitForFunction(() => window.savedReplyMs ?? false, null, { timeout: 12000 });
  return Math.round(await result.jsonValue());
}

function summarize(rows) {
  const stats = {};
  for (const view of VIEWS) for (const metric of METRICS) {
    const sorted = rows.filter(row => row.view === view).map(row => row[metric]).sort((a, b) => a - b);
    stats[view + "-" + metric] = { median: sorted[Math.floor(sorted.length / 2)], p90: sorted[Math.ceil(sorted.length * 0.9) - 1] };
  }
  return stats;
}

export async function speedGate({ iso, setup, builds, out, log }) {
  const baseline = JSON.parse(readFileSync(new URL("./speed-baseline.json", import.meta.url)));
  const rows = [];
  try {
    await setup.fresh(0);
    iso.run(["settings", "general", "steerActiveThreadOnEnter", "false"]);
    const bot = await Bot.register(iso, { key: "speed", name: "Speed Bot" });
    const id = await bot.task({ ask: "Prepare the speed fixture", title: "Speed fixture" });
    await bot.finish(id, "Speed fixture completed.");
    const chipSeq = await bot.say(chip(id));
    for (const view of VIEWS) {
      const driver = await Driver.open(iso, view, out, log);
      try {
        for (let index = 0; index < 3; index++) for (const mode of MODES) {
          const row = await measure(driver, bot, id, chipSeq, mode, index);
          rows.push(row);
          log(JSON.stringify(row));
        }
      } catch (error) {
        await driver.page.screenshot({ path: join(out, view + "-failure.png") });
        throw error;
      } finally { await driver.close(); }
    }
    const stats = summarize(rows);
    writeFileSync(join(out, "speed.json"), JSON.stringify({ core: builds.core.commit, radar: builds.radar.commit, rows, stats }, null, 2));
    log("Browser interaction timings in milliseconds " + JSON.stringify(stats));
    for (const [key, sample] of Object.entries(stats)) for (const percentile of ["median", "p90"]) {
      const limit = baseline.stats[key][percentile] * 1.5 + 250;
      assert.ok(sample[percentile] <= limit, `${key} ${percentile}: ${sample[percentile]} ms exceeds ${limit} ms`);
    }
    const messages = iso.messages(bot.coordinator);
    const reply = messages.filter(message => message.from === "bot").at(-1);
    assert.match(reply?.text ?? "", /^Response to: Speed receipt/);
    const transcript = { messages: messages.length, seq: reply.seq, views: {} };
    for (const view of VIEWS) {
      const driver = await Driver.open(iso, view, out, log);
      const samples = [];
      try {
        for (let run = 0; run < 5; run++) samples.push(await measureSavedReply(driver, bot, reply.text));
      } finally { await driver.close(); }
      const sorted = [...samples].sort((a, b) => a - b);
      const median = sorted[2];
      transcript.views[view] = { samples, median };
      writeFileSync(join(out, "transcript.json"), JSON.stringify(transcript, null, 2));
      log(view + " saved reply visible in " + median + " ms (median)");
      const limit = baseline.transcript.medianMs[view] * 1.5 + 250;
      assert.ok(median <= limit, `${view} saved reply median: ${median} ms exceeds ${limit} ms`);
    }
    const answers = {};
    const scenario = SCENARIOS.find(item => item.key === "buttons");
    const answer = CASES.find(item => item.scenario === "buttons" && item.id === "answer");
    for (const view of VIEWS) {
      const owner = await Bot.register(iso, { key: "answer-" + view, name: "Answer " + view + " Bot" });
      const world = {};
      await scenario.now(owner, world);
      const driver = await Driver.open(iso, view, out, log);
      try {
        answers[view] = await answer.run({ driver, iso, bot: owner, world });
        for (const check of answers[view]) assert.ok(check.ok, `${view} ${check.what}: ${check.saw}`);
        log(view + " answered question remained closed after reload");
      } finally { await driver.close(); }
    }
    writeFileSync(join(out, "speed.json"), JSON.stringify({ core: builds.core.commit, radar: builds.radar.commit, rows, stats, answers, transcript }, null, 2));
  } finally { setup.stop(); }
}

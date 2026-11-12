import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { sleep } from "./bb.mjs";
import { launch } from "../../browser.mjs";

const VIEWS = {
  desktop: { viewport: { width: 1400, height: 900 } },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1" },
};

export class Driver {
  static async open(iso, view, dir, log) {
    mkdirSync(dir, { recursive: true });
    const browser = await launch();
    const context = await browser.newContext(VIEWS[view]);
    const page = await context.newPage();
    const driver = Object.assign(new Driver(), { iso, view, dir, log, browser, context, page, errors: [], shots: 0 });
    page.on("pageerror", error => driver.errors.push(String(error).slice(0, 300)));
    await driver.home();
    return driver;
  }

  get phone() {
    return this.view === "phone";
  }

  async close() {
    await this.browser.close();
  }

  async press(locator, attempt = 1) {
    try {
      await locator.scrollIntoViewIfNeeded();
      if (this.phone) await locator.tap();
      else await locator.click();
    } catch (error) {
      if (attempt >= 3 || !/not attached|detached/i.test(String(error))) throw error;
      await sleep(400);
      await this.press(locator, attempt + 1);
    }
  }

  async double(locator) {
    await locator.scrollIntoViewIfNeeded();
    const box = await locator.boundingBox();
    const x = box.x + box.width / 2, y = box.y + box.height / 2;
    if (this.phone) { await this.page.touchscreen.tap(x, y); await sleep(120); await this.page.touchscreen.tap(x, y); }
    else await this.page.mouse.dblclick(x, y);
  }

  async rightPanelClosed() {
    const open = () => this.page.locator('button[aria-label="Show thread info panel"]:visible').count().then(n => n > 0);
    for (let attempt = 0; attempt < 3 && await open(); attempt++) {
      const hide = this.page.locator('button[aria-label^="Hide right panel"]:visible').last();
      await (this.phone ? hide.tap({ force: true, timeout: 3_000 }) : hide.click({ force: true, timeout: 3_000 })).catch(() => undefined);
      await sleep(600);
    }
  }

  async home() {
    await this.page.goto(this.iso.url, { waitUntil: "domcontentloaded" });
    await this.settle();
  }

  async settle() {
    const skip = this.page.getByText("Skip setup", { exact: true });
    const bots = this.page.locator(".stage-chat").first();
    await skip.or(bots).first().waitFor({ state: "visible", timeout: 30_000 }).catch(() => undefined);
    if (await skip.isVisible().catch(() => false)) await skip.click();
    await bots.waitFor({ state: "attached", timeout: 30_000 }).catch(() => undefined);
    await sleep(1500);
  }

  async sidebar(key) {
    const row = key ? this.page.locator(`.stage-chat[data-rove="${key}"]`) : this.page.locator(".stage-chat").first();
    await row.waitFor({ state: "attached", timeout: 30_000 });
    if (!this.phone) return;
    const hidden = () => row.evaluate(node => {
      if (node.closest("[inert]")) return true;
      node.scrollIntoView({ block: "center" });
      const box = node.getBoundingClientRect();
      const x = box.left + box.width / 2, y = box.top + box.height / 2;
      if (x <= 0 || x >= innerWidth || y <= 0 || y >= innerHeight) return true;
      const hit = document.elementFromPoint(x, y);
      return !hit || !node.parentElement.contains(hit);
    });
    if (!await hidden()) return;
    await this.press(this.page.getByRole("button", { name: /^Toggle sidebar/ }).first());
    await this.iso.until("the sidebar to open", async () => !await hidden(), 10_000, 300);
    await sleep(500);
  }

  botRow(key) {
    return this.page.locator(`.stage-chat[data-rove="${key}"]`).locator("xpath=..");
  }

  async openPanel(bot) {
    if (await this.panel().isVisible().catch(() => false)) await this.closePanel();
    await this.rightPanelClosed();
    await this.sidebar(bot.key);
    const row = this.botRow(bot.key);
    await row.waitFor({ state: "visible", timeout: 20_000 });
    if (this.phone) await this.press(row.locator(".stage-more"));
    else { await row.hover(); await row.locator(".stage-more").click(); }
    await this.panel().waitFor({ state: "visible", timeout: 10_000 });
    await sleep(this.phone ? 700 : 300);
    return this.panel();
  }

  panel() {
    return this.page.locator(".dispatch-panel").first();
  }

  item(key) {
    return this.panel().locator(`[data-item="${key}"]`).first();
  }

  async closePanel() {
    const overlay = this.page.locator(".dispatch-overlay");
    const close = this.panel().locator(".dispatch-close");
    if (await close.isVisible().catch(() => false)) await this.press(close);
    if (await overlay.waitFor({ state: "detached", timeout: 3_000 }).then(() => false, () => true)) await this.page.keyboard.press("Escape");
    await overlay.waitFor({ state: "detached", timeout: 5_000 }).catch(() => undefined);
  }

  async state() {
    if (!await this.panel().isVisible().catch(() => false)) return null;
    return this.panel().evaluate(panel => ({
      tally: [...panel.querySelectorAll(".panel-tally-part")].map(part => ({ group: part.dataset.group, text: part.textContent.trim() })),
      quiet: panel.querySelector(".panel-tally-quiet")?.textContent.trim() ?? null,
      items: [...panel.querySelectorAll("[data-item]")].map(node => ({
        key: node.dataset.item,
        group: node.closest("[data-group]")?.dataset.group ?? null,
        mark: node.dataset.mark ?? null,
        old: node.dataset.old !== undefined,
        text: node.innerText.replace(/\s+/g, " ").trim().slice(0, 240),
        answers: [...node.querySelectorAll(".radar-answer")].map(b => b.innerText.replace(/\s+/g, " ").trim()),
        buttons: [...node.querySelectorAll("button")].map(b => b.getAttribute("aria-label") || b.innerText.trim()).filter(Boolean),
      })),
      sections: [...panel.querySelectorAll(".panel-section")].map(section => ({ group: section.dataset.group, head: section.querySelector(".panel-section-head")?.textContent.trim() })),
    }));
  }

  async where(key) {
    const state = await this.state();
    return state?.items.find(item => item.key === key) ?? null;
  }

  location() {
    const url = new URL(this.page.url());
    return { thread: /\/threads\/(thr_[a-z0-9]+)/.exec(url.pathname)?.[1] ?? null, msg: /msg=(\d+)/.exec(url.hash)?.[1] ? Number(/msg=(\d+)/.exec(url.hash)[1]) : null, path: url.pathname + url.hash };
  }

  async composer() {
    const box = this.page.locator('[contenteditable="true"]').last();
    if (!await box.isVisible().catch(() => false)) return null;
    return box.evaluate(node => ({ text: node.innerText.replace(/\s+/g, " ").trim(), chips: [...node.querySelectorAll("[data-mention], .mention, [data-type='mention'], [data-mention-kind]")].map(chip => chip.textContent.trim()) }));
  }

  async strip() {
    await this.sidebar();
    return this.page.locator(".stage-needs").first().evaluate(node => [...node.querySelectorAll("li[data-need]")].map(li => ({
      id: li.dataset.need, state: li.dataset.state ?? null, kind: li.querySelector(".stage-needs-item")?.dataset.kind ?? null,
      text: li.innerText.replace(/\s+/g, " ").trim().slice(0, 200), buttons: [...li.querySelectorAll("button")].map(b => b.getAttribute("aria-label") || b.innerText.trim()).filter(Boolean),
    }))).catch(() => []);
  }

  async stripOpen() {
    await this.sidebar();
    const more = this.page.locator(".stage-needs .stage-needs-more-pill, .stage-needs .stage-needs-arrival").first();
    if (await more.isVisible().catch(() => false)) { await this.press(more); await sleep(600); }
  }

  async typeInChat(projectId, threadId, text) {
    await this.page.goto(`${this.iso.url}/projects/${projectId}/threads/${threadId}`, { waitUntil: "domcontentloaded" });
    await this.settle();
    const box = this.page.locator('[contenteditable="true"]').last();
    await box.waitFor({ state: "visible", timeout: 20_000 });
    await box.click();
    await this.page.keyboard.type(text);
    await this.submit();
  }

  async submit() {
    if (!this.phone) { await this.page.keyboard.press("Enter"); return; }
    await this.press(this.page.getByRole("button", { name: /^Submit/ }).last());
  }

  async reload() {
    await this.page.reload({ waitUntil: "domcontentloaded" });
    await this.settle();
  }

  async shot(name) {
    const file = join(this.dir, `${String(++this.shots).padStart(3, "0")}-${name}.png`);
    await this.page.screenshot({ path: file });
    return file;
  }
}

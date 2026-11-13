import { sleep } from "./bb.mjs";
import { chip } from "./seed.mjs";

const check = (what, ok, saw) => ({ what, ok: !!ok, saw: typeof saw === "string" ? saw : JSON.stringify(saw) });
const short = text => (text ?? "").replace(/\s+/g, " ").slice(0, 160);

async function poll(fn, ms = 20_000, every = 500) {
  const until = Date.now() + ms;
  let value;
  while (Date.now() < until) {
    value = await fn();
    if (value) return value;
    await sleep(every);
  }
  return value;
}

function salemSince(iso, threadId, afterSeq) {
  return iso.messages(threadId, afterSeq).filter(message => message.from === "salem");
}

function boundTo(message, itemId) {
  return message.mentions.some(mention => mention.resource?.itemId === itemId || `${mention.resource?.kind}:${mention.resource?.itemId}`.endsWith(itemId));
}

async function navigatedTo(driver, threadId, msg) {
  const at = await poll(() => { const here = driver.location(); return here.thread === threadId ? here : null; }, 15_000);
  const here = at ?? driver.location();
  return [check(`opens ${threadId}${msg ? ` at message ${msg}` : ""}`, here.thread === threadId && (msg === undefined || here.msg === msg), here.path)];
}

async function sentAnswer({ iso, bot }, after, text, itemId) {
  const found = await poll(() => salemSince(iso, bot.coordinator, after).find(message => message.text.includes(text)), 25_000);
  return [
    check(`message "${text}" lands in the bot's chat as Salem's`, found && found.from === "salem", found ? `#${found.seq} ${found.from}: ${short(found.text)}` : `none after #${after}`),
    check(`it is bound to ${itemId}`, found && boundTo(found, itemId), found ? found.mentions.map(m => m.resource?.itemId ?? m.label) : []),
  ];
}

async function coreRow(bot, id, test, ms = 30_000) {
  return poll(() => { const row = bot.row(id); return row && test(row) ? row : null; }, ms) ?? bot.row(id);
}

async function panelGroup(driver, bot, key, reload = false) {
  if (reload) await driver.reload();
  await driver.openPanel(bot);
  return driver.where(key);
}

async function groupIs(driver, bot, key, group, label, reload = false) {
  const item = await poll(async () => { const found = await panelGroup(driver, bot, key, reload); return (found?.group ?? null) === group ? found : null; }, reload ? 20_000 : 12_000, 1_500) ?? await driver.where(key);
  return check(`${label}: ${key} shows in ${group ?? "nothing"}`, (item?.group ?? null) === group, item ? `${item.group}: ${item.text}` : "not in the panel");
}

async function outOfNeeds(driver, bot, key, label) {
  const item = await poll(async () => { const found = await panelGroup(driver, bot, key); return found && found.group !== "needs" && found.group !== "later" ? found : null; }, 12_000, 1_500) ?? await driver.where(key);
  return check(`${label}: ${key} left Needs you`, !!item && item.group !== "needs" && item.group !== "later", item ? `${item.group}: ${item.text}` : "not in the panel");
}

const deskKey = (iso, bot, threadId) => `desk:${iso.bot(bot.key).desks.find(desk => desk.threadId === threadId)?.id}`;

function notNowKeys(iso) {
  const out = iso.botTasks();
  if (!out.questions) return (out.notNow ?? []).map(entry => entry.key);
  return out.questions.filter(q => q.state === "later").flatMap(q => [q.taskId && !q.interactionId ? `task:${q.taskId}` : null, q.interactionId ? `form:${q.interactionId}` : null,
    q.deskId ? `desk:${q.deskId}` : null, q.needId ? `task:${q.needId}` : null, `question:${q.id}`].filter(Boolean));
}

function savedQuestion(iso, bot, seq) {
  const records = iso.records();
  if (!records) {
    const item = iso.needs().find(i => i.bot === bot.key && i.source.messageId === `message:${seq}`);
    return item ? { id: item.id, state: item.state, closed: !["open", "reminded"].includes(item.state), itemKey: `task:${item.id}`, bindId: `question:${item.id}` } : null;
  }
  const r = records.filter(q => q.thread_id === bot.coordinator && q.ask_seq === seq).at(-1);
  return r ? { id: r.id, state: `${r.state}${r.closed_by ? ` by ${r.closed_by}` : ""}`, closed: r.state === "closed", itemKey: `task:${r.need_id ?? r.task_id ?? r.id}`, bindId: `question:${r.need_id ?? r.id}` } : null;
}

function openQuestions(iso, bot) {
  const out = iso.botTasks();
  if (!out.questions) return null;
  return out.questions.filter(q => q.bot === bot.key && q.state === "open");
}

function recordOf(iso, test) {
  return (iso.records() ?? []).filter(test).at(-1) ?? null;
}

async function press(driver, locator) {
  await locator.waitFor({ state: "visible", timeout: 10_000 });
  await driver.press(locator);
}

async function answer(context, { key, text, itemId, threadId, msg }) {
  const { iso, bot, driver } = context;
  await driver.openPanel(bot);
  const item = driver.item(key);
  const shown = await item.locator(".radar-answer").allInnerTexts();
  const after = iso.lastSeq(bot.coordinator);
  await press(driver, item.locator(".radar-answer", { hasText: text.replace(/^.*[?:\u061f]\s+/, "") }).first());
  return [check("answer buttons", shown.length > 0, shown.map(short)), ...await navigatedTo(driver, threadId ?? bot.coordinator, msg), ...await sentAnswer(context, after, text, itemId)];
}

function answerScan(iso, bot, id) {
  const records = iso.run(["saelmbot", "task-v2", "questions", "--id", id, "--json"], { allowFail: true });
  if (records.ok) return `core's question records for the task: ${JSON.stringify(JSON.parse(records.out).questions.map(q => ({ id: q.id, source: q.source, state: q.state, closedBy: q.closedBy, closedRef: q.closedRef })))}`;
  const wait = JSON.parse(iso.run(["saelmbot", "task-v2", "salem-wait", "--id", id, "--json"]).out);
  const verified = iso.coreQuery("SELECT e.seq, s.verified FROM intake_events e JOIN intake_submissions s ON s.id=e.submission_id WHERE e.thread_id=? ORDER BY e.seq", bot.coordinator).filter(r => r.seq > (wait.answerCheck?.askSeq ?? 0));
  return `core's answer check saw turns ${JSON.stringify(wait.answerCheck?.turns ?? [])} after ask #${wait.answerCheck?.askSeq}; intake marks ${JSON.stringify(verified)} as Salem's`;
}

async function answeredLeavesNeeds(context, { id, key }) {
  const { bot, driver, iso } = context;
  const row = await coreRow(bot, id, r => r.later?.reason === "answered" || r.displayState !== "needs");
  const recorded = row && row.displayState !== "needs";
  return [
    { ...check("core records the answer", recorded, row ? `${row.displayState} · ${short(row.line)} · later ${row.later?.reason ?? "none"}${recorded ? "" : `; ${answerScan(iso, bot, id)}`}` : "row gone"), ...(recorded ? {} : { owner: "Needs you pipeline (answer check)" }) },
    ...[await groupIs(driver, bot, key, "waiting", "panel after"), await groupIs(driver, bot, key, "waiting", "after reload", true)].map(item => recorded ? item : { ...item, owner: "Needs you pipeline (answer check)" }),
  ];
}

export const CASES = [
  {
    scenario: "buttons", id: "details", action: "Details open, then close, on a question card", expect: "details show under the card, then hide",
    async run({ driver, bot, world }) {
      await driver.openPanel(bot);
      const item = driver.item(`task:${world.drums}`);
      const more = item.locator(".panel-more");
      await press(driver, more);
      const opened = [await more.getAttribute("aria-expanded"), await item.locator(".panel-details").isVisible()];
      const detail = opened[1] ? short(await item.locator(".panel-details").innerText()) : "";
      await press(driver, more);
      const closed = [await more.getAttribute("aria-expanded"), await item.locator(".panel-details").isVisible()];
      return [check("opens", opened[0] === "true" && opened[1], detail || opened), check("closes", closed[0] === "false" && !closed[1], closed)];
    },
  },
  {
    scenario: "buttons", id: "faces", action: "Read the answer buttons of a one-field form card (label \"Which margin?\") in the panel and in the sidebar's Needs you strip", expect: "each button reads its choice (\"12 percent\"), not the field label again; the question does not repeat an Options list",
    async run({ driver, bot, world }) {
      await driver.openPanel(bot);
      const item = driver.item(`task:${world.drums}`);
      const faces = (await item.locator(".radar-answer").allInnerTexts()).map(short);
      const question = short(await item.locator(".panel-ask-question").innerText());
      await driver.closePanel();
      await driver.sidebar();
      const strip = driver.page.locator(".stage-needs .radar-answer");
      const stripFaces = (await strip.allInnerTexts()).map(short);
      return [check("panel buttons read the choices", faces.length === 3 && faces.every(face => !/^Which margin/.test(face)) && /^12 percent/.test(faces[0]), faces),
        check("panel question has no Options list", !/Options:/.test(question), question),
        check("strip buttons read the choices", stripFaces.every(face => !/^Which margin/.test(face)), stripFaces)];
    },
  },
  {
    scenario: "buttons", id: "question-tap", action: "Tap the question text", expect: "opens the bot's chat at the card; nothing is sent",
    async run({ driver, bot, world, iso }) {
      await driver.openPanel(bot);
      const after = iso.lastSeq(bot.coordinator);
      await press(driver, driver.item(`task:${world.drums}`).locator(".panel-ask-question"));
      const nav = await navigatedTo(driver, bot.coordinator, world.drumsAsk);
      await sleep(2500);
      const sent = salemSince(iso, bot.coordinator, after);
      return [...nav, check("nothing sent", sent.length === 0, sent.map(m => short(m.text)))];
    },
  },
  {
    scenario: "buttons", id: "answer", action: "Press the answer \"15 percent\"", expect: "chat opens at the card, Salem's answer lands bound to the task, core marks it answered, the card leaves Needs you (and stays out after reload)",
    async run(context) {
      const { world } = context;
      return [...await answer(context, { key: `task:${world.drums}`, text: "Which margin? 15 percent", itemId: `task:${world.drums}`, msg: world.drumsAsk }), ...await answeredLeavesNeeds(context, { id: world.drums, key: `task:${world.drums}` })];
    },
  },
  {
    scenario: "buttons", id: "repost", action: "After the answer, the bot posts the same card again", expect: "the question is back in Needs you with its buttons, without a reload",
    async run({ driver, bot, world }) {
      await driver.openPanel(bot);
      world.drumsAsk = await bot.say(world.drumsCard);
      const row = await coreRow(bot, world.drums, r => r.displayState === "needs");
      const item = await poll(async () => { const found = await driver.where(`task:${world.drums}`); return found?.group === "needs" ? found : null; }, 20_000, 1_000) ?? await driver.where(`task:${world.drums}`);
      return [check("core shows it as a question again", row?.displayState === "needs", row ? `${row.displayState} · seq ${row.needs?.messageSeq}` : "gone"), check("panel shows it in Needs you", item?.group === "needs" && item.answers.length === 3, item ?? "missing")];
    },
  },
  {
    scenario: "buttons", id: "double-tap", action: "Double-tap the answer \"18 percent\"", expect: "exactly one answer is sent",
    async run({ driver, bot, world, iso }) {
      await driver.openPanel(bot);
      const after = iso.lastSeq(bot.coordinator);
      await driver.double(driver.item(`task:${world.drums}`).locator(".radar-answer", { hasText: "18 percent" }).first());
      await poll(() => salemSince(iso, bot.coordinator, after).length > 0, 20_000);
      await sleep(5000);
      const sent = salemSince(iso, bot.coordinator, after).filter(m => m.text.includes("18 percent"));
      return [check("one message", sent.length === 1, sent.map(m => `#${m.seq} ${short(m.text)}`))];
    },
  },
  {
    scenario: "choice", id: "answer", action: "Press the button answer \"Van 2\"", expect: "chat opens at the card, \"Van 2\" lands bound to the task, the card leaves Needs you",
    async run(context) {
      const { world } = context;
      return [...await answer(context, { key: `task:${world.van}`, text: "Van 2", itemId: `task:${world.van}`, msg: world.vanAsk }), ...await answeredLeavesNeeds(context, { id: world.van, key: `task:${world.van}` })];
    },
  },
  {
    scenario: "form", id: "buttons", owner: "Needs you pipeline", action: "A form card with three fields", expect: "no one-tap answer buttons: one button cannot fill three fields",
    async run({ driver, bot, world }) {
      await driver.openPanel(bot);
      const answers = await driver.item(`task:${world.contact}`).locator(".radar-answer").allInnerTexts();
      const row = bot.row(world.contact);
      return [check("no answer buttons in the panel", answers.length === 0, answers.map(short)), check("core offers no options", !(row?.needs?.options ?? []).length, row?.needs?.options ?? [])];
    },
  },
  {
    scenario: "form", id: "continue", action: "A form card with three fields: press Continue", expect: "Continue opens the bot's chat with the task chip in the composer and sends nothing",
    async run({ driver, bot, world, iso }) {
      await driver.openPanel(bot);
      const item = driver.item(`task:${world.contact}`);
      const after = iso.lastSeq(bot.coordinator);
      await press(driver, item.locator(".dispatch-task-continue"));
      const nav = await navigatedTo(driver, bot.coordinator);
      const composer = await poll(async () => { const c = await driver.composer(); return c?.text.includes("Store contact details") ? c : null; }, 8_000) ?? await driver.composer();
      await sleep(2000);
      const sent = salemSince(iso, bot.coordinator, after);
      return [...nav, check("composer holds the task chip", composer?.text.includes("Store contact details"), composer ?? "no composer"), check("nothing sent", sent.length === 0, sent.map(m => short(m.text)))];
    },
  },
  {
    scenario: "form", id: "submit", action: "Salem fills the three-field form in the bot's chat (Mobile, support@, opening hours) and sends what the card stages in his message", expect: "the card's own form reply closes its question (no chip, no judge): the task leaves Needs you as answered",
    async run({ iso, bot, world, driver }) {
      const page = driver.page;
      await page.goto(`${iso.url}/projects/${bot.project}/threads/${bot.coordinator}`, { waitUntil: "domcontentloaded" });
      await driver.settle();
      const box = page.locator('[contenteditable="true"]').last();
      await box.waitFor({ state: "visible", timeout: 20_000 });
      for (let attempt = 0; attempt < 4 && (await driver.composer())?.text; attempt++) {
        await box.evaluate(node => { node.focus(); const range = document.createRange(); range.selectNodeContents(node); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); });
        await page.keyboard.press("Backspace");
        await sleep(300);
      }
      const cleared = await driver.composer();
      await driver.press(page.getByText("Mobile", { exact: true }).last());
      await driver.press(page.getByText("support@", { exact: true }).last());
      const hours = page.getByRole("textbox", { name: /Opening hours/ }).last();
      if (await hours.isVisible().catch(() => false)) { await hours.click(); await page.keyboard.type("9 to 5"); }
      const staged = await poll(async () => { const c = await driver.composer(); return /Which phone number\? Mobile/.test(c?.text ?? "") ? c : null; }, 10_000) ?? await driver.composer();
      const after = iso.lastSeq(bot.coordinator);
      await box.click();
      await driver.submit();
      const sent = await poll(() => salemSince(iso, bot.coordinator, after).find(m => /Which phone number\? Mobile/.test(m.text)), 20_000);
      const record = await poll(() => recordOf(iso, q => q.task_id === world.contact && q.state === "closed"), 20_000);
      const row = await coreRow(bot, world.contact, r => r.displayState !== "needs");
      await driver.home();
      return [check("his composer starts empty (no task chip left from Continue)", !cleared?.text, cleared?.text ?? "empty"), check("the card staged its form reply in his message", /Which phone number\? Mobile/.test(staged?.text ?? ""), staged?.text ?? "no composer"),
        check("his form reply landed as Salem's", sent?.from === "salem", sent ? `#${sent.seq} ${short(sent.text)}` : "none"),
        check("core closed the card's question by its form reply", record?.closed_by === "form", record ? `${record.state} by ${record.closed_by}` : "still open"),
        check("core: the task is answered, waiting for the bot", row?.displayState === "waiting" && row.later?.reason === "answered", row ? `${row.displayState} · ${short(row.line)}` : "gone"),
        await groupIs(driver, bot, `task:${world.contact}`, "waiting", "panel after")];
    },
  },
  {
    scenario: "later", id: "not-now", action: "Not now on \"Deploy the price fix to production?\"", expect: "core saves Not now; the card moves to Later with Bring back, also after reload",
    async run({ driver, bot, world, iso }) {
      const key = `task:${world.deploy}`;
      await driver.openPanel(bot);
      await press(driver, driver.item(key).locator(".radar-not-now"));
      const saved = await poll(() => notNowKeys(iso).includes(key), 15_000);
      const later = await driver.where(key);
      return [check("core not-now row", saved, notNowKeys(iso)), check("panel moves it to Later", later?.group === "later" && later.buttons.some(b => /^Bring back/.test(b)), later ?? "missing"), await groupIs(driver, bot, key, "later", "after reload", true)];
    },
  },
  {
    scenario: "later", id: "bring-back", action: "Bring back on the same item in Later", expect: "core drops Not now; the card is back in Needs you, also after reload",
    async run({ driver, bot, world, iso }) {
      const key = `task:${world.deploy}`;
      await driver.openPanel(bot);
      await press(driver, driver.item(key).locator(".radar-not-now"));
      const gone = await poll(() => !notNowKeys(iso).includes(key), 15_000);
      return [check("core not-now row removed", gone, notNowKeys(iso)), await groupIs(driver, bot, key, "needs", "panel after"), await groupIs(driver, bot, key, "needs", "after reload", true)];
    },
  },
  {
    scenario: "later", id: "not-now-then-update", action: "Not now on \"Recount the Tanta shelves?\", then the bot asks it again", expect: "the new ask brings it back to Needs you",
    async run({ driver, bot, world, iso }) {
      const key = `task:${world.tap}`;
      await driver.openPanel(bot);
      await press(driver, driver.item(key).locator(".radar-not-now"));
      await poll(() => notNowKeys(iso).includes(key), 15_000);
      const parked = await groupIs(driver, bot, key, "later", "after Not now");
      await bot.say(`${chip(world.tap)}\nThe Tanta count is off by 30 boxes. Recount the Tanta shelves this week?`);
      const row = await coreRow(bot, world.tap, r => r.displayState === "needs");
      return [parked, check("core shows the new ask", row?.displayState === "needs", row ? `${row.displayState} · ${short(row.line)}` : "gone"), await groupIs(driver, bot, key, "needs", "panel after the new ask")];
    },
  },
  {
    scenario: "later", id: "double-not-now", action: "Double-tap Not now on the first of two stacked questions", expect: "only that question moves to Later, once; the one below stays in Needs you; the panel stays open",
    async run({ driver, bot, world, iso }) {
      await driver.openPanel(bot);
      const before = await driver.state();
      const asks = before.items.filter(item => item.group === "needs").map(item => item.key);
      const first = asks[0];
      await driver.double(driver.item(first).locator(".radar-not-now"));
      await sleep(3000);
      const open = await driver.panel().isVisible().catch(() => false);
      const parked = notNowKeys(iso).filter(key => asks.includes(key));
      const after = await driver.state();
      return [check("two questions stacked before", asks.length === 2, asks), check("panel stays open", open, open ? "open" : "closed by the second tap"),
        check("only the tapped one is parked in core", parked.length === 1 && parked[0] === first, parked), check("the one below stays in Needs you", after?.items.find(item => item.key === asks[1])?.group === "needs", after?.items.find(item => item.key === asks[1]) ?? "panel closed")];
    },
  },
  {
    scenario: "questions", id: "answer-card", action: "A question card with no task: press \"Elsewedy\"", expect: "Salem's answer lands bound to the question; the question leaves Needs you",
    async run(context) {
      const { iso, bot, world, driver } = context;
      const need = await poll(() => savedQuestion(iso, bot, world.supplierAsk), 20_000);
      if (!need) return [check("core saved the card as a question", false, "no saved question for the card")];
      world.supplierNeed = need.id;
      const steps = await answer(context, { key: need.itemKey, text: "Elsewedy", itemId: need.bindId, msg: world.supplierAsk });
      const closed = await poll(() => { const now = savedQuestion(iso, bot, world.supplierAsk); return now?.closed ? now : null; }, 30_000);
      return [...steps, check("core closes the question", closed, closed ? closed.state : savedQuestion(iso, bot, world.supplierAsk)?.state), await groupIs(driver, bot, need.itemKey, null, "panel after"), await groupIs(driver, bot, need.itemKey, null, "after reload", true)];
    },
  },
  {
    scenario: "questions", id: "reply-in-chat", action: "An ask with no card (needs add): press Reply in chat", expect: "opens the bot's chat; nothing is sent",
    async run({ iso, bot, world, driver }) {
      await driver.openPanel(bot);
      const item = driver.item(`task:${world.renew}`);
      const label = await item.locator(".dispatch-task-continue").innerText().catch(() => "");
      const after = iso.lastSeq(bot.coordinator);
      await press(driver, item.locator(".dispatch-task-continue"));
      const nav = await navigatedTo(driver, bot.coordinator);
      await sleep(2000);
      return [check("button reads Reply in chat", /Reply in chat/.test(label), label), ...nav, check("nothing sent", salemSince(iso, bot.coordinator, after).length === 0, salemSince(iso, bot.coordinator, after).map(m => short(m.text)))];
    },
  },
  {
    scenario: "questions", id: "not-now-bring-back", action: "Not now, then Bring back, on the needs-add ask", expect: "Not now saves task:<need> and parks it in Later; Bring back puts it back",
    async run({ iso, bot, world, driver }) {
      const key = `task:${world.renew}`;
      await driver.openPanel(bot);
      await press(driver, driver.item(key).locator(".radar-not-now"));
      const saved = await poll(() => notNowKeys(iso).includes(key), 15_000);
      const parked = await groupIs(driver, bot, key, "later", "after Not now", true);
      await driver.openPanel(bot);
      await press(driver, driver.item(key).locator(".radar-not-now"));
      const gone = await poll(() => !notNowKeys(iso).includes(key), 15_000);
      return [check("core not-now row", saved, notNowKeys(iso)), parked, check("core row removed", gone, notNowKeys(iso)), await groupIs(driver, bot, key, "needs", "after Bring back")];
    },
  },
  {
    scenario: "old", id: "old-ask", action: "An ask from 13 hours ago that Salem never answered (he has since asked for something else in that chat), next to a fresh one", expect: "both are plain questions in Needs you: his unrelated message closed nothing and Radar no longer demotes an ask by age; the header counts 2; Continue on the old one opens the chat with its task chip",
    async run({ iso, bot, world, driver }) {
      await driver.openPanel(bot);
      const state = await driver.state();
      const old = state.items.find(item => item.key === `task:${world.contract}`);
      const fresh = state.items.find(item => item.key === `task:${world.fresh}`);
      const needs = state.tally.find(part => part.group === "needs")?.text ?? "";
      const after = iso.lastSeq(bot.coordinator);
      await press(driver, driver.item(`task:${world.contract}`).locator(".dispatch-task-continue"));
      const nav = await navigatedTo(driver, bot.coordinator);
      const composer = await poll(async () => { const c = await driver.composer(); return c?.text.includes("Supplier contract") ? c : null; }, 8_000) ?? await driver.composer();
      return [check("the 13-hour-old ask is a plain question in Needs you", old && !old.old && old.group === "needs", old ?? "missing"), check("the fresh ask is in Needs you", fresh?.group === "needs", fresh ?? "missing"),
        check("header counts both asks", /^2\b/.test(needs), needs), ...nav,
        check("composer holds the task chip", composer?.text.includes("Supplier contract"), composer ?? "none"), check("nothing sent", salemSince(iso, bot.coordinator, after).length === 0, "")];
    },
  },
  {
    scenario: "native", id: "interaction", action: "A worker's own question (native form): look, then Not now", expect: "shows in Needs you; Not now saves form:<interaction> and parks it",
    async run({ iso, bot, world, driver }) {
      const row = await coreRow(bot, world.login, r => r.displayState === "needs" && !!r.needs?.interactionId);
      const key = `task:${world.login}`;
      const shown = await groupIs(driver, bot, key, "needs", "panel");
      const item = await driver.where(key);
      await press(driver, driver.item(key).locator(".radar-not-now"));
      const formKey = row?.needs?.interactionId ? `form:${row.needs.interactionId}` : "form:?";
      const saved = await poll(() => notNowKeys(iso).includes(formKey), 15_000);
      return [check("core shows the worker's question", row?.needs?.interactionId, row ? `${row.displayState} · ${short(row.needs?.question)} · ${row.needs?.threadId}` : "none"), shown, check("buttons on the card", true, item?.buttons ?? []), check("core not-now row", saved, notNowKeys(iso)), await groupIs(driver, bot, key, "later", "after Not now", true)];
    },
  },
  {
    scenario: "work", id: "groups", owner: "core status (a failed worker turn)", action: "Look at every kind of open work", expect: "working, waiting outside, not started, overdue check, failed check, retrying and an unfiled worker each in their section",
    async run({ bot, world, driver }) {
      await driver.openPanel(bot);
      const state = await driver.state();
      const at = key => state.items.find(item => item.key === key);
      const want = [[world.building, "working", "Shelf report"], [world.outside, "waiting", "Elsewedy price list"], [world.filed, "waiting", "Sohag seminar"], [world.overdue, "stuck", "Courier refund"], [world.checked, "stuck", "October orders import"], ];
      const rows = Object.fromEntries(bot.tasks().map(t => [t.id, `${t.displayState} · ${short(t.line)}`]));
      return [...want.map(([id, group, label]) => check(`${label} in ${group}`, at(`task:${id}`)?.group === group, `${at(`task:${id}`)?.group ?? "missing"}: ${at(`task:${id}`)?.text ?? ""} [core: ${rows[id] ?? "none"}]`)),
        check("worker whose turn failed is not shown as a finished result", at(`task:${world.retry}`)?.group === "stuck", `${at(`task:${world.retry}`)?.group ?? "missing"}: ${at(`task:${world.retry}`)?.text ?? ""} [core: ${rows[world.retry] ?? "none"}]`),
        check("unfiled worker in working", at(`worker:${world.loose}`)?.group === "working", at(`worker:${world.loose}`) ?? "missing"), check("header", state.tally.length > 0, state.tally.map(t => t.text))];
    },
  },
  {
    scenario: "work", id: "tally-jumps", action: "Press each header count", expect: "each jumps to its section",
    async run({ bot, driver }) {
      await driver.openPanel(bot);
      const parts = await driver.panel().locator(".panel-tally-part").all();
      const checks = [];
      for (const part of parts) {
        const group = await part.getAttribute("data-group");
        await driver.press(part);
        await sleep(900);
        const gap = await driver.panel().evaluate((panel, g) => { const body = panel.querySelector(".dispatch-panel-body"); const section = body.querySelector(`[data-group="${g}"]`); if (!section) return null; const fits = body.scrollHeight - body.clientHeight - body.scrollTop < 2; return { gap: Math.round(section.getBoundingClientRect().top - body.getBoundingClientRect().top), atEnd: fits }; }, group);
        checks.push(check(`${group} count jumps to its section`, gap && (Math.abs(gap.gap) <= 12 || gap.atEnd && gap.gap >= 0), gap));
      }
      return checks;
    },
  },
  {
    scenario: "work", id: "row-details", action: "Tap a working row, then tap it again", expect: "its details open, then close",
    async run({ bot, world, driver }) {
      await driver.openPanel(bot);
      const row = driver.item(`task:${world.building}`);
      await press(driver, row.locator(".panel-row-main"));
      const opened = [await row.locator(".panel-row-main").getAttribute("aria-expanded"), await row.locator(".panel-details").isVisible()];
      const text = opened[1] ? short(await row.locator(".panel-details").innerText()) : "";
      await press(driver, row.locator(".panel-row-main"));
      const closed = [await row.locator(".panel-row-main").getAttribute("aria-expanded"), await row.locator(".panel-details").isVisible()];
      return [check("opens", opened[0] === "true" && opened[1], text || opened), check("closes", closed[0] === "false" && !closed[1], closed)];
    },
  },
  {
    scenario: "work", id: "continue", action: "Continue on the working task", expect: "opens the bot's chat with the task chip; nothing sent",
    async run({ iso, bot, world, driver }) {
      await driver.openPanel(bot);
      const after = iso.lastSeq(bot.coordinator);
      await press(driver, driver.item(`task:${world.building}`).locator(".dispatch-task-continue"));
      const nav = await navigatedTo(driver, bot.coordinator);
      const composer = await poll(async () => { const c = await driver.composer(); return c?.text.includes("Shelf report") ? c : null; }, 8_000) ?? await driver.composer();
      await sleep(1500);
      return [...nav, check("composer holds the task chip", composer?.text.includes("Shelf report"), composer ?? "none"), check("nothing sent", salemSince(iso, bot.coordinator, after).length === 0, "")];
    },
  },
  {
    scenario: "work", id: "worker-row", action: "Tap the unfiled worker's row", expect: "opens that worker's chat",
    async run({ bot, world, driver }) {
      await driver.openPanel(bot);
      await press(driver, driver.item(`worker:${world.loose}`).locator(".panel-row-main"));
      return navigatedTo(driver, world.loose);
    },
  },
  {
    scenario: "desks", id: "groups", action: "Look at desks in every status", expect: "draft and blocked in Needs you, working, waiting on a person with its wake, a wake that came due while bb was off is delivered, deferred queued, info and done in Done",
    async run({ bot, world, driver }) {
      await driver.openPanel(bot);
      const state = await driver.state();
      const deskIds = Object.fromEntries((driver.iso.bot(bot.key)?.desks ?? []).map(desk => [desk.threadId ?? desk.key, desk]));
      const at = threadId => { const desk = deskIds[threadId]; return desk ? state.items.find(item => item.key === `desk:${desk.id}`) : undefined; };
      const deferred = (driver.iso.bot(bot.key)?.desks ?? []).find(desk => /Nour/.test(desk.title));
      const want = [[world.draftDesk, "needs"], [world.blockedDesk, "needs"], [world.workingDesk, "working"], [world.waitingDesk, "waiting"], [world.lateDesk, "waiting"], [world.infoDesk, "done"], [world.doneDesk, "done"]];
      const woken = driver.iso.messages(world.lateDesk.threadId).filter(m => m.from !== "bot" && /wake|Mona|photos/i.test(m.text));
      const deferredItem = deferred ? state.items.find(item => item.key === `desk:${deferred.id}`) : undefined;
      return [...want.map(([desk, group]) => check(`${desk.threadId} in ${group}`, at(desk.threadId)?.group === group, at(desk.threadId) ? `${at(desk.threadId).group}: ${at(desk.threadId).text}` : `missing (core status ${deskIds[desk.threadId]?.status})`)),
        check("desk whose wake came due while bb was off got its wake when bb started", woken.length > 0, woken.map(m => `#${m.seq} ${short(m.text)}`)),
        check("deferred desk queued in Waiting", deferredItem?.group === "waiting" && /Queued/.test(deferredItem.text), deferredItem ?? `core: ${deferred?.status ?? "no deferred desk"}`)];
    },
  },
  {
    scenario: "desks", id: "desk-continue", action: "Continue on the draft desk", expect: "opens the desk's chat",
    async run({ iso, bot, world, driver }) {
      await driver.openPanel(bot);
      await press(driver, driver.item(deskKey(iso, bot, world.draftDesk.threadId)).locator(".dispatch-task-continue"));
      return navigatedTo(driver, world.draftDesk.threadId);
    },
  },
  {
    scenario: "desks", id: "desk-send", action: "Go, send it. on a desk's draft", expect: "the card shows the draft and its two answers; the tap opens the desk's chat and Go, send it. lands there as Salem's",
    async run({ iso, bot, world, driver }) {
      await driver.openPanel(bot);
      const item = driver.item(deskKey(iso, bot, world.sendDesk.threadId));
      await item.locator(".panel-ask-draft").waitFor({ state: "visible", timeout: 20_000 }).catch(() => {});
      const draft = short(await item.locator(".panel-ask-draft").innerText().catch(() => ""));
      const answers = (await item.locator(".radar-answer").allInnerTexts()).map(short);
      const after = iso.lastSeq(world.sendDesk.threadId);
      await press(driver, item.locator(".radar-answer", { hasText: "Go, send it." }).first());
      const landed = await poll(() => salemSince(iso, world.sendDesk.threadId, after).find(message => message.text.includes("Go, send it.")), 25_000);
      return [check("card shows the quoted draft only", draft === "Laila, your order is on the van and arrives tomorrow before noon.", draft),
        check("two answers", answers.length === 2 && /^Go, send it\./.test(answers[0]) && /^Don't send it/.test(answers[1]), answers),
        ...await navigatedTo(driver, world.sendDesk.threadId),
        check("Go, send it. lands in the desk's chat as Salem's", !!landed, landed ? `#${landed.seq} ${landed.from}: ${short(landed.text)}` : `none after #${after}`)];
    },
  },
  {
    scenario: "desks", id: "desk-stale", action: "Go, send it. on a card whose draft was replaced after it was drawn", expect: "nothing is sent; the card says the draft changed",
    async run({ iso, bot, world, driver }) {
      await driver.openPanel(bot);
      const item = driver.item(deskKey(iso, bot, world.staleDesk.threadId));
      await item.locator(".panel-ask-draft").waitFor({ state: "visible", timeout: 20_000 }).catch(() => {});
      const refresh = url => /bot_tasks|bots_version/.test(url.href);
      await driver.page.route(refresh, route => route.abort());
      const newSeq = await bot.deskSays(world.staleDesk.threadId, "**Draft reply:**\n> Karim, 12 floodlights are EGP 5,400 in total with delivery.");
      const shown = short(await item.locator(".panel-ask-draft").innerText().catch(() => ""));
      const after = iso.lastSeq(world.staleDesk.threadId);
      const button = item.locator(".radar-answer", { hasText: "Go, send it." }).first();
      const offered = await button.isVisible().catch(() => false);
      if (offered) await driver.press(button);
      const note = await poll(() => item.locator(".panel-ask-changed").isVisible().catch(() => false), 10_000);
      await sleep(4_000);
      const sent = salemSince(iso, world.staleDesk.threadId, after);
      await driver.page.unroute(refresh);
      return [check("the card still showed the old draft when it was pressed", offered && /4,800/.test(shown), `${shown} (old #${world.staleDraftSeq}, new #${newSeq})`),
        check("the card says the draft changed", !!note, note ? short(await item.locator(".panel-ask-changed").innerText()) : "no note"),
        check("nothing was sent to the desk", sent.length === 0, sent.map(message => `#${message.seq} ${short(message.text)}`)),
        check("the page stayed on the panel", driver.location().thread !== world.staleDesk.threadId, driver.location().path)];
    },
  },
  {
    scenario: "desks", id: "desk-question", action: "Tap the blocked desk's question", expect: "opens the desk's chat",
    async run({ iso, bot, world, driver }) {
      await driver.openPanel(bot);
      await press(driver, driver.item(deskKey(iso, bot, world.blockedDesk.threadId)).locator(".panel-ask-question"));
      return navigatedTo(driver, world.blockedDesk.threadId);
    },
  },
  {
    scenario: "desks", id: "desk-not-now", action: "Not now on the draft desk, then Bring back", expect: "core saves desk:<id>; it moves to Later; Bring back returns it to Needs you",
    async run({ iso, bot, world, driver }) {
      const key = deskKey(iso, bot, world.draftDesk.threadId);
      await driver.openPanel(bot);
      await press(driver, driver.item(key).locator(".radar-not-now"));
      const saved = await poll(() => notNowKeys(iso).includes(key), 15_000);
      const parked = await groupIs(driver, bot, key, "later", "after Not now", true);
      await driver.openPanel(bot);
      await press(driver, driver.item(key).locator(".radar-not-now"));
      const gone = await poll(() => !notNowKeys(iso).includes(key), 15_000);
      return [check("core not-now row", saved, notNowKeys(iso)), parked, check("core row removed", gone, notNowKeys(iso)), await groupIs(driver, bot, key, "needs", "after Bring back"), await groupIs(driver, bot, key, "needs", "after reload", true)];
    },
  },
  {
    scenario: "desks", id: "desk-row", action: "Tap the working desk's row", expect: "opens the desk's chat",
    async run({ iso, bot, world, driver }) {
      await driver.openPanel(bot);
      await press(driver, driver.item(deskKey(iso, bot, world.workingDesk.threadId)).locator(".panel-row-main"));
      return navigatedTo(driver, world.workingDesk.threadId);
    },
  },
  {
    scenario: "desks", id: "bot-tab", action: "In the bot's chat, open the Bot side tab and press a desk", expect: "the tab lists the desks; pressing one opens its chat",
    async run({ bot, world, driver }) {
      await driver.closePanel();
      await driver.page.goto(`${driver.iso.url}/projects/${bot.project}/threads/${bot.coordinator}`, { waitUntil: "domcontentloaded" });
      await driver.settle();
      const show = driver.page.getByRole("button", { name: /^Show right panel/ });
      if (await show.isVisible().catch(() => false)) await driver.press(show);
      const tab = driver.page.getByRole("button", { name: "Show bot panel" });
      const found = await tab.waitFor({ state: "visible", timeout: 5_000 }).then(() => true, () => false);
      if (!found) return [check("Bot tab is there", false, await driver.page.locator("button[aria-label]").evaluateAll(nodes => nodes.map(n => n.getAttribute("aria-label")).filter(Boolean).slice(0, 30)))];
      await driver.press(tab);
      await sleep(1500);
      const pane = driver.page.locator("[class*='bot-panel']").first();
      const desk = pane.getByText(/Sara Nabil|Invoice copy/).first();
      const listed = await desk.isVisible().catch(() => false);
      const text = short(await pane.innerText().catch(() => ""));
      if (!listed) { await driver.rightPanelClosed(); return [check("tab lists the working desk", false, text)]; }
      await driver.press(desk);
      const nav = await navigatedTo(driver, world.workingDesk.threadId);
      await driver.rightPanelClosed();
      return [check("tab lists the working desk", true, text), ...nav];
    },
  },
  {
    scenario: "done", id: "fold", action: "Open the Done fold, read the day groups, then Show less", expect: "today's 3 newest show; the fold names the rest; opening shows Yesterday and the weekday before; Show less folds it",
    async run({ bot, driver }) {
      await driver.openPanel(bot);
      const section = driver.panel().locator('.panel-section[data-group="done"]');
      const head = await section.locator(".panel-section-head").innerText();
      const fold = section.locator(".panel-fold");
      const label = await fold.innerText();
      const before = await section.locator("[data-item]").count();
      await press(driver, fold);
      await sleep(500);
      const days = await section.locator(".panel-day h4").allInnerTexts();
      const after = await section.locator("[data-item]").count();
      const less = await fold.innerText();
      await press(driver, fold);
      await sleep(400);
      const again = await section.locator("[data-item]").count();
      return [check("head says 6 today", /6 today/.test(head), head), check("3 shown folded", before === 3, before), check("fold label", /3 more today, 4 earlier this week/.test(label), label),
        check("day groups", days.includes("Yesterday") && days.length === 2, days), check("all 10 shown open", after === 10, after), check("Show less", /Show less/.test(less), less), check("folds back", again === 3, again)];
    },
  },
  {
    scenario: "done", id: "done-row", action: "Tap a done row, then its \"Open the chat where this was done\"", expect: "details open; the link opens the chat",
    async run({ bot, world, driver }) {
      await driver.openPanel(bot);
      const row = driver.item(`task:${world.doneToday.at(-1)}`);
      await press(driver, row.locator(".panel-row-main"));
      const text = short(await row.locator(".panel-details").innerText().catch(() => ""));
      const link = row.locator(".panel-link", { hasText: "Open the chat where this was done" });
      const has = await link.isVisible().catch(() => false);
      if (!has) return [check("link there", false, text)];
      await driver.press(link);
      return [check("details", text.length > 0, text), ...await navigatedTo(driver, bot.coordinator)];
    },
  },
  {
    scenario: "crowded", id: "header", action: "Header counts against core", expect: "needs, working and waiting counts match core and each jumps to its section",
    async run({ iso, bot, driver }) {
      await driver.openPanel(bot);
      const state = await driver.state();
      const core = iso.bot(bot.key);
      const count = group => Number(/^\d+/.exec(state.tally.find(part => part.group === group)?.text ?? "0")?.[0] ?? 0);
      const open = openQuestions(iso, bot);
      const needs = open ? open.length : core.tasks.filter(t => t.displayState === "needs").length + core.desks.filter(d => d.status === "draft" || d.status === "blocked").length;
      const checks = [check("needs count", count("needs") === needs, `${count("needs")} shown, core ${needs}`), check("working count", count("working") >= 3, state.tally.map(t => t.text))];
      for (const part of await driver.panel().locator(".panel-tally-part").all()) {
        const group = await part.getAttribute("data-group");
        await driver.press(part);
        await sleep(900);
        const gap = await driver.panel().evaluate((panel, g) => { const body = panel.querySelector(".dispatch-panel-body"); const section = body.querySelector(`[data-group="${g}"]`); return section ? { gap: Math.round(section.getBoundingClientRect().top - body.getBoundingClientRect().top), atEnd: body.scrollHeight - body.clientHeight - body.scrollTop < 2 } : null; }, group);
        checks.push(check(`${group} jump`, gap && (Math.abs(gap.gap) <= 12 || gap.atEnd && gap.gap >= 0), gap));
      }
      return checks;
    },
  },
  {
    scenario: "crowded", id: "close", action: "Close button, then Escape, then a tap outside", expect: "each closes the panel",
    async run({ bot, driver }) {
      const checks = [];
      await driver.openPanel(bot);
      await press(driver, driver.panel().locator(".dispatch-close"));
      checks.push(check("Close button", await driver.panel().waitFor({ state: "detached", timeout: 4000 }).then(() => true, () => false), ""));
      await driver.openPanel(bot);
      await driver.page.keyboard.press("Escape");
      checks.push(check("Escape", await driver.panel().waitFor({ state: "detached", timeout: 4000 }).then(() => true, () => false), ""));
      await driver.openPanel(bot);
      await sleep(600);
      const overlay = driver.page.locator(".dispatch-overlay");
      const box = await driver.panel().boundingBox();
      const spot = driver.phone ? { x: 195, y: 20 } : { x: Math.min(1380, box.x + box.width + 120), y: 450 };
      if (driver.phone) await driver.page.touchscreen.tap(spot.x, spot.y); else await driver.page.mouse.click(spot.x, spot.y);
      checks.push(check("tap outside", await overlay.waitFor({ state: "detached", timeout: 4000 }).then(() => true, () => false), spot));
      return checks;
    },
  },
  {
    scenario: "crowded", id: "chat", action: "Chat button", expect: "opens the bot's chat",
    async run({ bot, driver }) {
      await driver.home();
      await driver.openPanel(bot);
      await press(driver, driver.panel().locator(".dispatch-chat-pill"));
      return navigatedTo(driver, bot.coordinator);
    },
  },
  {
    scenario: "crowded", id: "automations", action: "Automations link", expect: "goes to this bot's automations and closes the panel",
    async run({ bot, driver }) {
      await driver.openPanel(bot);
      const link = driver.panel().locator(".dispatch-automations");
      const href = await link.getAttribute("href");
      await driver.press(link);
      await sleep(2000);
      const gone = !await driver.panel().isVisible().catch(() => false);
      return [check("href names the bot", href?.includes(bot.key), href), check("panel closes", gone, ""), check("page changed", driver.page.url().includes(href?.split("?")[0] ?? "@@"), driver.page.url())];
    },
  },
  {
    scenario: "crowded", id: "more", action: "More menu, then Show threads", expect: "the menu opens with the bot's actions; Show threads switches the sidebar to All threads",
    async run({ bot, driver }) {
      await driver.home();
      await driver.openPanel(bot);
      const trigger = driver.panel().locator(".dispatch-panel-actions").getByRole("button", { name: /More/ }).first();
      await press(driver, trigger);
      await sleep(700);
      const items = await driver.page.locator('[role="menuitem"]').allInnerTexts();
      const show = driver.page.locator('[role="menuitem"]', { hasText: /threads/i }).first();
      if (!await show.isVisible().catch(() => false)) { await driver.page.keyboard.press("Escape"); return [check("menu items", false, items)]; }
      await driver.press(show);
      await sleep(1200);
      const mode = await driver.page.locator(".radar-list-shell").getAttribute("data-radar-mode").catch(() => null);
      const back = driver.page.locator(".radar-back-to-bots");
      if (await back.isVisible().catch(() => false)) await driver.press(back);
      return [check("menu items", items.length > 0, items.map(short)), check("sidebar shows All threads", mode === "threads", mode)];
    },
  },
  {
    scenario: "closed", id: "closed-while-running", action: "ERBareeq's live case: two tasks are closed (one done, one stopped) while their workers still run, next to three working tasks; read the panel, then reload",
    expect: "Working lists only the three open tasks and says 3 workers running; the two closed tasks sit in Done; the same after reload",
    async run({ iso, bot, world, driver }) {
      const core = Object.fromEntries(bot.tasks().map(t => [t.id, `${t.displayState} · ${short(t.line)}`]));
      const look = async () => {
        const state = await driver.state();
        const at = id => state?.items.find(item => item.key === `task:${id}`);
        const head = state?.sections.find(section => section.group === "working")?.head ?? "";
        return { state, at, head, working: state?.items.filter(item => item.group === "working").map(item => item.key) ?? [] };
      };
      const checks = async (label, view) => [
        check(`${label}: Working holds only the 3 open tasks`, view.working.length === 3 && world.live.every(id => view.working.includes(`task:${id}`)), view.working),
        check(`${label}: header says 3 workers running`, /3 workers running/.test(view.head), view.head),
        check(`${label}: the done task is in Done`, view.at(world.stock)?.group === "done", view.at(world.stock) ?? "missing"),
        check(`${label}: the stopped task is in Done`, view.at(world.returns)?.group === "done", view.at(world.returns) ?? "missing"),
        check(`${label}: tally counts 3 working`, /^3 working/.test(view.state?.tally.find(part => part.group === "working")?.text ?? ""), view.state?.tally.map(part => part.text) ?? []),
      ];
      await driver.openPanel(bot);
      await sleep(2500);
      const first = await checks("panel", await look());
      await driver.reload();
      await driver.openPanel(bot);
      await sleep(2500);
      return [check("core rows", true, core), ...first, ...await checks("after reload", await look())];
    },
  },
  {
    scenario: "arabic", id: "answer", action: "Arabic question: press \"١٥٪\"", expect: "\"١٥٪\" lands bound to the task; the card leaves Needs you",
    async run(context) {
      const { world } = context;
      return [...await answer(context, { key: `task:${world.margin}`, text: "١٥٪", itemId: `task:${world.margin}`, msg: world.marginAsk }), ...await answeredLeavesNeeds(context, { id: world.margin, key: `task:${world.margin}` })];
    },
  },
  {
    scenario: "arabic", id: "desk", action: "Arabic desk ask: Continue", expect: "opens the desk's chat",
    async run({ iso, bot, world, driver }) {
      const desk = iso.bot(bot.key).desks.find(d => d.threadId === world.arabicDesk.threadId);
      await driver.openPanel(bot);
      await press(driver, driver.item(`desk:${desk.id}`).locator(".dispatch-task-continue"));
      return navigatedTo(driver, world.arabicDesk.threadId);
    },
  },
  {
    scenario: "quiet", id: "quiet", action: "A bot with nothing open", expect: "the header says Nothing open and the body has its quiet line; Close works",
    async run({ bot, driver }) {
      await driver.openPanel(bot);
      const state = await driver.state();
      const line = await driver.panel().locator(".panel-quiet").innerText().catch(() => "");
      await press(driver, driver.panel().locator(".dispatch-close"));
      const closed = await driver.panel().waitFor({ state: "detached", timeout: 4000 }).then(() => true, () => false);
      return [check("Nothing open", state.quiet === "Nothing open", state.quiet), check("quiet line", line.length > 0, line), check("closes", closed, "")];
    },
  },
  {
    scenario: "quiet", id: "fresh-session", action: "More menu, then Start a fresh session", expect: "the entry names the model the bot is on; the tap records the request in core, and the entry cannot be pressed again while it waits",
    async run({ iso, bot, driver }) {
      const roster = () => iso.rpc("orchestrator-mode", "bot_roster", null).bots.find(row => row.key === bot.key);
      const entry = async () => {
        await driver.home();
        await driver.openPanel(bot);
        await press(driver, driver.panel().locator(".dispatch-panel-actions").getByRole("button", { name: /More/ }).first());
        await sleep(700);
        return driver.page.locator('[role="menuitem"]', { hasText: /fresh session/i }).first();
      };
      const before = roster();
      const first = await entry();
      const shown = short(await first.innerText().catch(() => ""));
      if (!shown) {
        const items = await driver.page.locator('[role="menuitem"]').allInnerTexts();
        await driver.page.keyboard.press("Escape");
        return [check("the menu has the entry", false, items.map(short))];
      }
      await driver.shot("quiet-fresh-session-menu");
      await driver.press(first);
      const moved = row => row && (row.freshPending || row.rollover || row.current !== before.current);
      const after = await poll(() => { const row = roster(); return moved(row) ? row : null; }, 20_000) ?? roster();
      const again = await entry();
      const later = short(await again.innerText().catch(() => ""));
      const spent = await again.isDisabled().catch(() => false);
      await driver.shot("quiet-fresh-session-spent");
      await driver.page.keyboard.press("Escape");
      return [
        check("the entry names the model", /^Start a fresh session\s*On \S/.test(shown), `${shown} (registered model ${before.model})`),
        check("core recorded the request", moved(after), { freshPending: after?.freshPending, rollover: after?.rollover, current: after?.current, was: before.current }),
        check("the entry is spent, or the new session is already the bot's chat", spent || after?.current !== before.current, `${later}${spent ? " (disabled)" : ""}`),
      ];
    },
  },
  {
    scenario: "stale", id: "answered-in-chat", owner: "Needs you pipeline",
    action: "Salem's live case (ERBareeq Master Technician list): he answers the card in chat with the task chip and a link, then the bot tries to wait on him again for acceptance",
    expect: "his chip reply closes the card's question; the bot's \"acceptance:\" wait that follows is refused (no sign-off waits); nothing about the answered question stays in Needs you",
    async run({ iso, bot, world, driver }) {
      await driver.openPanel(bot);
      await press(driver, driver.item(`task:${world.plan}`).locator(".dispatch-task-continue"));
      await navigatedTo(driver, bot.coordinator);
      const box = driver.page.locator('[contenteditable="true"]').last();
      await poll(async () => (await box.innerText()).includes("Technician"), 8_000);
      await driver.appendToComposer(" https://docs.example.com/master-technicians.csv published, read it from there");
      const after = iso.lastSeq(bot.coordinator);
      await driver.submit();
      const sent = await poll(() => salemSince(iso, bot.coordinator, after).find(m => m.text.includes("master-technicians")), 20_000);
      await iso.idle(bot.coordinator);
      const need = await poll(() => savedQuestion(iso, bot, world.planAsk), 10_000);
      const closed = await poll(() => { const now = savedQuestion(iso, bot, world.planAsk); return now?.closed ? now : null; }, 30_000);
      const refused = bot.change(world.plan, { action: "wait", owner: "salem", reason: "acceptance: the dashboard plan has his answers and the published Master list." }, { allowFail: true });
      await sleep(4000);
      const row = bot.row(world.plan);
      await driver.home();
      const item = await panelGroup(driver, bot, `task:${world.plan}`);
      return [check("his reply landed bound to the task", sent && boundTo(sent, `task:${world.plan}`), sent ? `#${sent.seq} ${short(sent.text)}` : "none"),
        check("the card's saved question is closed", closed, closed ? `${closed.id} ${closed.state}` : need ? `${need.id} ${savedQuestion(iso, bot, world.planAsk)?.state}` : "no saved question"),
        check("the bot's sign-off wait is refused", !refused.ok && /sign-off/.test(refused.err + refused.out), refused.ok ? `accepted: ${short(refused.out)}` : short(refused.err)),
        check("core does not ask it again", row?.displayState !== "needs" || !(row.needs?.options ?? []).includes("Helper tab"), row ? `${row.displayState} · ${short(row.needs?.question ?? row.line)} · options ${JSON.stringify(row.needs?.options ?? [])}` : "none"),
        check("panel does not show the answered card's buttons", !(item?.group === "needs" && item.answers.some(a => /Helper tab/.test(a))), item ?? "not shown")];
    },
  },
  {
    scenario: "reply", id: "unrelated", action: "Salem types a plain message about something else in the bot's chat: \"is the warehouse open on Friday\"", expect: "nothing closes: the LED card, the Mansoura question, the courier card and the saved ask all stay in Needs you; the bot's turn gets a note listing them",
    async run({ iso, bot, world, driver }) {
      const loose = await poll(() => savedQuestion(iso, bot, world.loose), 15_000);
      const keys = [`task:${world.card}`, `task:${world.wait}`, loose?.itemKey ?? "task:?", `task:${world.saved}`];
      await driver.openPanel(bot);
      const before = await driver.state();
      const shown = keys.map(key => before?.items.find(item => item.key === key)?.group ?? "missing");
      await driver.closePanel();
      const after = iso.lastSeq(bot.coordinator);
      await driver.typeInChat(bot.project, bot.coordinator, "is the warehouse open on Friday");
      const sent = await poll(() => salemSince(iso, bot.coordinator, after).find(m => m.text.includes("warehouse open")), 20_000);
      const note = await poll(() => iso.query("SELECT sequence AS seq, type, data FROM events WHERE thread_id=? AND sequence>? AND data LIKE '%[needs-you]%'", bot.coordinator, after)[0], 20_000);
      const listed = note ? JSON.parse(note.data) : null;
      const text = listed ? (listed.input ?? []).map(p => p.text ?? "").join(" ") : "";
      await sleep(3000);
      await driver.home();
      const states = [];
      for (const key of keys) states.push(await groupIs(driver, bot, key, "needs", "panel after"));
      return [check("all four were in Needs you before", shown.every(group => group === "needs"), shown),
        check("his message landed as Salem's", sent?.from === "salem", sent ? `#${sent.seq} ${short(sent.text)}` : "none"),
        check("the bot's turn got a hidden note listing the open questions", note && /question close/.test(text), note ? `#${note.seq} ${note.type}: ${short(text)}` : "no note"),
        ...states];
    },
  },
  {
    scenario: "reply", id: "exact-option", action: "Salem types exactly \"Bosta\" (one of the courier card's answers) in the bot's chat", expect: "the courier card closes; the LED card, the Mansoura question and the saved ask stay open",
    async run({ iso, bot, world, driver }) {
      const after = iso.lastSeq(bot.coordinator);
      await driver.typeInChat(bot.project, bot.coordinator, "Bosta");
      const sent = await poll(() => salemSince(iso, bot.coordinator, after).find(m => m.text.trim() === "Bosta"), 20_000);
      const card = await poll(() => { const q = savedQuestion(iso, bot, world.loose); return q?.closed ? q : null; }, 30_000) ?? savedQuestion(iso, bot, world.loose);
      await driver.home();
      return [check("his message landed as Salem's", sent?.from === "salem", sent ? `#${sent.seq} ${short(sent.text)}` : "none"), check("the courier card closed in core", card?.closed, card ? card.state : "none"),
        await groupIs(driver, bot, card?.itemKey ?? "task:?", null, "panel after"), await groupIs(driver, bot, `task:${world.card}`, "needs", "panel after"),
        await groupIs(driver, bot, `task:${world.wait}`, "needs", "panel after"), await groupIs(driver, bot, `task:${world.saved}`, "needs", "panel after")];
    },
  },
  {
    scenario: "reply", id: "bot-closes", action: "Salem answers the LED question in plain words (\"go with 14 percent for the panels\", not an exact answer and naming nothing); then the bot closes it with bb saelmbot question close", expect: "his message alone closes nothing; once the bot closes it the LED task leaves Needs you as answered; Mansoura and the saved ask stay open",
    async run({ iso, bot, world, driver }) {
      const after = iso.lastSeq(bot.coordinator);
      await driver.typeInChat(bot.project, bot.coordinator, "go with 14 percent for the panels");
      const sent = await poll(() => salemSince(iso, bot.coordinator, after).find(m => m.text.includes("14 percent for the panels")), 20_000);
      await sleep(4000);
      const stillOpen = bot.row(world.card);
      const record = recordOf(iso, q => q.task_id === world.card && q.state !== "closed");
      const closed = record ? iso.run(["saelmbot", "question", "close", "--id", record.id, "--json"], { thread: bot.coordinator, allowFail: true }) : { ok: false, err: "no open record (old core)" };
      const row = await coreRow(bot, world.card, r => r.displayState !== "needs");
      await driver.home();
      return [check("his message landed as Salem's", sent?.from === "salem", sent ? `#${sent.seq} ${short(sent.text)}` : "none"),
        check("his plain message left the LED question open", stillOpen?.displayState === "needs", stillOpen ? `${stillOpen.displayState} · ${short(stillOpen.line)}` : "gone"),
        check("the bot closes it with one command", closed.ok, closed.ok ? closed.out : closed.err),
        check("core: the LED task is answered, waiting for the bot", row?.displayState === "waiting" && row.later?.reason === "answered", row ? `${row.displayState} · ${short(row.line)}` : "gone"),
        await groupIs(driver, bot, `task:${world.card}`, "waiting", "panel after"), await groupIs(driver, bot, `task:${world.wait}`, "needs", "panel after"), await groupIs(driver, bot, `task:${world.saved}`, "needs", "after reload", true)];
    },
  },
  {
    scenario: "twins", id: "one-press", action: "Two release cards both offer \"Release it\": the chat video fix (asked before his last message in the chat) and the installer sign-in fix (asked after it). Salem types \"Release it\" (ERBareeq #13888, 12 Nov)", expect: "only the installer card closes; the chat video card stays in Needs you and the bot's note lists it",
    async run({ iso, bot, world, driver }) {
      const shown = [];
      for (const id of [world.video, world.installer]) shown.push(await groupIs(driver, bot, `task:${id}`, "needs", "before"));
      const video = recordOf(iso, q => q.task_id === world.video && q.state === "open");
      const after = iso.lastSeq(bot.coordinator);
      await driver.typeInChat(bot.project, bot.coordinator, "Release it");
      const sent = await poll(() => salemSince(iso, bot.coordinator, after).find(m => m.text.trim() === "Release it"), 20_000);
      const installer = await coreRow(bot, world.installer, r => r.displayState !== "needs");
      await sleep(3000);
      const still = bot.row(world.video);
      const note = await poll(() => iso.query("SELECT sequence AS seq, data FROM events WHERE thread_id=? AND sequence>? AND data LIKE '%[needs-you]%'", bot.coordinator, after)[0], 20_000);
      await driver.home();
      return [...shown, check("his message landed as Salem's", sent?.from === "salem", sent ? `#${sent.seq} ${short(sent.text)}` : "none"),
        check("core: the installer card is answered", installer?.displayState === "waiting" && installer.later?.reason === "answered", installer ? `${installer.displayState} · ${short(installer.line)}` : "gone"),
        check("core: the chat video card is still a question", still?.displayState === "needs", still ? `${still.displayState} · ${short(still.line)}` : "gone"),
        check("the bot's note lists the chat video question", note && video && note.data.includes(video.id), note ? `#${note.seq} ${video ? (note.data.includes(video.id) ? `lists ${video.id}` : `does not list ${video.id}`) : "no record"}` : "no note"),
        await groupIs(driver, bot, `task:${world.video}`, "needs", "panel after"), await groupIs(driver, bot, `task:${world.installer}`, "waiting", "panel after")];
    },
  },
  {
    scenario: "bound", id: "bound-reply", action: "Continue on \"Sohag hall\", type \"Hall B please\" after its task chip and send, while \"Banner prints\" also waits on him in the same chat", expect: "only the Sohag hall question closes (his reply names that task); Banner prints stays in Needs you",
    async run({ iso, bot, world, driver }) {
      await driver.openPanel(bot);
      await press(driver, driver.item(`task:${world.first}`).locator(".dispatch-task-continue"));
      await navigatedTo(driver, bot.coordinator);
      const box = driver.page.locator('[contenteditable="true"]').last();
      await poll(async () => (await box.innerText()).includes("Sohag"), 8_000);
      await driver.appendToComposer(" Hall B please");
      const after = iso.lastSeq(bot.coordinator);
      await driver.submit();
      const sent = await poll(() => salemSince(iso, bot.coordinator, after).find(m => m.text.includes("Hall B please")), 20_000);
      const first = await coreRow(bot, world.first, r => r.displayState !== "needs");
      await sleep(3000);
      const second = bot.row(world.second);
      await driver.home();
      return [check("his reply landed bound to Sohag hall", sent && boundTo(sent, `task:${world.first}`), sent ? `#${sent.seq} ${short(sent.text)}` : "none"),
        check("Sohag hall leaves Needs you in core", first?.displayState !== "needs", first ? `${first.displayState} · ${short(first.line)}` : "gone"),
        check("Banner prints still needs him in core", second?.displayState === "needs", second ? `${second.displayState} · ${short(second.line)}` : "gone"),
        await groupIs(driver, bot, `task:${world.first}`, "waiting", "panel after"), await groupIs(driver, bot, `task:${world.second}`, "needs", "panel after")];
    },
  },
  {
    scenario: "relay", id: "not-his", action: "Another thread sends \"yes renew\" into the bot's chat (not Salem)", expect: "the question stays open: only Salem's own verified reply closes it",
    async run({ iso, bot, world, driver }) {
      const seq = await bot.salem("yes renew", await iso.relay());
      await sleep(4000);
      const row = bot.row(world.ask);
      const message = iso.messages(bot.coordinator, seq - 1).find(m => m.seq === seq);
      return [check("the message landed in the chat", !!message, message ? `#${message.seq} ${message.from} ${short(message.text)}` : "none"),
        check("core keeps the question open", row?.displayState === "needs", row ? `${row.displayState} · ${short(row.line)}` : "gone"),
        await groupIs(driver, bot, `task:${world.ask}`, "needs", "panel")];
    },
  },
  {
    scenario: "relay", id: "sign-off-refused", action: "The bot tries to park \"Footer typo\" on Salem only for sign-off: a wait owned by him with reason \"acceptance: the footer typo is fixed on the live site\" and no question", expect: "core refuses it and tells the bot to finish the work itself or ask a real question under the task chip; nothing shows in Needs you",
    async run({ bot, world, driver }) {
      const refused = bot.change(world.signoff, { action: "wait", owner: "salem", reason: "acceptance: the footer typo is fixed on the live site" }, { allowFail: true });
      const task = bot.get(world.signoff);
      const row = bot.row(world.signoff);
      return [check("refused", !refused.ok, refused.ok ? `accepted: ${short(refused.out)}` : short(refused.err)),
        check("the refusal says finish it or ask under the task chip", /sign-off/.test(refused.err) && /finish/.test(refused.err) && /task chip/.test(refused.err), short(refused.err)),
        check("the task is not waiting on Salem", !(task.state === "waiting" && task.wait?.owner === "salem"), `${task.state} ${task.wait?.owner ?? ""}`),
        check("core: not a question", row?.displayState !== "needs", row ? `${row.displayState} · ${short(row.line)}` : "gone"), await outOfNeeds(driver, bot, `task:${world.signoff}`, "panel")];
    },
  },
  {
    scenario: "relay", id: "wait-then-ask", action: "In one turn the bot sets \"Cable spools\" waiting on Salem, then ends the turn with its question under the task chip (the order real bots use: 64 of 197 waits last week)", expect: "the wait is held while the turn runs and kept when the reply asks; the question shows in Needs you",
    async run({ bot, world, driver }) {
      const set = await bot.duringTurn(`${chip(world.spools)}\nOrder 12 cable spools from Elsewedy for the Nasr City site?`, () => bot.change(world.spools, { action: "wait", owner: "salem", reason: "his go on the cable spools order" }, { allowFail: true }));
      await sleep(3000);
      const task = bot.get(world.spools);
      const row = await coreRow(bot, world.spools, r => r.displayState === "needs");
      return [check("the wait is accepted while the turn runs", set.ok, set.ok ? "accepted" : short(set.err)),
        check("after the turn it still waits on Salem", task.state === "waiting" && task.wait?.owner === "salem", `${task.state} ${task.wait?.owner ?? ""}`),
        check("core: the question is in Needs you", row?.displayState === "needs" && /cable spools/i.test(row.needs?.question ?? ""), row ? `${row.displayState} · ${short(row.needs?.question ?? row.line)}` : "gone"),
        await groupIs(driver, bot, `task:${world.spools}`, "needs", "panel")];
    },
  },
  {
    scenario: "relay", id: "wait-then-nothing", action: "In one turn the bot sets \"Price list PDF\" waiting on Salem for acceptance, then ends the turn with a plain result and no question", expect: "when the turn ends core undoes the wait (the task is back to checking) and the bot gets a quiet note; nothing shows in Needs you",
    async run({ iso, bot, world, driver }) {
      const after = iso.lastSeq(bot.coordinator);
      const set = await bot.duringTurn("The price list PDF is regenerated and uploaded to the shared folder.", () => bot.change(world.pdf, { action: "wait", owner: "salem", reason: "acceptance: the price list PDF is regenerated" }, { allowFail: true }));
      const task = await poll(() => { const t = bot.get(world.pdf); return t.state !== "waiting" ? t : null; }, 20_000) ?? bot.get(world.pdf);
      const note = await poll(() => iso.query("SELECT sequence AS seq, type FROM events WHERE thread_id=? AND sequence>? AND data LIKE '%Wait refused%'", bot.coordinator, after)[0], 20_000);
      return [check("the wait is accepted while the turn runs", set.ok, set.ok ? "accepted" : short(set.err)),
        check("when the turn ends the wait is undone", task.state === "checking", `${task.state} ${task.wait?.owner ?? ""}`),
        check("the bot gets the quiet refusal note", note, note ? `#${note.seq} ${note.type}` : "no note"), await outOfNeeds(driver, bot, `task:${world.pdf}`, "panel")];
    },
  },
  {
    scenario: "relay", id: "wait-then-step", action: "In one turn the bot sets \"Pricelist tunnel\" waiting on Salem (he must enter his sudo password) and ends the turn with a line under the task chip that states the step without a question mark (Security #19818, 11 Nov)", expect: "the wait is kept and Needs you shows the step: the line's lead and the wait's reason",
    async run({ bot, world, driver }) {
      const reason = "The pricelist tunnel restart needs Salem to enter his sudo password; public access remains unavailable until then.";
      const set = await bot.duringTurn(`${chip(world.tunnel)}\n**Pricelist access:** The site still returns Cloudflare 523. The restart requires your sudo password, and the prompt timed out without changing anything. Tell me when ready and I'll reopen the prompt, then verify the public site.`,
        () => bot.change(world.tunnel, { action: "wait", owner: "salem", reason }, { allowFail: true }));
      await sleep(3000);
      const task = bot.get(world.tunnel);
      const row = await coreRow(bot, world.tunnel, r => r.displayState === "needs");
      return [check("the wait is accepted while the turn runs", set.ok, set.ok ? "accepted" : short(set.err)),
        check("after the turn it still waits on Salem", task.state === "waiting" && task.wait?.owner === "salem", `${task.state} ${task.wait?.owner ?? ""}`),
        check("core: Needs you asks the step", row?.displayState === "needs" && /^Pricelist access/.test(row.needs?.question ?? "") && (row.needs?.question ?? "").includes("sudo password"), row ? `${row.displayState} · ${short(row.needs?.question ?? row.line)}` : "gone"),
        await groupIs(driver, bot, `task:${world.tunnel}`, "needs", "panel")];
    },
  },
  {
    scenario: "relay", id: "acceptance-with-section", action: "In one turn the bot sets \"Home banner\" waiting on Salem with reason \"acceptance: the new banner is live\" and writes its result under the task chip", expect: "his sign-off rule wins: the wait is undone when the turn ends and nothing shows in Needs you",
    async run({ iso, bot, world, driver }) {
      const after = iso.lastSeq(bot.coordinator);
      const set = await bot.duringTurn(`${chip(world.banner)}\n**Home banner:** The new banner is live on the home page.`, () => bot.change(world.banner, { action: "wait", owner: "salem", reason: "acceptance: the new banner is live" }, { allowFail: true }));
      const task = await poll(() => { const t = bot.get(world.banner); return t.state !== "waiting" ? t : null; }, 20_000) ?? bot.get(world.banner);
      const note = await poll(() => iso.query("SELECT sequence AS seq, type FROM events WHERE thread_id=? AND sequence>? AND data LIKE '%Wait refused%'", bot.coordinator, after)[0], 20_000);
      return [check("the wait is accepted while the turn runs", set.ok, set.ok ? "accepted" : short(set.err)),
        check("when the turn ends the wait is undone", task.state === "checking", `${task.state} ${task.wait?.owner ?? ""}`),
        check("the bot gets the quiet refusal note", note, note ? `#${note.seq} ${note.type}` : "no note"), await outOfNeeds(driver, bot, `task:${world.banner}`, "panel")];
    },
  },
  {
    scenario: "decision", id: "decision-line", action: "The bot's reply carries a \"Decision needed:\" line (no card, no task)", expect: "it shows once as a question in Needs you; pressing its first answer sends it to the chat as Salem's, bound to that question, and the question closes",
    async run(context) {
      const { iso, bot, world, driver } = context;
      const saved = await poll(() => savedQuestion(iso, bot, world.line) ?? (() => { const item = iso.needs().find(i => i.bot === bot.key && i.kind === "decision" && /office internet/.test(i.text)); return item ? { id: item.id, closed: !["open", "reminded"].includes(item.state), state: item.state, itemKey: `task:${item.id}`, bindId: `question:${item.id}` } : null; })(), 30_000);
      if (!saved) return [check("core saved the decision line as a question", false, "none")];
      await driver.openPanel(bot);
      const item = await driver.where(saved.itemKey);
      const label = item?.answers?.[0] ?? "";
      const steps = label ? await answer(context, { key: saved.itemKey, text: label, itemId: saved.bindId }) : [check("answer buttons", false, item ?? "missing")];
      const closed = await poll(() => { const q = savedQuestion(iso, bot, world.line); if (q) return q.closed ? q : null; const n = iso.needs().find(i => i.id === saved.id); return n && !["open", "reminded"].includes(n.state) ? n : null; }, 30_000);
      return [check("one question in Needs you for the line", item?.group === "needs", item ?? "missing"), ...steps, check("core closes it", closed, closed ? closed.state : "open"), await groupIs(driver, bot, saved.itemKey, null, "after reload", true)];
    },
  },
  {
    scenario: "outside", id: "thread-question", action: "A thread in a project no bot owns asks a native question; then it is answered", expect: "the sidebar's Needs you lists it (from core's list); once the question is answered it leaves",
    async run({ iso, world, driver }) {
      await driver.home();
      await driver.stripOpen();
      const strip = await poll(async () => { const items = await driver.strip(); return items.some(item => item.kind === "thread") ? items : null; }, 30_000, 1_500) ?? await driver.strip();
      const listed = strip.find(item => item.kind === "thread");
      const pending = iso.pending(world.outside.threadId)[0];
      const reply = pending ? iso.answer(world.outside.threadId, pending) : null;
      await sleep(2500);
      const answered = iso.pending(world.outside.threadId).length === 0;
      await driver.home();
      await driver.stripOpen();
      const gone = await poll(async () => { const items = await driver.strip(); return items.some(item => item.kind === "thread") ? null : items; }, 30_000, 1_500);
      return [check("Needs you lists the outside thread's question", !!listed, listed ?? strip),
        check("the native question was answered", answered, pending ? `${pending.id} ${reply?.ok ? "answered" : reply?.err ?? ""}` : "no pending interaction"),
        check("it leaves Needs you", !!gone, gone ?? await driver.strip())];
    },
  },
  {
    scenario: "parked", id: "parked-worker", action: "A done task whose idle worker has a message scheduled for tomorrow, next to an open task whose only worker is parked the same way", expect: "the done task sits in Done (its worker is not running); the open task is Waiting with its worker's wake time, not Working; the header counts no workers running",
    async run({ iso, bot, world, driver }) {
      const queued = [world.doneWorker, world.openWorker].map(id => { const { ok, out } = iso.run(["thread", "queue", "list", id, "--json"], { allowFail: true }); const list = ok ? JSON.parse(out) : []; return (Array.isArray(list) ? list : list.queuedMessages ?? list.items ?? []).map(q => `${q.state} ${q.sendAt ? new Date(q.sendAt).toISOString() : ""}`); });
      const done = await coreRow(bot, world.done, r => r.displayState === "done");
      const open = bot.row(world.open);
      await driver.openPanel(bot);
      await sleep(1500);
      const state = await driver.state();
      const at = id => state?.items.find(item => item.key === `task:${id}`);
      const head = state?.sections.find(section => section.group === "working")?.head ?? "";
      return [check("both workers have a message scheduled for tomorrow", queued.every(rows => rows.some(row => /^scheduled/.test(row))), queued),
        check("core: the done task is done, not running", done?.displayState === "done" && !/still running/.test(done.line), done ? `${done.displayState} · ${short(done.line)}` : "gone"),
        check("core: the open task waits on its worker's wake", open?.displayState === "waiting" && /wakes/.test(open.line) && open.wakeAt !== undefined, open ? `${open.displayState} · ${short(open.line)} · wakeAt ${open.wakeAt ?? "none"}` : "gone"),
        check("panel: the done task is in Done", at(world.done)?.group === "done", at(world.done) ?? "missing"),
        check("panel: the open task is in Waiting", at(world.open)?.group === "waiting", at(world.open) ?? "missing"),
        check("panel: no workers counted as running", !/workers? running/.test(head) && !state?.items.some(item => item.group === "working"), { head, working: state?.items.filter(item => item.group === "working").map(item => item.key) ?? [] })];
    },
  },
  {
    scenario: "ended", id: "task-resumed", action: "The bot resumes \"Invoice footer\" (no longer waiting on Salem)", expect: "its question ends and it leaves Needs you",
    async run({ iso, bot, world, driver }) {
      await driver.openPanel(bot);
      const before = await driver.where(`task:${world.resumed}`);
      bot.resume(world.resumed);
      const row = await coreRow(bot, world.resumed, r => r.displayState !== "needs");
      const record = recordOf(iso, q => q.task_id === world.resumed);
      return [check("it was in Needs you", before?.group === "needs", before ?? "missing"), check("core: no longer a question", row?.displayState !== "needs", row ? `${row.displayState} · ${short(row.line)}` : "gone"),
        check("core record ended", !record || record.closed_by === "ended", record ? `${record.state} by ${record.closed_by}` : "old core"), await outOfNeeds(driver, bot, `task:${world.resumed}`, "panel after")];
    },
  },
  {
    scenario: "ended", id: "task-finished", action: "The bot finishes \"Stock report\"", expect: "its question ends; the task moves to Done",
    async run({ iso, bot, world, driver }) {
      await bot.finish(world.finished, "Stock report sent to Sherif.");
      const row = await coreRow(bot, world.finished, r => r.displayState === "done");
      const record = recordOf(iso, q => q.task_id === world.finished);
      return [check("core: done", row?.displayState === "done", row ? `${row.displayState} · ${short(row.line)}` : "gone"), check("core record ended", !record || record.closed_by === "ended", record ? `${record.state} by ${record.closed_by}` : "old core"),
        await groupIs(driver, bot, `task:${world.finished}`, "done", "after reload", true)];
    },
  },
  {
    scenario: "ended", id: "need-done", action: "The bot marks its saved ask \"Approve the January rent transfer?\" done", expect: "the question ends and leaves Needs you",
    async run({ iso, bot, world, driver }) {
      await driver.openPanel(bot);
      const before = await driver.where(`task:${world.need}`);
      bot.needDone(world.need);
      await sleep(2000);
      const record = recordOf(iso, q => q.need_id === world.need);
      return [check("it was in Needs you", before?.group === "needs", before ?? "missing"), check("core record ended", !record || record.closed_by === "ended", record ? `${record.state} by ${record.closed_by}` : "old core"),
        await groupIs(driver, bot, `task:${world.need}`, null, "panel after")];
    },
  },
  {
    scenario: "ended", id: "desk-working", action: "The desk \"Samir Adel · Quote for 10 drums\" moves from draft to working", expect: "its question ends and it leaves Needs you for Working",
    async run({ iso, bot, world, driver }) {
      const key = deskKey(iso, bot, world.desk.threadId);
      await driver.openPanel(bot);
      const before = await driver.where(key);
      bot.deskStatus(world.desk.threadId, "working");
      const after = await groupIs(driver, bot, key, "working", "panel after");
      const record = recordOf(iso, q => q.desk_id === key.slice(5));
      return [check("it was in Needs you", before?.group === "needs", before ?? "missing"), after, check("core record ended", !record || record.closed_by === "ended", record ? `${record.state} by ${record.closed_by}` : "old core")];
    },
  },
  {
    scenario: "ended", id: "form-answered", action: "The worker's native question on \"Bank statement\" is answered", expect: "its question ends and the task leaves Needs you",
    async run({ iso, bot, world, driver }) {
      const shown = await coreRow(bot, world.form, r => r.displayState === "needs" && !!r.needs?.interactionId);
      const pending = iso.pending(world.formWorker)[0];
      const reply = pending ? iso.answer(world.formWorker, pending) : null;
      const row = await coreRow(bot, world.form, r => r.displayState !== "needs");
      const record = recordOf(iso, q => q.interaction_id === pending?.id);
      return [check("it was a question in core", shown?.needs?.interactionId, shown ? `${shown.displayState} · ${short(shown.needs?.question)}` : "none"), check("answered", pending && iso.pending(world.formWorker).length === 0, pending ? `${pending.id} ${reply?.ok ? "answered" : reply?.err ?? ""}` : "none"),
        check("core: no longer a question", row?.displayState !== "needs", row ? `${row.displayState} · ${short(row.line)}` : "gone"), check("core record ended", !record || record.closed_by === "ended", record ? `${record.state} by ${record.closed_by}` : "old core")];
    },
  },
];


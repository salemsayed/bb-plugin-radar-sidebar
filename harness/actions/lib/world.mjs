import { buttons, chip, form, radio } from "./seed.mjs";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export const PHASES = [
  { name: "two days ago", offset: -2 * DAY - 2 * HOUR },
  { name: "yesterday", offset: -DAY },
  { name: "thirteen hours ago", offset: -13 * HOUR },
  { name: "now", offset: 0 },
];

const stalePlanCard = id => `${chip(id)}\n\n**Technician dashboard spec:** your Master Technician list fills the referral gap. How should the bot read it?\n\n${buttons("How should the bot read the Master Technician list?", ["Helper tab", "Admin upload", "Google service account"])}`;

export const SCENARIOS = [
  {
    key: "buttons", name: "Buttons Bot",
    async now(bot, w) {
      w.drums = await bot.task({ ask: "Please price the new cable drums", title: "Cable drum prices" });
      w.drumsCard = `${chip(w.drums)}\nThe cable drum prices are ready. Which margin should I use?\n\n${radio("Cable drum margin?", "Which margin?", ["12 percent", "15 percent", "18 percent"], { recommended: "12 percent" })}`;
      w.drumsAsk = await bot.say(w.drumsCard);
      bot.waitOnSalem(w.drums, "Which margin for the cable drums?");
    },
  },
  {
    key: "choice", name: "Choice Bot",
    async now(bot, w) {
      w.van = await bot.task({ ask: "Book a van for the Alexandria order", title: "Alexandria van" });
      w.vanAsk = await bot.say(`${chip(w.van)}\nTwo vans are free tomorrow morning.\n\n${buttons("Which van for Alexandria?", ["Van 1", "Van 2", "Wait for tomorrow"])}`);
      bot.waitOnSalem(w.van, "Which van for Alexandria?");
    },
  },
  {
    key: "form", name: "Form Bot",
    async now(bot, w) {
      w.contact = await bot.task({ ask: "Update the store contact page", title: "Store contact details" });
      w.contactAsk = await bot.say(`${chip(w.contact)}\nI need three details for the contact page.\n\n${form("Store contact details", [{ label: "Which phone number?", options: ["Main line", "Mobile"] }, { label: "Which email?", options: ["sales@", "support@"] }, { label: "Opening hours" }])}`);
      bot.waitOnSalem(w.contact, "Store contact details for the page?");
    },
  },
  {
    key: "later", name: "Later Bot",
    async now(bot, w) {
      w.deploy = await bot.task({ ask: "Fix the price rounding bug", title: "Price fix deploy" });
      w.tap = await bot.task({ ask: "Check the Tanta stock count", title: "Tanta stock count" });
      await bot.askThenWait(w.deploy, "Deploy the price fix to production?");
      await bot.askThenWait(w.tap, "Recount the Tanta shelves this week?");
    },
  },
  {
    key: "questions", name: "Question Bot",
    async now(bot, w) {
      w.supplierAsk = await bot.say(`The cable quotes are in.\n\n${buttons("Which supplier for the cable?", ["Elsewedy", "Cairo Cables"])}`);
      w.renew = bot.need("Renew the Vodafone line for 12 months?", { recommend: "Renew" }).item.id;
    },
  },
  {
    key: "old", name: "Old Ask Bot",
    async "thirteen hours ago"(bot, w) {
      w.contract = await bot.task({ ask: "Renew the supplier contract", title: "Supplier contract" });
      await bot.askThenWait(w.contract, "Sign the supplier contract renewal?");
    },
    async now(bot, w) {
      await bot.say("Working on the other things meanwhile.");
      w.fresh = await bot.task({ ask: "Order more packing tape", title: "Packing tape" });
      await bot.askThenWait(w.fresh, "Order 40 rolls of packing tape?");
    },
  },
  {
    key: "native", name: "Interaction Bot",
    async now(bot, w) {
      w.login = await bot.task({ ask: "Download the supplier invoices", title: "Supplier invoices" });
      w.loginWorker = await bot.worker(w.login, { title: "Supplier invoices worker", prompt: "ask_user which invoices" });
    },
  },
  {
    key: "work", name: "Work Bot",
    async "two days ago"(bot, w) {
      w.overdue = await bot.task({ ask: "Follow up the courier refund", title: "Courier refund" });
      bot.waitOutside(w.overdue, "Waiting for the courier's refund email", bot.at(HOUR));
    },
    async "thirteen hours ago"(bot, w) {
      w.checked = await bot.task({ ask: "Import the October orders", title: "October orders import", criteria: ["All October orders imported"] });
      await bot.worker(w.checked, { title: "October orders worker", prompt: "Import the October orders" });
      w.checkedResult = await bot.say("Imported 410 of 412 October orders; 2 failed.");
      bot.change(w.checked, { action: "report", source: { threadId: bot.coordinator, seq: w.checkedResult } });
      bot.change(w.checked, { action: "check", criterion: "All October orders imported", status: "fail", source: { threadId: bot.coordinator, seq: w.checkedResult }, checkedBy: bot.coordinator });
    },
    async now(bot, w) {
      w.building = await bot.task({ ask: "Build the shelf report", title: "Shelf report" });
      w.buildingWorker = await bot.worker(w.building, { title: "Shelf report worker" });
      w.outside = await bot.task({ ask: "Get the new price list from Elsewedy", title: "Elsewedy price list" });
      bot.waitOutside(w.outside, "Waiting for Elsewedy to send the price list", bot.at(3 * HOUR));
      w.filed = await bot.task({ ask: "Plan the Sohag seminar", title: "Sohag seminar" });
      w.retry = await bot.task({ ask: "Resize the product photos", title: "Product photos" });
      w.retryWorker = await bot.worker(w.retry, { title: "Product photos worker", prompt: "fail_turn:resize_crashed recover:overloaded" });
      w.loose = await bot.worker(null, { title: "Look into the slow checkout" });
    },
  },
  {
    key: "desks", name: "Desk Bot",
    async "two days ago"(bot, w) {
      w.lateDesk = await bot.desk({ key: "chat:mona-7", title: "Chat · Mona Adel · Return of order 7731" });
      bot.deskStatus(w.lateDesk.threadId, "waiting", ["--for", "Mona"]);
      bot.deskWake(w.lateDesk.threadId, bot.at(HOUR), "Check whether Mona sent the photos");
    },
    async now(bot, w) {
      w.draftDesk = await bot.desk({ key: "chat:ahmed-1", title: "Chat · Ahmed Samir · Delivery date for order 5521" });
      bot.deskStatus(w.draftDesk.threadId, "draft");
      w.blockedDesk = await bot.desk({ key: "chat:hany-2", title: "Chat · Hany Fawzy · Wholesale price for 40 drums" });
      bot.deskStatus(w.blockedDesk.threadId, "blocked");
      w.workingDesk = await bot.desk({ key: "chat:sara-3", title: "Chat · Sara Nabil · Invoice copy for October" });
      bot.deskStatus(w.workingDesk.threadId, "working");
      w.waitingDesk = await bot.desk({ key: "chat:omar-4", title: "Chat · Omar Said · Warranty claim 2290" });
      bot.deskStatus(w.waitingDesk.threadId, "waiting", ["--for", "Omar"]);
      bot.deskWake(w.waitingDesk.threadId, bot.at(20 * HOUR), "Ask Omar again for the serial number");
      w.infoDesk = await bot.desk({ key: "chat:lina-5", title: "Chat · Lina Magdy · Store hours question" });
      bot.deskStatus(w.infoDesk.threadId, "info");
      w.doneDesk = await bot.desk({ key: "chat:tarek-6", title: "Chat · Tarek Ali · Delivery confirmed" });
      bot.deskStatus(w.doneDesk.threadId, "done");
      w.deferredDesk = await bot.desk({ key: "chat:nour-8", title: "Chat · Nour Hassan · Bulk order quote", prompt: "no_capacity Quote the bulk order" });
    },
  },
  {
    key: "done", name: "History Bot",
    async "two days ago"(bot, w) {
      for (const title of ["Courier contract", "Sohag invoices"]) { const id = await bot.task({ ask: `Handle the ${title.toLowerCase()}`, title }); await bot.finish(id, `${title} handled.`); }
    },
    async yesterday(bot, w) {
      for (const title of ["Giza pallet count", "Price list upload"]) { const id = await bot.task({ ask: `Handle the ${title.toLowerCase()}`, title }); await bot.finish(id, `${title} handled.`); }
    },
    async now(bot, w) {
      w.doneToday = [];
      for (const title of ["Shelf labels", "Van booking", "Supplier call notes", "Stock export", "Banner resize"]) { const id = await bot.task({ ask: `Handle the ${title.toLowerCase()}`, title }); await bot.finish(id, `${title} handled.`); w.doneToday.push(id); }
      w.cancelled = await bot.task({ ask: "Book the Aswan trip", title: "Aswan trip" });
      await bot.cancel(w.cancelled, "Cancel the Aswan trip, not needed any more");
    },
  },
  {
    key: "crowded", name: "Busy Bot",
    async now(bot, w) {
      w.asks = [];
      const asks = [["Ataba branch hours", "Open the Ataba branch on Fridays?"], ["Review requests", "Send review requests to every buyer?"], ["Banner text", "Use the Arabic banner text on the home page?"], ["Refund policy", "Extend refunds to 30 days?"]];
      for (const [title] of asks) w.asks.push(await bot.task({ ask: `Look at the ${title.toLowerCase()}`, title }));
      w.working = [];
      for (const title of ["Catalog sync", "Courier labels", "Price audit"]) { const id = await bot.task({ ask: `Do the ${title.toLowerCase()}`, title }); await bot.worker(id, { title: `${title} worker` }); w.working.push(id); }
      for (const title of ["Supplier reply", "Bank transfer", "Customs papers"]) { const id = await bot.task({ ask: `Chase the ${title.toLowerCase()}`, title }); bot.waitOutside(id, `Waiting for the ${title.toLowerCase()}`, bot.at(5 * HOUR)); }
      w.deskAsk = await bot.desk({ key: "chat:yara-9", title: "Chat · Yara Fathy · Discount for 12 drums" });
      bot.deskStatus(w.deskAsk.threadId, "draft");
      for (const title of ["Shelf photos", "Stock alert", "Invoice batch", "Promo email", "Courier pickup", "Price tags"]) { const id = await bot.task({ ask: `Handle the ${title.toLowerCase()}`, title }); await bot.finish(id, `${title} done.`); }
      for (const [i, [, reason]] of asks.entries()) await bot.askThenWait(w.asks[i], reason);
    },
  },
  {
    key: "arabic", name: "Arabic Bot",
    async now(bot, w) {
      w.margin = await bot.task({ ask: "سعّر بكرات الكابلات الجديدة", title: "أسعار بكرات الكابلات" });
      w.marginAsk = await bot.say(`${chip(w.margin)}\nالأسعار جاهزة. أي هامش ربح أستخدم؟\n\n${radio("هامش ربح البكرات؟", "أي هامش؟", ["١٢٪", "١٥٪"], { recommended: "١٢٪" })}`);
      bot.waitOnSalem(w.margin, "أي هامش ربح لبكرات الكابلات؟");
      w.arabicDesk = await bot.desk({ key: "chat:mahmoud-10", title: "محادثة · محمود جمال · موعد تسليم الطلب ٥٥٢١" });
      bot.deskStatus(w.arabicDesk.threadId, "draft");
    },
  },
  {
    key: "closed", name: "Returns Bot",
    async now(bot, w) {
      w.live = [];
      for (const title of ["Container split", "BF dashboard", "Technician dashboard"]) { const id = await bot.task({ ask: `Work on the ${title}`, title }); await bot.worker(id, { title: `${title} worker` }); w.live.push(id); }
      w.stock = await bot.task({ ask: "Move the R-000230 stock to United", title: "R-000230 stock to United" });
      await bot.worker(w.stock, { title: "R-000230 worker", prompt: "hold_turn Reporting what the next return run will post" });
      w.returns = await bot.task({ ask: "Handle the discontinued-code returns", title: "Discontinued-code returns" });
      await bot.worker(w.returns, { title: "Returns worker", prompt: "hold_turn Reporting what the next return run will post" });
      w.idle = await bot.task({ ask: "Post the October return run", title: "October return run" });
      await bot.worker(w.idle, { title: "October run worker", prompt: "Posted the October return run" });
      await bot.finish(w.stock, "R-000230 stock moved to United.");
      await bot.cancel(w.returns, "Stop the discontinued-code returns, I closed them myself");
      await bot.finish(w.idle, "October return run posted.");
    },
  },
  {
    key: "quiet", name: "Quiet Bot",
    async now() {},
  },
  {
    key: "stale", name: "Stale Ask Bot",
    async now(bot, w) {
      w.plan = await bot.task({ ask: "Write the technician dashboard spec", title: "Technician dashboard spec" });
      w.planAsk = await bot.say(stalePlanCard(w.plan));
      bot.waitOnSalem(w.plan, "How should the bot read the Master Technician list?");
    },
  },
  {
    key: "reply", name: "Reply Bot",
    async now(bot, w) {
      w.card = await bot.task({ ask: "Price the new LED panels", title: "LED panel prices" });
      w.wait = await bot.task({ ask: "Check the Mansoura delivery", title: "Mansoura delivery" });
      w.loose = await bot.say(`The courier quotes are in.\n\n${buttons("Which courier for Aswan?", ["Bosta", "Aramex"])}`);
      w.cardAsk = await bot.say(`${chip(w.card)}\nThe LED panel prices are ready.\n\n${buttons("Which LED panel margin?", ["10 percent", "14 percent"])}`, { about: w.card });
      bot.waitOnSalem(w.card, "Which margin for the LED panels?");
      await bot.askThenWait(w.wait, "Send the Mansoura delivery today?");
      w.saved = bot.need("Book the Aswan courier for Thursday?").item.id;
    },
  },
  {
    key: "twins", name: "Release Bot",
    async now(bot, w) {
      w.video = await bot.task({ ask: "Fix the chat video bug", title: "Chat video fix" });
      w.installer = await bot.task({ ask: "Fix the installer sign-in", title: "Installer sign-in fix" });
      w.videoAsk = await bot.say(`${chip(w.video)}\nThe chat video fix is tested.\n\n${buttons("Release the chat video fix?", ["Release it", "Not now"])}`, { about: w.video });
      bot.waitOnSalem(w.video, "Release the chat video fix?");
      w.installerAsk = await bot.say(`${chip(w.installer)}\nThe installer sign-in fix is tested.\n\n${buttons("Release the installer sign-in fix?", ["Release it", "Not now"])}`, { about: w.installer });
      bot.waitOnSalem(w.installer, "Release the installer sign-in fix?");
    },
  },
  {
    key: "bound", name: "Bound Bot",
    async now(bot, w) {
      w.first = await bot.task({ ask: "Book the Sohag hall", title: "Sohag hall" });
      w.second = await bot.task({ ask: "Order the banner prints", title: "Banner prints" });
      w.firstAsk = await bot.say(`${chip(w.first)}\nTwo halls are free on the 20th.\n\n${buttons("Which hall for Sohag?", ["Hall A", "Hall B"])}`);
      bot.waitOnSalem(w.first, "Which hall for Sohag?");
      await bot.askThenWait(w.second, "Print 20 banners for Sohag?");
    },
  },
  {
    key: "relay", name: "Relay Bot",
    async now(bot, w) {
      w.ask = await bot.task({ ask: "Renew the domain", title: "Domain renewal" });
      w.signoff = await bot.task({ ask: "Fix the footer typo", title: "Footer typo" });
      w.spools = await bot.task({ ask: "Get cable spools for the Nasr City site", title: "Cable spools" });
      w.pdf = await bot.task({ ask: "Regenerate the price list PDF", title: "Price list PDF" });
      w.tunnel = await bot.task({ ask: "Bring the pricelist site back", title: "Pricelist tunnel" });
      w.banner = await bot.task({ ask: "Put up the new home banner", title: "Home banner" });
      await bot.askThenWait(w.ask, "Renew the bareeq domain for two years?");
    },
  },
  {
    key: "decision", name: "Decision Bot",
    async now(bot, w) {
      w.line = await bot.say("The office internet contract ends Friday.\n\nDecision needed: renew the office internet for a year or switch to the 5G line? I recommend Renew");
    },
  },
  {
    key: "outside", name: "Outside Bot",
    async now(bot, w) {
      w.outside = await bot.outsideQuestion("Release notes check");
    },
  },
  {
    key: "parked", name: "Parked Bot",
    async now(bot, w) {
      w.done = await bot.task({ ask: "Cap the reps at 5 offers a day", title: "Rep daily cap" });
      w.open = await bot.task({ ask: "Check the rep cap tomorrow morning", title: "Rep cap check" });
      w.doneWorker = await bot.worker(w.done, { title: "Rep daily cap worker", prompt: "Capped the reps at 5 offers a day" });
      w.openWorker = await bot.worker(w.open, { title: "Rep cap check worker", prompt: "Looked at today's offers" });
      await bot.iso.idle(w.doneWorker);
      await bot.iso.idle(w.openWorker);
      bot.scheduleFor(w.doneWorker, "1d", "Fallback wake: check the cap held overnight");
      bot.scheduleFor(w.openWorker, "1d", "Fallback wake: recount tomorrow's offers");
      await bot.finish(w.done, "The rep cap is live: 5 offers a day.");
    },
  },
  {
    key: "ended", name: "Ending Bot",
    async now(bot, w) {
      w.resumed = await bot.task({ ask: "Fix the invoice footer", title: "Invoice footer" });
      w.finished = await bot.task({ ask: "Send the stock report", title: "Stock report" });
      w.form = await bot.task({ ask: "Download the bank statement", title: "Bank statement" });
      await bot.askThenWait(w.resumed, "Use the new invoice footer?");
      await bot.askThenWait(w.finished, "Send the stock report to Sherif?");
      w.need = bot.need("Approve the January rent transfer?").item.id;
      w.desk = await bot.desk({ key: "chat:samir-11", title: "Chat · Samir Adel · Quote for 10 drums" });
      bot.deskStatus(w.desk.threadId, "draft");
      w.formWorker = await bot.worker(w.form, { title: "Bank statement worker", prompt: "ask_user which statement" });
    },
  },
];

export async function seed(iso, bots, phase, only, log) {
  for (const scenario of SCENARIOS) {
    if (only && !only.has(scenario.key)) continue;
    const step = scenario[phase.name];
    if (!step) continue;
    const started = Date.now();
    bots[scenario.key].offset = phase.offset;
    await step(bots[scenario.key], bots[scenario.key].world);
    log(`seeded ${scenario.key} (${phase.name}) in ${((Date.now() - started) / 1000).toFixed(1)} s`);
  }
}

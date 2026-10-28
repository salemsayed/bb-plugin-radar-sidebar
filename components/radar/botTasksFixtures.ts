import type { BotTasks, BotTasksOutput, DisplayState, TaskRow } from "@/lib/tasks-v2-types";
import { HOUR, MINUTE, NOW } from "./fixtures";

/**
 * bot_tasks responses for the Bots view's tests and the visual harness, shaped
 * exactly as the shared tasks v2 contract types. Titles and lines come from the
 * plan's mock of a real day (28 Oct).
 */

type BotSeed = Pick<BotTasks, "key" | "name" | "order"> & { color?: string };
export const BOT_SEEDS: BotSeed[] = [
  { key: "erbareeq", name: "ERBareeq Bot", order: 0 },
  { key: "bricks", name: "Bricks Bot", order: 1 },
  { key: "lab", name: "Lab Bot", order: 2, color: "#7b61d9" },
  { key: "home", name: "Home Bot", order: 3 },
  { key: "personal", name: "Personal Bot", order: 4 },
  { key: "work", name: "Work Bot", order: 5 },
];

let serial = 0;
export function makeTask(bot: string, title: string, displayState: DisplayState, extra: Partial<TaskRow> = {}): TaskRow {
  serial += 1;
  const id = extra.id ?? `ptask_${bot}_${serial}`;
  return {
    id, bot, title, displayState, line: "", ageMs: HOUR, conversationThreadId: `thr_task_${id}`,
    tags: [], origin: "verified", observedAt: NOW, ...extra,
  };
}

export function makeBot(seed: BotSeed, tasks: TaskRow[], extra: Partial<BotTasks> = {}): BotTasks {
  const count = (states: DisplayState[]) => tasks.filter(task => states.includes(task.displayState)).length;
  return {
    ...seed,
    coordinatorThreadId: `thr_coord_${seed.key}`,
    tasksV2: true,
    summary: {
      needs: count(["needs"]), working: count(["working", "checking", "retrying"]), queued: count(["queued", "ready"]),
      offline: count(["offline"]), waiting: count(["waiting", "overdue"]), done: count(["done"]),
    },
    tasks,
    unlinked: [],
    ...extra,
  };
}

/** The interaction-level Needs list a core builds from tasks in the needs state. */
export function makeOutput(bots: BotTasks[], extra: Partial<BotTasksOutput> = {}): BotTasksOutput {
  const needs = bots.flatMap(bot => bot.tasks.flatMap(task => task.needs ? [{
    bot: bot.key, taskId: task.id, threadId: task.needs.threadId, interactionId: task.needs.interactionId, question: task.needs.question,
  }] : []));
  return { bots, needs, notFiled: [], observedAt: NOW, ...extra };
}

function ask(id: string, question: string, threadId = `thr_ask_${id}`) {
  return { threadId, interactionId: `int_${id}`, question, options: ["Yes", "Not yet"] };
}
const seed = (key: string) => BOT_SEEDS.find(bot => bot.key === key)!;

/** A normal day: four for Salem, work moving, waits, a few done today and one finished yesterday. */
export function normalDay(): BotTasksOutput {
  const bots = [
    makeBot(seed("erbareeq"), [
      makeTask("erbareeq", "Merchant feedback surveys, part 1", "needs", { id: "t_surveys", line: "Built, Fable-reviewed, 151 tests pass. Flag stays off.", ageMs: 4 * HOUR, tags: ["dev"], needs: ask("surveys", "Merge and deploy dark, flag off?", "thr_worker_surveys") }),
      makeTask("erbareeq", "Voice notes on local models", "needs", { line: "Live as prod-5ae861f2a; no real voice note yet.", needs: ask("voice", "Send one voice note in each app so I can confirm?") }),
      makeTask("erbareeq", "Move the backend off Replit", "working", { id: "t_replit", line: "Phase 3: Express paths out, installer syncs moved in.", tags: ["dev"] }),
      makeTask("erbareeq", "Survey stress test and video", "queued", { line: "Queued: no Opus capacity · retry 14:20", ageMs: 3 * MINUTE }),
      makeTask("erbareeq", "مراجعة تسويات مرتجعات بريكس", "waiting", { waitFor: "Mohamed Omar", ageMs: 2 * HOUR }),
      makeTask("erbareeq", "Chat · Islam · login code", "waiting", { waitFor: "Islam" }),
      makeTask("erbareeq", "Social posts in our style, all pages", "waiting", { waitFor: "page list from Islam" }),
      makeTask("erbareeq", "Google Maps key: new server IP", "waiting", { waitFor: "Google review" }),
      makeTask("erbareeq", "Unused company lines (Orange)", "done", { id: "t_orange", line: "62 lines matched; list with confidence levels.", completedAt: NOW - 2 * HOUR }),
      makeTask("erbareeq", "MSSQL database on our host", "done", { id: "t_mssql", line: "TLS fix committed to main as d39bbab78.", completedAt: NOW - 16 * HOUR }),
    ], { unlinked: [{ threadId: "thr_unlinked_1", title: "Fable review: deploy window" }] }),
    makeBot(seed("bricks"), [
      makeTask("bricks", "iPhone TestFlight 9.3 retest", "needs", { needs: ask("iphone", "Is the iPhone connected to the Mac?"), ageMs: 48 * HOUR }),
      makeTask("bricks", "BRK-0042: prints in the template's orientation", "needs", { id: "t_brk42", needs: ask("brk42", "Open the MR for Yasser?"), ageMs: 24 * HOUR, tags: ["dev"] }),
      makeTask("bricks", "Watch our GitHub PRs too", "checking", { line: "Checking 2 of 4 criteria", ageMs: 11 * HOUR }),
      makeTask("bricks", "PR #11: Yasser's three changes", "waiting", { waitFor: "Yasser · wakes on his comment", ageMs: 11 * HOUR }),
      makeTask("bricks", "Meta ads with the demo offer", "stopped", { line: "Stopped by Salem · 2 workers halted", completedAt: NOW - 20 * MINUTE }),
      makeTask("bricks", "fe!1024 on iPhone and Android", "done", { completedAt: NOW - 3 * HOUR }),
    ]),
    makeBot(seed("lab"), [
      makeTask("lab", "Bots as the only way to run bb", "working", { id: "t_botsonly", line: "Building tasks v2 behind flags." }),
      makeTask("lab", "Pool: one stale login can't block Claude workers", "retrying", { line: "Keep Going resumed after an outage" }),
    ]),
    makeBot(seed("home"), [
      makeTask("home", "Multi-WAN bonding (EdgeRouter)", "offline", { line: "salem-pc is off · seen 6 min ago", ageMs: 3 * HOUR }),
      makeTask("home", "Kitchen TV colour fault: root cause", "overdue", { line: "Wake was due 09:00 · overdue 2h", ageMs: 24 * HOUR }),
      makeTask("home", "Kitchen TV: Clean Your TV launcher", "working", { line: "Worker installing; then checked on TV and camera." }),
    ]),
    makeBot(seed("personal"), []),
    makeBot(seed("work"), [makeTask("work", "Expense report for October", "done", { completedAt: NOW - 30 * HOUR })]),
  ];
  return makeOutput(bots, { notFiled: [{ threadId: "thr_plain_1", title: "Untitled plain thread", suggestedBot: "lab" }, { threadId: "thr_plain_2", title: "Scratch: regex for invoices" }] });
}

/** Peak load: 44 open tasks across six bots (the CONTRACT's figure). */
export function peakDay(): BotTasksOutput {
  const states: DisplayState[] = ["needs", "working", "working", "queued", "waiting", "waiting", "waiting", "waiting"];
  const bots = BOT_SEEDS.map((bot, b) => {
    const tasks: TaskRow[] = [];
    const n = b < 2 ? 9 : b < 4 ? 8 : 5;
    for (let i = 0; i < n; i += 1) {
      const state = states[i % states.length]!;
      tasks.push(makeTask(bot.key, `${bot.name.replace(" Bot", "")} task ${i + 1}: a realistic title that runs past the sidebar's width`, state, {
        id: `peak_${bot.key}_${i}`,
        line: state === "waiting" ? "" : "Working through the next step and reporting back",
        waitFor: state === "waiting" ? "a reply from the customer" : undefined,
        ageMs: (i + 1) * 17 * MINUTE,
        needs: state === "needs" ? ask(`peak_${bot.key}_${i}`, `${bot.name.replace(" Bot", "")}: go ahead with step ${i + 1}?`) : undefined,
      }));
    }
    return makeBot(bot, tasks);
  });
  return makeOutput(bots);
}

/** Ten decisions waiting, spread over four bots: the phone must reach each in two taps. */
export function tenDecisions(): BotTasksOutput {
  const questions = [
    ["bricks", "Is the iPhone connected to the Mac?"], ["bricks", "Open the MR for Yasser?"], ["bricks", "Raise the Meta cap to 5,000 EGP?"],
    ["erbareeq", "Merge and deploy dark, flag off?"], ["erbareeq", "Send one voice note in each app?"], ["erbareeq", "Reply to Islam with the new code?"],
    ["home", "Reboot the kitchen TV tonight?"], ["home", "Order the replacement launcher?"],
    ["lab", "Start the pilot?"], ["lab", "Roll back the stale-pool release?"],
  ] as const;
  const bots = BOT_SEEDS.map(bot => makeBot(bot, questions.flatMap(([key, question], i) => key === bot.key
    ? [makeTask(key, `Decision task ${i + 1}`, "needs", { id: `dec_${i}`, needs: ask(`dec_${i}`, question, `thr_dec_${i}`) })]
    : [])));
  return makeOutput(bots);
}

/** Long and right-to-left titles, plus a bot with nothing at all. */
export function rtlAndEmpty(): BotTasksOutput {
  const longArabic = "مراجعة تسويات مرتجعات بريكس للربع الثالث مع مطابقة كل فاتورة مع أمر البيع الأصلي والتأكد من أن الخصومات المطبقة صحيحة وأن العميل استلم إشعار الدائن في الوقت المحدد قبل إغلاق الشهر المالي";
  const bots = [
    makeBot(seed("erbareeq"), [
      makeTask("erbareeq", longArabic, "working", { id: "t_rtl", line: "تم تجهيز الملف · يتبقى ٣ فواتير" }),
      makeTask("erbareeq", "PR #12 مراجعة: fix the خطوط الشركة import for 62 lines", "waiting", { id: "t_mixed", waitFor: "محمد عمر" }),
      makeTask("erbareeq", "A very long English title that keeps going well past the width of any sidebar so that it must truncate on one line without wrapping", "needs", { id: "t_long", needs: ask("long", "هل نرسل التقرير إلى العميل الآن أم ننتظر مراجعة محمد؟") }),
    ]),
    makeBot(seed("personal"), []),
  ];
  return makeOutput(bots);
}

import assert from "node:assert/strict";
import { test } from "node:test";
import { panelModel, panelTally } from "../components/radar/panel/panelModel";
import type { BotTasksBot } from "../lib/botTasks";
import type { WorkerSnapshot } from "../components/radar/useDispatchWorkers";

test("panelModel separates desks from working/waiting tasks and deduplicates desks linked to running tasks", () => {
  const now = Date.parse("2026-11-24T13:10:00+02:00");
  const bot: BotTasksBot = {
    key: "erbareeq",
    name: "ERBareeq Bot",
    order: 0,
    coordinatorThreadId: "thr_coord",
    tasksV2: true,
    summary: { needs: 0, working: 2, queued: 0, offline: 0, waiting: 1, done: 0, notStarted: 0 },
    unlinked: [],
    tasks: [
      {
        id: "t1",
        bot: "erbareeq",
        title: "R-000287 white to black repair",
        outcome: "Return R-000287 records the square cylinder as black",
        displayState: "working",
        line: "Working for 15m",
        ageMs: 900_000,
        conversationThreadId: "thr_coord",
        tags: [],
        origin: "verified",
      },
      {
        id: "t2",
        bot: "erbareeq",
        title: "Per-delivery receipt print",
        displayState: "working",
        line: "Working for 11m",
        ageMs: 660_000,
        conversationThreadId: "thr_coord",
        tags: [],
        origin: "verified",
      },
      {
        id: "t3",
        bot: "erbareeq",
        title: "Daily stock audit",
        displayState: "waiting",
        line: "Waiting until tomorrow",
        ageMs: 1_800_000,
        wakeAt: now + 3_600_000,
        conversationThreadId: "thr_coord",
        tags: [],
        origin: "verified",
      },
    ],
    desks: [
      {
        id: "chat:hassan",
        desk: "chat",
        label: "Chat",
        key: "hassan",
        threadId: "thr_hassan",
        title: "Chat · شيخ حسن (776) · R-000287 cylinder colour fix",
        status: "working",
        updatedAt: now - 42 * 60_000,
        quietSince: now - 42 * 60_000,
        deadline: null,
        deferredReason: null,
      },
      {
        id: "chat:sherif",
        desk: "chat",
        label: "Chat",
        key: "sherif",
        threadId: "thr_sherif",
        title: "Chat · Sherif · Factory video sent, awaiting his review",
        status: "waiting",
        updatedAt: now - 9 * 3_600_000,
        quietSince: now - 9 * 3_600_000,
        deadline: null,
        deferredReason: null,
        wake: { at: now + 5 * 3_600_000, state: "pending" },
      },
      {
        id: "feedback:38",
        desk: "feedback",
        label: "Feedback",
        key: "38",
        threadId: "thr_fb38",
        title: "Feedback #38 · collapsible customers section",
        status: "draft",
        updatedAt: now - 60_000,
        quietSince: now - 60_000,
        deadline: null,
        deferredReason: null,
        question: { id: "q_fb38", state: "open" },
      },
    ],
  };
  const w1 = { threadId: "thr_w1", title: "R-000287", state: "running" as const, model: null, effort: null, startedAt: now - 900_000, endedAt: null, latest: true };
  const w2 = { threadId: "thr_w2", title: "Receipt print", state: "running" as const, model: null, effort: null, startedAt: now - 660_000, endedAt: null, latest: true };
  const snapshot: WorkerSnapshot = {
    byBot: {
      erbareeq: [w1, w2],
    },
    byTask: {
      t1: [w1],
      t2: [w2],
    },
    known: new Set(["erbareeq"]),
    failedChecks: new Set(),
    chat: new Set(),
  };

  const model = panelModel({ bot, snapshot, now, yours: [] });

  // Working has ONLY the 2 coordinator tasks — zero desks mixed in!
  assert.equal(model.working.length, 2);
  assert.equal(model.working.every(item => item.kind === "task"), true);

  // The R-000287 task absorbed its linked desk as sourceDesk instead of duplicating it!
  const r287 = model.working.find(item => item.kind === "task" && item.task.id === "t1");
  assert.equal(r287?.kind, "task");
  if (r287?.kind === "task") {
    assert.deepEqual(r287.sourceDesk, {
      threadId: "thr_hassan",
      label: "Chat · شيخ حسن (776)",
    });
  }

  // Waiting has ONLY the waiting task (not Sherif desk)
  assert.equal(model.waiting.length, 1);
  assert.equal(model.waiting[0]?.kind, "task");

  // Active desks has ONLY Sherif (R-000287 was deduped onto t1; Feedback #38 is in deskAsks)
  assert.deepEqual(model.desks.map(d => d.desk.id), ["chat:sherif"]);
  assert.deepEqual(model.deskAsks.map(d => d.desk.id), ["feedback:38"]);

  // Tally reports exact separate counts
  const tally = panelTally(model);
  assert.deepEqual(
    tally.map(t => [t.group, t.count, t.label]),
    [
      ["needs", 1, "needs you"],
      ["working", 2, "working"],
      ["waiting", 1, "waiting"],
      ["desks", 1, "desk"],
    ],
  );
});

test("panelModel puts genuinely active non-duplicated desks in Working, dedupes by linkedWorkerIds, and keeps idle desks out of Working", () => {
  const now = Date.parse("2026-11-24T17:05:00+02:00");
  const wPrice = { threadId: "thr_w_price", title: "Master price sheet", state: "running" as const, model: null, effort: null, startedAt: now - 360_000, endedAt: null, latest: true };
  const wCylinder = { threadId: "thr_w_cyl", title: "Cylinder color job", state: "running" as const, model: null, effort: null, startedAt: now - 180_000, endedAt: null, latest: true };
  const bot: BotTasksBot = {
    key: "erbareeq",
    name: "ERBareeq Bot",
    order: 0,
    coordinatorThreadId: "thr_coord",
    tasksV2: true,
    summary: { needs: 0, working: 2, queued: 0, offline: 0, waiting: 0, done: 0, notStarted: 0 },
    unlinked: [],
    tasks: [
      {
        id: "t_price",
        bot: "erbareeq",
        title: "Master price sheet",
        displayState: "working",
        line: "Working for 6m",
        ageMs: 360_000,
        conversationThreadId: "thr_coord",
        tags: [],
        origin: "verified",
      },
      {
        id: "t_cyl",
        bot: "erbareeq",
        title: "Update cylinder color",
        displayState: "working",
        line: "Working for 3m",
        ageMs: 180_000,
        conversationThreadId: "thr_coord",
        tags: [],
        origin: "verified",
      },
    ],
    desks: [
      // 1. Actively running Feedback #37 (e.g. running pnpm test:gate, no duplicate coordinator task) -> MUST appear in Working!
      {
        id: "feedback:37",
        desk: "feedback",
        label: "Feedback",
        key: "37",
        threadId: "thr_fb37",
        title: "Feedback #37 · Warranty renewal from stock counts live",
        status: "working",
        active: true,
        updatedAt: now - 180_000,
        quietSince: now - 180_000,
        deadline: null,
        deferredReason: null,
      },
      // 2. Managed chat desk with NO ref code in title, but exact linkedWorkerIds matching t_cyl -> MUST dedupe onto t_cyl!
      {
        id: "chat:hassan",
        desk: "chat",
        label: "Chat",
        key: "hassan",
        threadId: "thr_hassan",
        title: "Chat · شيخ حسن · Cylinder question",
        status: "working",
        active: true,
        linkedWorkerIds: ["thr_w_cyl"],
        updatedAt: now - 120_000,
        quietSince: now - 120_000,
        deadline: null,
        deferredReason: null,
      },
      // 3. Idle desk left marked "working" with active: false -> MUST stay in Active desks as "Open", NOT Working!
      {
        id: "chat:zombie",
        desk: "chat",
        label: "Chat",
        key: "zombie",
        threadId: "thr_zombie",
        title: "Chat · هندسة · Leftover open thread",
        status: "working",
        active: false,
        updatedAt: now - 3_600_000,
        quietSince: now - 3_600_000,
        deadline: null,
        deferredReason: null,
      },
    ],
  };
  const snapshot: WorkerSnapshot = {
    byBot: { erbareeq: [wPrice, wCylinder] },
    byTask: { t_price: [wPrice], t_cyl: [wCylinder] },
    known: new Set(["erbareeq"]),
    failedChecks: new Set(),
    chat: new Set(),
  };

  const model = panelModel({ bot, snapshot, now, yours: [] });

  // Working has the 2 tasks PLUS genuinely active Feedback #37 (3 total)
  assert.deepEqual(
    model.working.map(i => i.key),
    ["task:t_price", "task:t_cyl", "desk:feedback:37"],
  );

  // Hassan desk was deduplicated via exact linkedWorkerIds onto t_cyl
  const cyl = model.working.find(i => i.kind === "task" && i.task.id === "t_cyl");
  assert.equal(cyl?.kind, "task");
  if (cyl?.kind === "task") {
    assert.deepEqual(cyl.sourceDesk, { threadId: "thr_hassan", label: "Chat · شيخ حسن" });
  }

  // Idle "working" desk sits in Active desks labeled "Open" instead of falsely showing in Working
  assert.deepEqual(model.desks.map(d => [d.desk.id, d.status.words]), [["chat:zombie", "Open"]]);
});

test("panelModel deduplicates waiting desks against waiting tasks by explicit desk tag or person+topic/wake without merging unrelated desks", () => {
  const now = Date.parse("2026-11-24T18:35:00+02:00");
  const tomorrow10 = Date.parse("2026-11-25T10:00:00+02:00");
  const bot: BotTasksBot = {
    key: "erbareeq",
    name: "ERBareeq Bot",
    order: 0,
    coordinatorThreadId: "thr_coord",
    tasksV2: true,
    summary: { needs: 0, working: 0, queued: 0, offline: 0, waiting: 2, done: 0, notStarted: 0 },
    unlinked: [],
    tasks: [
      {
        id: "t_video",
        bot: "erbareeq",
        title: "Factory video",
        outcome: "Sherif approves the factory video tutorial",
        displayState: "waiting",
        line: "Waiting for someone else: The video is with Sherif; waiting for his comments or approval.",
        waitOn: "Sherif's comments or approval",
        wakeAt: tomorrow10,
        ageMs: 3_600_000,
        conversationThreadId: null,
        tags: [],
        origin: "verified",
      },
      {
        id: "t_tagged",
        bot: "erbareeq",
        title: "Credit note in ERP",
        displayState: "waiting",
        line: "Waiting on Mido",
        waitOn: "Mido",
        wakeAt: tomorrow10 + 3_600_000,
        ageMs: 3_600_000,
        conversationThreadId: null,
        tags: ["desk:thr_mido_desk"],
        origin: "verified",
      },
    ],
    desks: [
      // Matches t_video via person (Sherif) + topic ("factory video") / wake
      {
        id: "chat:sherif",
        desk: "chat",
        label: "Chat",
        key: "sherif",
        threadId: "thr_sherif",
        title: "Chat · Sherif · Factory video sent, awaiting his review",
        status: "waiting",
        waitingOn: "Sherif",
        active: false,
        wake: { at: tomorrow10, state: "pending" },
        updatedAt: now - 600_000,
        quietSince: now - 600_000,
        deadline: null,
        deferredReason: null,
      },
      // Matches t_tagged via explicit desk:<threadId> tag even though title differs
      {
        id: "chat:mido",
        desk: "chat",
        label: "Chat",
        key: "mido",
        threadId: "thr_mido_desk",
        title: "Chat · Mido · Accounting question",
        status: "waiting",
        waitingOn: "Mido",
        active: false,
        updatedAt: now - 600_000,
        quietSince: now - 600_000,
        deadline: null,
        deferredReason: null,
      },
      // Unrelated desk with same person Sherif, different topic & different wake -> MUST NOT merge!
      {
        id: "chat:sherif-payroll",
        desk: "chat",
        label: "Chat",
        key: "sherif-payroll",
        threadId: "thr_sherif_payroll",
        title: "Chat · Sherif · Payroll spreadsheet check",
        status: "waiting",
        waitingOn: "Sherif",
        active: false,
        wake: { at: tomorrow10 + 7_200_000, state: "pending" },
        updatedAt: now - 600_000,
        quietSince: now - 600_000,
        deadline: null,
        deferredReason: null,
      },
    ],
  };
  const snapshot: WorkerSnapshot = {
    byBot: {},
    byTask: {},
    known: new Set(["erbareeq"]),
    failedChecks: new Set(),
    chat: new Set(),
  };

  const model = panelModel({ bot, snapshot, now, yours: [] });
  assert.equal(model.waiting.length, 2);
  const video = model.waiting.find(i => i.kind === "task" && i.task.id === "t_video");
  const tagged = model.waiting.find(i => i.kind === "task" && i.task.id === "t_tagged");
  assert.equal(video?.kind, "task");
  assert.equal(tagged?.kind, "task");
  if (video?.kind === "task") {
    assert.deepEqual(video.sourceDesk, { threadId: "thr_sherif", label: "Chat · Sherif" });
  }
  if (tagged?.kind === "task") {
    assert.deepEqual(tagged.sourceDesk, { threadId: "thr_mido_desk", label: "Chat · Mido" });
  }
  // Only the unrelated Sherif payroll desk stays in Active desks!
  assert.deepEqual(model.desks.map(d => d.desk.id), ["chat:sherif-payroll"]);
});

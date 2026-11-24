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

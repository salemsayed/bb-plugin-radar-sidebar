import assert from "node:assert/strict";
import { test } from "node:test";
import { botTasksSchema, type CanonicalDeskLink } from "../lib/botTasks";
import { applyNotNow, type NotNowView } from "../lib/notNow";
import { createSharedRead } from "../lib/sharedRead";
import { panelModel } from "../components/radar/panel/panelModel";
import { needsCount } from "../components/radar/stage";
import type { WorkerSnapshot } from "../components/radar/useDispatchWorkers";

test("botTasksSchema parses snapshot tallies, canonicalLinks, and prefers open over later desk questions", () => {
  const now = 1_700_000_000_000;
  const parsed = botTasksSchema.parse({
    observedAt: now,
    revision: 12,
    notFiled: [],
    tallies: {
      globalDesksNeeds: 2,
      globalDesksWorking: 1,
      globalDesksTotal: 4,
      perBotNeeds: { erbareeq: 2 },
      outsideNeeds: 1,
      globalNeedsWithOutside: 3,
      globalWorking: { tasks: 1, sideJobs: 0, alerts: 0, total: 1 },
    },
    canonicalLinks: {
      erbareeq: [{ taskId: "t_wait", deskId: "d_linked", deskThreadId: "thr_d_linked", label: "WhatsApp" }],
    },
    bots: [
      {
        key: "erbareeq",
        name: "ERBareeq Bot",
        order: 0,
        coordinatorThreadId: "thr_coord",
        tasksV2: true,
        summary: { needs: 1, working: 1, queued: 0, offline: 0, waiting: 1, done: 0, notStarted: 0 },
        tasks: [
          {
            id: "t_need",
            bot: "erbareeq",
            title: "Approve shipment",
            displayState: "needs",
            line: "Ship today?",
            ageMs: 60_000,
            conversationThreadId: "thr_t_need",
            needs: { questionId: "q_task_1", threadId: "thr_t_need", interactionId: "i1", question: "Ship today?" },
            tags: [],
            origin: "verified",
          },
          {
            id: "t_wait",
            bot: "erbareeq",
            title: "Follow up on invoice",
            displayState: "waiting",
            line: "Waiting for customer",
            ageMs: 120_000,
            conversationThreadId: "thr_other",
            tags: [],
            origin: "verified",
          },
        ],
        desks: [
          {
            id: "d_multi",
            desk: "chat",
            label: "Chat",
            key: "group",
            threadId: "thr_group",
            title: "Managers group",
            status: "blocked",
            updatedAt: now,
            quietSince: null,
            deadline: null,
            deferredReason: null,
          },
          {
            id: "d_linked",
            desk: "whatsapp",
            label: "WhatsApp",
            key: "cust",
            threadId: "thr_d_linked",
            title: "Customer",
            status: "waiting",
            updatedAt: now,
            quietSince: null,
            deadline: null,
            deferredReason: null,
          },
          {
            id: "d_deferred",
            desk: "support",
            label: "Support",
            key: "sup1",
            threadId: "thr_sup1",
            title: "Support #1",
            status: "deferred",
            updatedAt: now,
            quietSince: null,
            deadline: null,
            deferredReason: "Wait for morning",
          },
        ],
        unlinked: [],
      },
    ],
    questions: [
      { id: "q_task_1", bot: "erbareeq", source: "ask", state: "open", threadId: "thr_t_need", askedAt: now, question: "Ship today?", taskId: "t_need" },
      // Topic A parked ("later") appears BEFORE Topic B ("open") on the same desk!
      { id: "q_desk_a", bot: "erbareeq", source: "desk", state: "later", threadId: "thr_group", askedAt: now - 10_000, question: "Topic A?", deskId: "d_multi", laterAt: now - 5_000 },
      { id: "q_desk_b", bot: "erbareeq", source: "desk", state: "open", threadId: "thr_group", askedAt: now, question: "Topic B?", deskId: "d_multi" },
      { id: "q_outside", bot: null, source: "thread", state: "open", threadId: "thr_loose", askedAt: now, question: "Outside?" },
    ],
  });

  const bot = parsed.bots[0]!;
  // Multi-topic desk must pick the open question, not the parked one
  const multiDesk = bot.desks.find(d => d.id === "d_multi")!;
  assert.equal(multiDesk.question?.id, "q_desk_b");
  assert.equal(multiDesk.question?.state, "open");
  assert.equal(needsCount(bot, parsed.tallies), 2);

  // Optimistic Not now updates tallies consistently
  const view: NotNowView = {
    toast: null,
    pending: id => (id === "q_task_1" || id === "q_outside" ? { on: true, at: now } : null),
  };
  const afterNotNow = applyNotNow(parsed, view);
  assert.equal(afterNotNow.tallies?.perBotNeeds.erbareeq, 1);
  assert.equal(afterNotNow.tallies?.outsideNeeds, 0);
  assert.equal(afterNotNow.tallies?.globalNeedsWithOutside, 1);
  assert.equal(needsCount(afterNotNow.bots[0]!, afterNotNow.tallies), 1);

  // panelModel uses canonicalLinks to deduplicate d_linked while keeping d_deferred in Active desks
  const snapshot: WorkerSnapshot = { byTask: {}, byBot: {}, chat: new Set(), known: new Set(["erbareeq"]), failedChecks: new Set() };
  const links: readonly CanonicalDeskLink[] = parsed.canonicalLinks?.erbareeq ?? [];
  const model = panelModel({ bot, snapshot, now, yours: [], canonicalLinks: links });
  assert.equal(model.desks.some(d => d.desk.id === "d_linked"), false);
  assert.equal(model.desks.some(d => d.desk.id === "d_deferred"), true);
  assert.equal(model.waiting.find(w => w.kind === "task" && w.task.id === "t_wait")?.kind, "task");
});

test("createSharedRead discards out-of-order responses when isStale returns true", async () => {
  const responses = [{ revision: 10, value: "fresh" }, { revision: 8, value: "stale" }, { revision: 11, value: "newer" }];
  let idx = 0;
  let stored: { revision: number; value: string } | null = null;
  const read = createSharedRead<{ revision: number; value: string }>({
    load: async () => responses[idx++]!,
    readCache: () => stored,
    writeCache: data => { stored = data; },
    absent: () => false,
    refreshMs: 60_000,
    events: [],
    isStale: (incoming, current) => incoming.revision < current.revision,
  });

  await read.refresh();
  assert.deepEqual(read.get().data, { revision: 10, value: "fresh" });

  // Older revision 8 must be discarded
  await read.refresh();
  assert.deepEqual(read.get().data, { revision: 10, value: "fresh" });

  // Newer revision 11 must be accepted
  await read.refresh();
  assert.deepEqual(read.get().data, { revision: 11, value: "newer" });
});

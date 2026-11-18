import assert from "node:assert/strict";
import test from "node:test";
import { botTasksSchema } from "../lib/botTasks";
import { createNeedsServer } from "../lib/needsServer";

function reader(failure?: string) {
  const methods: string[] = [];
  const callRpc = async ({ method }: { method: string }) => {
    methods.push(method);
    if (method === "bot_roster") return { bots: [{ key: "store", current: "coordinator" }] };
    if (method === "bot_questions" && failure) throw new Error(failure);
    return { questions: [{ id: "ask", state: "open", threadId: "coordinator", bot: "store", question: "Which margin?" }] };
  };
  const server = createNeedsServer({ sdk: { plugins: { callRpc } } } as never);
  return { methods, read: () => server.asks([{ threadId: "coordinator", version: 1 }]) };
}

test("the question badge reads only questions and supports cores missing that method", async () => {
  const current = reader();
  const legacy = reader('unknown_method: HTTP 404: plugin "orchestrator-mode" has no rpc method "bot_questions"');
  const result = await current.read();
  assert.deepEqual(result, [{ threadId: "coordinator", version: 1, waiting: 1, ask: "Which margin?", itemId: "ask" }]);
  assert.deepEqual(await legacy.read(), result);
  assert.deepEqual(current.methods, ["bot_roster", "bot_questions"]);
  assert.deepEqual(legacy.methods, ["bot_roster", "bot_questions", "bot_tasks"]);
});

test("a transient question read failure propagates without fetching the fleet", async () => {
  const offline = reader("connection closed");
  await assert.rejects(offline.read(), /connection closed/);
  assert.deepEqual(offline.methods, ["bot_roster", "bot_questions"]);
});

test("restoring old caches replaces synthetic questions without changing real tasks or question ownership", () => {
  const own = { id: "question", needId: "need", bot: "chief", source: "ask", state: "open", threadId: "old-chat", messageSeq: 41, askedAt: 10, question: "Which size?", options: ["Small", "Large"] };
  const first = botTasksSchema.parse({ observedAt: 20, bots: [{ key: "chief", name: "Chief", coordinatorThreadId: "chat", tasks: [{ id: "real", title: own.question, displayState: "working" }] }], questions: [
    own, { ...own, id: "linked", taskId: "real" }, { ...own, id: "desk", deskId: "desk" }, { ...own, id: "outside", bot: null },
  ] });
  const old = structuredClone(first);
  old.bots[0]!.tasks.unshift(first.bots[0]!.tasks[0]!);
  let restored = botTasksSchema.parse(old);
  for (let i = 0; i < 5; i++) restored = botTasksSchema.parse(JSON.parse(JSON.stringify(restored)));
  assert.deepEqual(restored, first);
  const parked = botTasksSchema.parse({ ...old, questions: [{ ...own, state: "later", laterAt: 25 }] });
  assert.deepEqual(parked.bots[0]!.tasks.map(row => row.id), ["need", "real"]);
  assert.equal(parked.bots[0]!.tasks[0]!.later?.at, 25);
  assert.equal(parked.bots[0]!.tasks[0]!.needs?.messageSeq, 41);
  assert.deepEqual(botTasksSchema.parse({ ...parked, questions: [] }).bots[0]!.tasks.map(row => row.id), ["real"]);
});

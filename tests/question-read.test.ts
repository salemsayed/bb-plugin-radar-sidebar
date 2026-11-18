import assert from "node:assert/strict";
import test from "node:test";
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

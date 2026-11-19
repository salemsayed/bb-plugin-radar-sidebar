import assert from "node:assert/strict";
import { test } from "node:test";
import { createFakePluginHost, makeMessageDispatchHookContext } from "@get-bb/plugin-sdk/testing";
import { registerAnswerAdmission } from "../lib/answerAdmission";
import { answerSubmission } from "../lib/answerSubmission";

test("saved questions keep one admission across choices, replay and plugin reload", async t => {
  const host = createFakePluginHost({ pluginId: "radar-sidebar" });
  registerAnswerAdmission(host.bb);
  const tag = (question: string, pluginId = "radar-sidebar") => ({ pluginId, data: {kind:"radar-question-answer", question} });
  const context = (question: string, text: string, pluginId?: string) => makeMessageDispatchHookContext({
    initiator: "user", senderThreadId: null, input: {text}, experimental_submission: tag(question, pluginId)
  });
  const dispatch = host.harness.inspection.registrations.hooks["message.dispatch"]!;
  const first = context("question-a", "15 percent");
  assert.equal((await dispatch(first)).action, "proceed");
  assert.equal((await dispatch(context("question-a", "18 percent"))).action, "reject");
  const next = await host.harness.lifecycle.reload(registerAnswerAdmission);
  t.after(() => next.harness.lifecycle.dispose());
  const afterReload = next.harness.inspection.registrations.hooks["message.dispatch"]!;
  assert.equal((await afterReload(first)).action, "reject");
  assert.equal((await afterReload(context("question-b", "15 percent"))).action, "proceed");
  assert.equal((await afterReload(context("question-a", "free text", "another-plugin"))).action, "proceed");
  assert.equal((await afterReload(makeMessageDispatchHookContext({ experimental_submission: null }))).action, "proceed");
});

test("the question follows an answer across bot surfaces and coordinator rollover", () => {
  const ask = { key: "ask:ptask_1", questionId: "q_1", threadId: "old", question: "Which margin?", options: ["12", "15"], botName: "Store" };
  const original = answerSubmission(ask, "old");
  assert.deepEqual(answerSubmission({ ...ask, key: "inbox", threadId: "new" }, "new"), original);
  assert.equal(answerSubmission(ask, "unrelated"), undefined);
  assert.equal(answerSubmission({ ...ask, questionId: undefined }, "old"), undefined);
  const legacy = { ...ask, questionId: undefined, messageSeq: 30 };
  assert.notDeepEqual(answerSubmission(legacy, "old"), answerSubmission({ ...legacy, messageSeq: 32 }, "old"));
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { panelItemKey } from "../components/radar/panel/fromItem";

test("a Needs you question maps to its card in the bot's Work panel", () => {
  assert.equal(panelItemKey("ask:ptask_1"), "task:ptask_1");
  assert.equal(panelItemKey("desk:desk_9"), "desk:desk_9");
  assert.equal(panelItemKey("thread:q_3"), null);
});

test("the bot chat's work action says where it goes and what is open", async () => {
  const { botWorkLabel } = await import("../components/radar/BotWorkHeaderAction");
  assert.equal(botWorkLabel(6), "Bot work: 6 open tasks");
  assert.equal(botWorkLabel(1), "Bot work: 1 open task");
  assert.equal(botWorkLabel(0), "Bot work: nothing open");
});

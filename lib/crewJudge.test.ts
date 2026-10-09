// @vitest-environment node
import { expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { dismissJudgedAsk, judgementKey } from "./crewJudge";
it("preserves historical ask dismissal and Undo without producing a new question", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "radar-sidebar" });
  try {
    const key = judgementKey("old-thread");
    await bb.storage.kv.set(key, { threadId: "old-thread", version: 1, waiting: 1, ask: "Approve?", itemId: "old-item" });
    const item = { id: "old-item", text: "Approve?", source: { threadId: "old-thread" } };
    expect(await dismissJudgedAsk(bb, item, true)).toBe(true);
    expect(await dismissJudgedAsk(bb, item, true)).toBe(false);
    expect(await dismissJudgedAsk(bb, item, false)).toBe(true);
    expect(await bb.storage.kv.get(key)).toMatchObject({ itemId: "old-item", dismissed: false });
    expect(await dismissJudgedAsk(bb, { ...item, id: "another-item" }, true)).toBe(false);
  } finally { await harness.lifecycle.dispose(); }
});
it("keeps old text-key caches usable and ignores unrelated historical text", async () => {
  const { bb, harness } = createFakePluginHost({ pluginId: "radar-sidebar" });
  try {
    await bb.storage.kv.set(judgementKey("old"), { threadId: "old", version: 1, waiting: 1, ask: "Approve the repair?" });
    expect(await dismissJudgedAsk(bb, { id: "x", text: "Different choice", source: { threadId: "old" } }, true)).toBe(false);
    expect(await dismissJudgedAsk(bb, { id: "x", text: "approve the repair.", source: { threadId: "old" } }, true)).toBe(true);
  } finally { await harness.lifecycle.dispose(); }
});

// @vitest-environment node
import { expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { registerScroll } from "./scrollServer";

it("persists exact offsets per browser and thread across server registration", async () => {
  const { bb, harness } = createFakePluginHost();
  registerScroll(bb);
  const position = { atBottom: false, messageSeq: 42, offset: -37.25 };
  await harness.behavior.callRpc("scroll_set", { threadId: "one", deviceId: "pc", position });
  expect(await harness.behavior.callRpc("scroll_get", { threadId: "one", deviceId: "phone" })).toBeNull();
  const next = await harness.lifecycle.reload(registerScroll);
  expect(await next.harness.behavior.callRpc("scroll_get", { threadId: "one", deviceId: "pc" })).toEqual(position);
  await next.harness.behavior.callRpc("scroll_set", { threadId: "one", deviceId: "pc", position: { atBottom: true, messageSeq: null, offset: 0 } });
  expect(await next.harness.behavior.callRpc("scroll_get", { threadId: "one", deviceId: "pc" })).toEqual({ atBottom: true, messageSeq: null, offset: 0 });
  await next.harness.lifecycle.dispose();
  await harness.lifecycle.dispose();
});

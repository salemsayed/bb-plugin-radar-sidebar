// @vitest-environment jsdom
import { act, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { resetBotsPush, useBotsPush } from "./botsPush";

beforeEach(resetBotsPush);
afterEach(cleanup);

it("calls back once per pushed bots change, however many hooks watch, and never for the first read", async () => {
  let version = 1; let calls = 0;
  const onChange = () => { calls++; };
  const Watchers = () => { useBotsPush(true, onChange); useBotsPush(true, onChange); return null; };
  const rendered = renderSlot({ component: Watchers }, {}, { rpc: { bots_version: () => ({ version }) } });
  await new Promise(resolve => setTimeout(resolve, 50));
  expect(calls).toBe(0);
  version = 2;
  await act(() => rendered.behavior.experimental_invalidateRpc(["bots"], "orchestrator-mode"));
  await expect.poll(() => calls).toBe(1);
  await act(() => rendered.behavior.experimental_invalidateRpc(["bots"], "orchestrator-mode"));
  await new Promise(resolve => setTimeout(resolve, 50));
  expect(calls).toBe(1);
});

it("does not watch while disabled", async () => {
  let read = false;
  const Watcher = () => { useBotsPush(false, () => {}); return null; };
  renderSlot({ component: Watcher }, {}, { rpc: { bots_version: () => { read = true; return { version: 1 }; } } });
  await new Promise(resolve => setTimeout(resolve, 50));
  expect(read).toBe(false);
});

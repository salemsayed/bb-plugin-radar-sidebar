// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../server";
import { askQuestions, askSentences, readAskAnswers } from "./crewAsk";

const disposers: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const dispose of disposers.splice(0)) await dispose();
  vi.useRealTimers();
});

async function setup(outputs: Record<string, string>, decide: (input: ReturnType<typeof askQuestions>) => unknown) {
  const output = vi.fn(async ({ threadId }: { threadId: string }) => ({ output: outputs[threadId] ?? null }));
  const callRpc = vi.fn(async ({ pluginId, method, input }: { pluginId: string; method: string; input: ReturnType<typeof askQuestions> }) => {
    expect([pluginId, method]).toEqual(["auto-effort", "jev_decide"]);
    return decide(input);
  });
  const { bb, harness } = createFakePluginHost({ pluginId: "radar-sidebar", sdk: { threads: { output }, plugins: { callRpc } } as never });
  await plugin(bb);
  const host = { harness, output, callRpc, outputs, ask: (threads: { threadId: string; version: number }[]) =>
    harness.behavior.callRpc("crew_asks", { threads }) as Promise<{ judgements: { threadId: string; version: number; waiting: number | null; ask: string | null }[] }> };
  disposers.push(() => harness.lifecycle.dispose());
  return host;
}

/** Jev stand-in: waiting when a sentence ends with "?", and picks that sentence. */
const fakeJev = (input: ReturnType<typeof askQuestions>) => {
  const entry = Object.entries(input.questions.ask.criteria).find(([key, text]) => key !== "none" && text.endsWith("?"));
  return { model: "jev-test", latencyMs: 1, usage: {}, answers: { waiting: { type: "noul", noul: entry ? 0.93 : 0.04 }, ask: { type: "choice", choice: entry?.[0] ?? "none" } } };
};

describe("crew_asks", () => {
  it("judges each reply once, quotes the ask, and judges again when a new reply lands", async () => {
    const host = await setup({ coord: "Tickets are EGP 800 each.\nShould I book it, and for which day?" }, fakeJev);
    const first = await host.ask([{ threadId: "coord", version: 1 }]);
    expect(first.judgements).toEqual([{ threadId: "coord", version: 1, waiting: 0.93, ask: "Should I book it, and for which day?" }]);
    expect(await host.ask([{ threadId: "coord", version: 1 }])).toEqual(first);
    expect(host.callRpc).toHaveBeenCalledTimes(1);
    host.outputs.coord = "Booked two General tickets for Saturday. Nothing to do.";
    const next = await host.ask([{ threadId: "coord", version: 2 }]);
    expect(next.judgements[0]).toMatchObject({ version: 2, waiting: 0.04, ask: null });
    expect(host.callRpc).toHaveBeenCalledTimes(2);
  });

  it("covers a rolled-over coordinator and a new bot without any setup", async () => {
    const host = await setup({ old: "Nothing to do.", fresh: "BOT_READY_x1 The handoff lists one open item. Want me to finish the fe!977 rework?" }, fakeJev);
    const result = await host.ask([{ threadId: "old", version: 5 }, { threadId: "fresh", version: 1 }]);
    expect(result.judgements.map((entry) => [entry.threadId, entry.ask])).toEqual([["old", null], ["fresh", "Want me to finish the fe!977 rework?"]]);
  });

  it("shares one request between clients asking at once, and skips Jev for empty replies", async () => {
    const host = await setup({ coord: "Should I open them?", empty: "SESSION_OK" }, fakeJev);
    const [a, b] = await Promise.all([host.ask([{ threadId: "coord", version: 3 }]), host.ask([{ threadId: "coord", version: 3 }])]);
    expect(a).toEqual(b);
    expect(host.output).toHaveBeenCalledTimes(1);
    expect((await host.ask([{ threadId: "empty", version: 1 }])).judgements[0]).toMatchObject({ waiting: 0, ask: null });
    expect(host.callRpc).toHaveBeenCalledTimes(1);
  });

  it("falls back without caching when Jev is unavailable, and retries later", async () => {
    vi.useFakeTimers();
    let up = false;
    const host = await setup({ coord: "Should I book it?" }, (input) => {
      if (!up) throw new Error("Set the API key in Auto Effort settings");
      return fakeJev(input);
    });
    expect((await host.ask([{ threadId: "coord", version: 1 }])).judgements[0]).toMatchObject({ waiting: null, ask: null });
    up = true;
    expect((await host.ask([{ threadId: "coord", version: 1 }])).judgements[0]?.waiting).toBeNull();
    expect(host.callRpc).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5 * 60_000 + 1);
    expect((await host.ask([{ threadId: "coord", version: 1 }])).judgements[0]).toMatchObject({ waiting: 0.93, ask: "Should I book it?" });
  });

  it("rejects oversized batches", async () => {
    const host = await setup({}, fakeJev);
    await expect(host.ask(Array.from({ length: 25 }, (_, index) => ({ threadId: `t${index}`, version: 1 })))).rejects.toThrow();
  });
});

describe("ask sentences", () => {
  it("keeps the last sentences as plain text and drops protocol tokens", () => {
    expect(askSentences("BOT_READY_ab12 Ready.\n- **Your go:** accept the `limitation`, then I push.\nSESSION_OK | conduct: yes")).toEqual([
      "Ready.", "Your go: accept the limitation, then I push.", "conduct: yes",
    ]);
    expect(askSentences(Array.from({ length: 20 }, (_, index) => `Line ${index}.`).join("\n"))).toHaveLength(12);
    expect(askSentences("")).toEqual([]);
  });

  it("reads Jev's answers back into a probability and the chosen sentence", () => {
    const sentences = ["Done.", "Should I book it?"];
    expect(readAskAnswers({ waiting: { noul: 0.8 }, ask: { choice: "s2" } }, sentences)).toEqual({ waiting: 0.8, ask: "Should I book it?" });
    expect(readAskAnswers({ waiting: { noul: 0.1 }, ask: { choice: "none" } }, sentences)).toEqual({ waiting: 0.1, ask: null });
    expect(readAskAnswers({ waiting: { noul: 2 } }, sentences)).toBeNull();
    expect(Object.keys(askQuestions(sentences).questions.ask.criteria)).toEqual(["none", "s1", "s2"]);
  });
});

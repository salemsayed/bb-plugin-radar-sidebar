import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

const SUPPORTED = { type: "choice", choice: "supported", confidence: 0.95, probabilities: { supported: 0.95, contradicted: 0.03, insufficient: 0.02 } };

export default function judgeStandIn(bb: BbPluginApi): void {
  bb.rpc.register(defineRpcContract({
    jev_decide: { input: z.object({ state: z.record(z.string(), z.unknown()), questions: z.record(z.string(), z.unknown()) }).passthrough(), output: z.object({ answers: z.record(z.string(), z.unknown()), model: z.string().nullable() }) },
    jev_capabilities: { input: z.object({}).strict(), output: z.object({ images: z.boolean(), box: z.boolean() }) },
    experimental_classify_model: { input: z.object({}).passthrough(), output: z.object({ reasoningLevel: z.string(), decision: z.record(z.string(), z.json()) }) },
  }), {
    jev_decide: async input => {
      if (input.state.mode !== "final-result" || !("acceptance" in input.questions)) throw new Error("judge stand-in: only a final result is judged in the test bb");
      bb.log.info(`judged final result supported: ${String(input.state.outcome ?? "").slice(0, 80)}`);
      return { answers: { acceptance: SUPPORTED }, model: "stand-in" };
    },
    jev_capabilities: async () => ({ images: false, box: false }),
    experimental_classify_model: async () => ({ reasoningLevel: "medium", decision: { source: "judge stand-in" } }),
  });
}

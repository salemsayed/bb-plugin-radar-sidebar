import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

export default function deskRouteStandIn(bb: BbPluginApi): void {
  bb.rpc.register(defineRpcContract({
    experimental_desk_route: { input: z.object({ parentThreadId: z.string(), task: z.string(), complexity: z.string() }).passthrough(), output: z.object({ providerId: z.string(), model: z.string(), routing: z.record(z.string(), z.json()) }) },
  }), {
    experimental_desk_route: async input => {
      if (/(?:^|\s)no_capacity(?:\s|$)/.test(input.task)) throw new Error("No free worker for this desk (desk route stand-in)");
      return { providerId: "scripted-echo", model: "claude-sonnet-5-5", routing: { source: "desk route stand-in" } };
    },
  });
}

import { experimental_useRpcQuery } from "@get-bb/plugin-sdk/app";
import { z } from "zod";

const contract = {
  bot_request_originals: {
    input: z.object({}),
    output: z.object({ originals: z.array(z.object({ threadId: z.string(), seq: z.number(), text: z.string() })) }),
    tags: () => ["bots"],
  },
} as const;

export function useRequestOriginals(enabled: boolean) {
  const result = experimental_useRpcQuery({ pluginId: "orchestrator-mode", contract, method: "bot_request_originals", input: {}, enabled });
  return enabled ? result.data?.originals : undefined;
}

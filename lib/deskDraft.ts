import type { useSdk } from "@get-bb/plugin-sdk/app";
import { z } from "zod";

const DRAFT_PLUGIN = "orchestrator-mode";
const currentSchema = z.object({ messageSeq: z.number().nullable() });

type Rpc = Pick<ReturnType<typeof useSdk>, "plugins">;

export async function draftIsCurrent(sdk: Rpc, bot: string, deskId: string, shownSeq: number | undefined): Promise<boolean> {
  if (shownSeq === undefined) return false;
  const now = await sdk.plugins.callRpc({ pluginId: DRAFT_PLUGIN, method: "desk_draft", input: { bot, deskId }, outputSchema: currentSchema });
  return now.messageSeq === shownSeq;
}

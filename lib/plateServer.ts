import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { z } from "zod";
import { PLATE_PLUGIN, plateListOutputSchema, plateResultSchema, plateRpcContract, type PlateItem, type PlateMode } from "./plate";

export function createPlateServer(bb: BbPluginApi) {
  return {
    handlers: {
      async crew_plate_list(input: z.infer<typeof plateRpcContract.crew_plate_list.input>): Promise<{ items: PlateItem[] | null; modes: Record<string, PlateMode> }> {
        try {
          return await bb.sdk.plugins.callRpc({ pluginId: PLATE_PLUGIN, method: "plate_list", input: plateRpcContract.crew_plate_list.input.parse(input ?? {}), outputSchema: plateListOutputSchema });
        } catch { return { items: null, modes: {} }; }
      },
      crew_plate_update: (input: z.infer<typeof plateRpcContract.crew_plate_update.input>) =>
        bb.sdk.plugins.callRpc({ pluginId: PLATE_PLUGIN, method: "plate_update", input: plateRpcContract.crew_plate_update.input.parse(input), outputSchema: plateResultSchema }),
    },
  };
}

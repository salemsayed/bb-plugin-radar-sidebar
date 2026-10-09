import { useEffect, useState } from "react";
import { z } from "zod";
import { useSdk } from "@get-bb/plugin-sdk/app";

/** The ChatGPT bridge's BB-side plugin (bb-plugin-saelmbot/chatgpt-plugin). */
export const CHATGPT_PLUGIN = "chatgpt-events";
const REFRESH_MS = 30_000;

export const chatgptStatusSchema = z.object({
  connected: z.boolean(),
  status: z.object({
    reportedAt: z.string(),
    alerts: z.object({
      watching: z.boolean(),
      refreshBefore: z.string().nullable(),
      lastDeliveredAt: z.string().nullable(),
    }).passthrough(),
    activity: z.record(z.string(), z.object({ instructions: z.number(), lastAt: z.number() })),
  }).nullable(),
});
export type ChatgptStatus = z.infer<typeof chatgptStatusSchema>;

/** ChatGPT's connection health and today's instructions per bot; null while unknown or without the plugin. */
export function useChatgptStatus(): ChatgptStatus | null {
  const sdk = useSdk();
  const [status, setStatus] = useState<ChatgptStatus | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const result = await sdk.plugins.callRpc({ pluginId: CHATGPT_PLUGIN, method: "chatgpt_status", input: null, outputSchema: chatgptStatusSchema });
        if (!cancelled) setStatus(result);
      } catch {
        // Plugin absent or reloading: leave the ChatGPT line out rather than guess.
        if (!cancelled) setStatus(null);
      }
    };
    void load();
    const timer = setInterval(() => void load(), REFRESH_MS);
    window.addEventListener("focus", load);
    return () => { cancelled = true; clearInterval(timer); window.removeEventListener("focus", load); };
  }, [sdk]);
  return status;
}

const DAY_MS = 86_400_000;
export type ChatgptLine = { tone: "ok" | "warn" | "off"; text: string };

/** One header line: is ChatGPT coordinating, and will its alerts keep arriving. */
export function chatgptLine(value: ChatgptStatus | null, now: number, format: (ms: number) => string): ChatgptLine | null {
  if (!value?.status) return null;
  if (!value.connected) return { tone: "off", text: "ChatGPT bridge is not running: no alerts or instructions" };
  const { alerts } = value.status;
  if (!alerts.watching || !alerts.refreshBefore) return { tone: "warn", text: "ChatGPT connected · alerts off: ask it to watch your BB bots" };
  const until = Date.parse(alerts.refreshBefore);
  return until - now < 2 * DAY_MS
    ? { tone: "warn", text: `ChatGPT alerts end ${format(until)}: ask it to watch your BB bots again` }
    : { tone: "ok", text: `ChatGPT coordinating · alerts on until ${format(until)}` };
}

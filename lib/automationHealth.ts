import { useEffect, useState } from "react";
import { useSdk } from "@get-bb/plugin-sdk/app";
import { z } from "zod";

const isoTime = z.iso.datetime({ offset: true });
export const automationHealthSchema = z.object({
  generatedAt: isoTime,
  bots: z.record(z.string(), z.object({ automations: z.array(z.object({
    id: z.string(), name: z.string(), projectId: z.string(),
    state: z.enum(["healthy", "failing", "repairing", "blocked", "waiting", "overdue", "paused"]),
    lastSuccessAt: isoTime.nullable(), failingSince: isoTime.nullable(), nextRunAt: isoTime.nullable(),
    pausedUntil: isoTime.nullable(), pauseReason: z.string().nullable(), waitingOn: z.enum(["host", "capacity"]).nullable(),
    incident: z.object({ id: z.string(), openedAt: isoTime, attempt: z.union([z.literal(0), z.literal(1), z.literal(2)]),
      repairThreadId: z.string().nullable(), needsItemId: z.string().nullable(), summary: z.string() }).nullable(),
  })) })),
});
export type AutomationHealth = z.infer<typeof automationHealthSchema>;
export type Automation = AutomationHealth["bots"][string]["automations"][number];

/** The contract has no pause/wait start time; do not substitute the last success. */
export function automationSince(item: Automation): string | null {
  if (item.state === "healthy" || item.state === "paused") return null;
  return item.failingSince ?? item.incident?.openedAt ?? (item.state === "overdue" ? item.nextRunAt : null);
}

/** Missing or unreadable health is unknown, so Crew leaves the automation line out. */
export function useAutomationHealth(): AutomationHealth | null {
  const sdk = useSdk();
  const [health, setHealth] = useState<AutomationHealth | null>(null);
  useEffect(() => {
    let cancelled = false;
    let request = 0;
    const load = async () => {
      const current = ++request;
      try {
        const result = await sdk.plugins.callRpc({ pluginId: "saelmbot-automations", method: "automation_health", input: {}, outputSchema: automationHealthSchema });
        if (!cancelled && current === request) setHealth(result);
      } catch {
        if (!cancelled && current === request) setHealth(null);
      }
    };
    void load();
    const timer = setInterval(() => void load(), 30_000);
    const onFocus = () => void load();
    window.addEventListener("focus", onFocus);
    return () => { cancelled = true; clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, [sdk]);
  return health;
}

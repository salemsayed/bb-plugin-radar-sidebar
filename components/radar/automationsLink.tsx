export const AUTOMATIONS_ROUTE = "/plugins/orchestrator-mode/bots";

export function automationsHref(botKey?: string | null): string {
  return botKey ? `${AUTOMATIONS_ROUTE}/${encodeURIComponent(botKey)}/automations` : AUTOMATIONS_ROUTE;
}

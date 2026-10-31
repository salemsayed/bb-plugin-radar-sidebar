export const AUTOMATIONS_ROUTE = "/plugins/bots-page/bots";

export function automationsHref(botKey?: string | null): string {
  return botKey ? `${AUTOMATIONS_ROUTE}/${encodeURIComponent(botKey)}/automations` : AUTOMATIONS_ROUTE;
}

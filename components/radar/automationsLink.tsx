export const AUTOMATIONS_ROUTE = "/plugins/bots-page/bots";

export function automationsHref(botKey?: string | null): string {
  return botKey ? `${AUTOMATIONS_ROUTE}/${encodeURIComponent(botKey)}/automations` : AUTOMATIONS_ROUTE;
}

export function onAutomationsRoute(pathname = typeof window === "undefined" ? "" : window.location.pathname): boolean {
  return pathname === AUTOMATIONS_ROUTE || pathname.startsWith(`${AUTOMATIONS_ROUTE}/`);
}

export function panelItemKey(needId: string): string | null {
  if (needId.startsWith("ask:")) return `task:${needId.slice(4)}`;
  if (needId.startsWith("desk:")) return needId;
  return null;
}

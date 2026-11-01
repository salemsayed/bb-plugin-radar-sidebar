export function displayedMessageSeq(threadId: string): number | null {
  if (document.visibilityState !== "visible" || !document.hasFocus()) return null;
  let latest: number | null = null;
  for (const element of Array.from(document.querySelectorAll<HTMLElement>("[data-notification-thread][data-notification-message]"))) {
    if (element.dataset.notificationThread !== threadId) continue;
    const seq = Number(element.dataset.notificationMessage);
    if (!Number.isSafeInteger(seq) || seq < 1 || latest !== null && seq <= latest) continue;
    const rect = element.getBoundingClientRect();
    const left = Math.max(0, rect.left), right = Math.min(innerWidth, rect.right);
    const top = Math.max(0, rect.top), bottom = Math.min(innerHeight, rect.bottom);
    if (right - left < 20 || bottom - top < Math.min(64, rect.height) || rect.height < 1) continue;
    const hit = document.elementFromPoint?.((left + right) / 2, (top + bottom) / 2);
    if (hit && element.contains(hit)) latest = seq;
  }
  return latest;
}

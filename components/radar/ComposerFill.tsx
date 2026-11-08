import { useEffect, useSyncExternalStore } from "react";
import { useComposers } from "@get-bb/plugin-sdk/app";
import { clearFill, pendingFill, reportFill, subscribeFill } from "@/lib/composerFill";

export function ComposerFill() {
  const request = useSyncExternalStore(subscribeFill, pendingFill, () => null);
  const composers = useComposers();
  useEffect(() => {
    if (!request || pendingFill() !== request) return;
    const composer = composers.find(c => c.scope.kind === "thread" && c.scope.threadId === request.threadId);
    if (!composer || composer.isSubmittingBlocked) return;
    clearFill(request);
    const free = composer.isEmpty || request.swap.includes(composer.text.trim());
    try {
      if (free) composer.replace(request.draft);
      composer.focus();
    } catch { if (request.send) reportFill(request, "failed"); return; }
    if (!request.send) return;
    if (!free) { reportFill(request, "draft"); return; }
    requestAnimationFrame(() => { composer.submit().then(() => reportFill(request, "sent"), () => reportFill(request, "failed")); });
  }, [request, composers]);
  return null;
}

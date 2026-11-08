import { useEffect, useRef, useSyncExternalStore } from "react";
import { useComposers } from "@get-bb/plugin-sdk/app";
import { clearFill, pendingFill, reportFill, subscribeFill } from "@/lib/composerFill";

export function ComposerFill() {
  const request = useSyncExternalStore(subscribeFill, pendingFill, () => null);
  const composers = useComposers();
  const prepared = useRef<typeof request>(null);
  useEffect(() => {
    if (!request || pendingFill() !== request) return;
    const composer = composers.find(c => c.scope.kind === "thread" && c.scope.threadId === request.threadId);
    if (!composer) return;
    if (prepared.current !== request) {
      const words = composer.draft.mentions.reduce((text, mention) => text.replace(`@${mention.label}`, ""), composer.text).trim();
      const free = !words || request.swap.includes(words);
      try {
        if (free) composer.replace(request.draft);
        composer.focus();
      } catch { clearFill(request); if (request.send) reportFill(request, "failed"); return; }
      if (!request.send || !free) {
        clearFill(request);
        if (request.send) reportFill(request, "draft");
        return;
      }
      prepared.current = request;
      return;
    }
    if (composer.isSubmittingBlocked) return;
    clearFill(request);
    composer.submit().then(() => reportFill(request, "sent"), () => reportFill(request, "failed"));
  }, [request, composers]);
  return null;
}

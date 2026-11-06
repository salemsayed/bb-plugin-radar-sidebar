import { useEffect, useSyncExternalStore } from "react";
import { useComposers } from "@get-bb/plugin-sdk/app";
import { clearFill, pendingFill, subscribeFill } from "@/lib/composerFill";

export function ComposerFill() {
  const request = useSyncExternalStore(subscribeFill, pendingFill, () => null);
  const composers = useComposers();
  useEffect(() => {
    if (!request) return;
    const composer = composers.find(c => c.scope.kind === "thread" && c.scope.threadId === request.threadId);
    if (!composer) return;
    clearFill(request);
    try {
      if (composer.isEmpty || request.swap.includes(composer.text.trim())) composer.replace({ text: request.text, mentions: [] });
      composer.focus();
    } catch {}
  }, [request, composers]);
  return null;
}

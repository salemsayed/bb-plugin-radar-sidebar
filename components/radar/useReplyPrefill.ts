import { useCallback, useEffect, useState } from "react";
import { useComposers } from "@get-bb/plugin-sdk/app";

/** How long to wait for the opened thread's composer before giving up on the prefill. */
const PREFILL_WINDOW_MS = 5_000;

/**
 * Open a thread and seed its reply with a bot's recommendation. The SDK offers
 * no "open with draft" for threads, so the text waits for that thread's
 * composer to appear among the on-screen composers and goes in at the end of
 * an empty draft; a draft Salem already started is left alone. Nothing is sent.
 */
export function useReplyPrefill(open: (threadId: string) => void): (threadId: string, text: string) => void {
  const composers = useComposers();
  const [pending, setPending] = useState<{ threadId: string; text: string } | null>(null);
  useEffect(() => {
    if (!pending) return;
    const composer = composers.find(c => c.scope.kind === "thread" && c.scope.threadId === pending.threadId);
    if (composer) {
      try { if (composer.isEmpty) { composer.insert(pending.text, { at: "end" }); composer.focus(); } }
      catch { /* the composer closed between the lookup and the write */ }
      setPending(null);
      return;
    }
    const timer = setTimeout(() => setPending(null), PREFILL_WINDOW_MS);
    return () => clearTimeout(timer);
  }, [composers, pending]);
  return useCallback((threadId: string, text: string) => { setPending({ threadId, text }); open(threadId); }, [open]);
}

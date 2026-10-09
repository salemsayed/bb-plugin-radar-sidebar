import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { CrewJudgement } from "./crewAsk";
import { normalizedNeedsText } from "./needs";

/** Compatibility with saved historical ask caches. New asks use Crew requests. */
export function judgementKey(threadId: string): string { return `crew-ask:${threadId}`; }

export async function dismissJudgedAsk(bb: BbPluginApi, item: { id: string; text: string; source: { threadId?: string } }, dismissed: boolean): Promise<boolean> {
  if (!item.source.threadId) return false;
  const key = judgementKey(item.source.threadId);
  const cached = await bb.storage.kv.get<CrewJudgement>(key);
  if (!cached?.ask) return false;
  const same = cached.itemId != null ? cached.itemId === item.id : normalizedNeedsText(cached.ask) === normalizedNeedsText(item.text);
  if (!same || (cached.dismissed ?? false) === dismissed) return false;
  await bb.storage.kv.set(key, { ...cached, dismissed }); return true;
}

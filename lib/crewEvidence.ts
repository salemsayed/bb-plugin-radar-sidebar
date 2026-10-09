/** BB delivers some system notices as user-shaped events. They confer no authorization. */
export function humanMessage(event: { type: string; data: unknown } | undefined): string | null {
  if (event?.type !== "client/turn/requested") return null;
  const d = event.data as { initiator?: string; senderThreadId?: string | null; source?: string; systemMessageKind?: string; input?: { type?: string; text?: string }[] };
  if (d.initiator !== "user" || d.senderThreadId || d.source === "spawn" || (d.systemMessageKind && d.systemMessageKind !== "unlabeled")) return null;
  const text = d.input?.filter(i => !i.type || i.type === "text").map(i => i.text ?? "").join("\n").trim();
  if (!text || /^(Automation (notice|report|failed)|BOT_AUTOMATION_|\[bb(?:[ -]|\]))/i.test(text)) return null;
  return text;
}

/** A coordinator reply, excluding child/tool transcript messages. */
export function assistantMessage(event: { type: string; data: unknown } | undefined): string | null {
  if (event?.type !== "item/completed") return null;
  const d = event.data as { parentToolCallId?: string; item?: { type?: string; text?: string; parentToolCallId?: string } };
  return d.item?.type === "agentMessage" && !d.parentToolCallId && !d.item.parentToolCallId && d.item.text?.trim() ? d.item.text : null;
}

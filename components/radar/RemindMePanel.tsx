import { useEffect, useState } from "react";
import { useRpc, type PluginThreadPanelProps, type PluginMessageActionRegistration } from "@get-bb/plugin-sdk/app";
import { z } from "zod";
import { needsRpcContract, reminderText } from "@/lib/needs";
import { ReminderTimePicker } from "./ReminderTimePicker";
import { needsChanged } from "@/lib/needsClient";

const paramsSchema = z.object({ messageId: z.string(), text: z.string() });
export const remindMeAction: PluginMessageActionRegistration = {
  id: "remind-me", title: "Remind me", icon: "Bell",
  run: ({ threadId, message, selectedText, openPanel }) => {
    const text = selectedText?.trim() ? selectedText.trim().replace(/\s+/g, " ").slice(0, 120) : reminderText(message.text);
    if (!openPanel({ actionId: "remind-when", title: "Remind me", params: { threadId, messageId: message.id, text } })) {
      throw new Error("Open the message in its thread to set a reminder.");
    }
  },
};

export function RemindMePanel({ threadId, params }: PluginThreadPanelProps) {
  const rpc = useRpc<typeof needsRpcContract>();
  const parsed = paramsSchema.safeParse(params);
  const [now, setNow] = useState(Date.now);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30_000); return () => clearInterval(timer); }, []);
  if (!parsed.success || !parsed.data.text) return <p>Select a message’s Remind me action to choose a time.</p>;
  const { messageId, text } = parsed.data;
  return <section className="radar-remind-panel" aria-label="Remind me">
    <h3>⏰ Remind me</h3><p>{text}</p>
    {saved ? <p role="status">Reminder set.</p> : <ReminderTimePicker now={now} busy={busy} onChoose={until => {
      if (busy) return;
      setBusy(true); setError(null);
      void rpc.call("crew_remind", { threadId, messageId, text, until }).then(() => {
        setSaved(true); needsChanged();
      }).catch(() => setError("Couldn’t set the reminder. Try again.")).finally(() => setBusy(false));
    }} />}
    {error ? <p role="alert">{error}</p> : null}
  </section>;
}

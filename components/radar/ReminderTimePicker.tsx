import { useState } from "react";
import { cairoInstant, cairoLocal, reminderChoices } from "@/lib/reminderTimes";

export function ReminderTimePicker({ now, busy = false, onChoose, onCancel }: {
  now: number; busy?: boolean; onChoose: (until: string) => void; onCancel?: () => void;
}) {
  const [custom, setCustom] = useState(false);
  const [local, setLocal] = useState("");
  const [error, setError] = useState<string | null>(null);
  return <div className="radar-reminder-picker">
    <small>Times in Cairo</small>
    {reminderChoices(now).map(choice => <button type="button" key={choice.label} disabled={busy || choice.disabled}
      onClick={() => onChoose(choice.until)}>{choice.label}</button>)}
    <button type="button" disabled={busy} aria-expanded={custom} onClick={() => setCustom(value => !value)}>Pick a date…</button>
    {custom ? <form onSubmit={event => {
      event.preventDefault();
      try {
        const until = cairoInstant(local);
        if (Date.parse(until) <= now) throw new Error("Choose a future time.");
        setError(null); onChoose(until);
      } catch (error) { setError(error instanceof Error ? error.message : "Choose a date and time."); }
    }}>
      <label>Date and time (Cairo)<input type="datetime-local" required value={local} min={cairoLocal(now)} disabled={busy}
        onChange={event => setLocal(event.target.value)} /></label>
      <button type="submit" disabled={busy}>Set reminder</button>
      {error ? <p role="alert">{error}</p> : null}
    </form> : null}
    {onCancel ? <button type="button" disabled={busy} onClick={onCancel}>Cancel</button> : null}
  </div>;
}

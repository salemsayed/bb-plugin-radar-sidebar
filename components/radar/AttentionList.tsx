import { useEffect, useRef, useState } from "react";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { attentionRpcContract, type AttentionEvent } from "@/lib/attention";
import { needsChanged, NEEDS_CHANGED } from "@/lib/needsClient";
import type { RosterBot } from "./bots";

export function AttentionList({ roster, onOpen }: { roster: readonly RosterBot[]; onOpen: (id: string) => void }) {
  const rpc = useRpc<typeof attentionRpcContract>();
  const request = useRef(0);
  const acknowledged = useRef(new Set<string>());
  const [events, setEvents] = useState<AttentionEvent[] | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  async function load(after = 0) {
    const generation = ++request.current;
    const { page } = await rpc.call("crew_attention_list", { after });
    if (generation !== request.current) return;
    if (!page) throw new Error("Alerts unavailable");
    setEvents(old => after ? [...(old ?? []), ...page.events.filter(e => !acknowledged.current.has(e.id) && !old?.some(p => p.id === e.id))] : page.events.filter(e => !acknowledged.current.has(e.id)));
    setMore(page.more); setError(false);
  }
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => { const generation = ++request.current; try { const { page } = await rpc.call("crew_attention_list", {}); if (!cancelled && generation === request.current) { setEvents(page?.events.filter(e => !acknowledged.current.has(e.id)) ?? null); setMore(page?.more ?? false); setError(!page); } } catch { if (!cancelled && generation === request.current) setError(true); } };
    void refresh(); const timer = setInterval(() => void refresh(), 15_000);
    const reload = () => void refresh();
    window.addEventListener(NEEDS_CHANGED, reload); window.addEventListener("focus", reload);
    return () => { cancelled = true; clearInterval(timer); window.removeEventListener(NEEDS_CHANGED, reload); window.removeEventListener("focus", reload); };
  }, [rpc]);
  if (events?.length === 0 && !error) return null;
  return <section aria-label="Important alerts" className="crew-needs">
    <h2 className="crew-section-title">Important alerts</h2>
    {error ? <p role="status">Alerts are unavailable. <button className="crew-button" aria-label="Retry alerts" onClick={() => { void load().catch(() => setError(true)); }}>Retry</button></p> : !events ? <p role="status">Loading alerts…</p> : null}
    <ul className="crew-blocked">{events?.map(event => <li key={event.id}>
      <span className="crew-blocked-text crew-alert-text"><strong>{roster.find(b => b.key === event.bot)?.name ?? event.bot}</strong> {event.summary}</span>
      <button className="crew-button" onClick={() => onOpen(event.threadId)}>Open</button>
      <button className="crew-button" disabled={busy !== null} onClick={async () => {
        setBusy(event.id);
        try { await rpc.call("crew_attention_seen", { ids: [event.id] }); acknowledged.current.add(event.id); ++request.current; setEvents(old => old?.filter(e => e.id !== event.id) ?? null); needsChanged(); }
        catch { setError(true); } finally { setBusy(null); }
      }}>Seen</button>
    </li>)}</ul>
    {more ? <button className="crew-button" onClick={() => { void load(events?.at(-1)?.seq ?? 0).catch(() => setError(true)); }}>More alerts</button> : null}
  </section>;
}

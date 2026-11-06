import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useBbContext, useComposers } from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import { askCardAnswers, askMessageShown, chatFooter, footerNode } from "@/lib/askLanding";
import { clearAskStrip, currentAskStrip, subscribeAskStrip, type AskStripEntry } from "@/lib/askStrip";
import { requestFill } from "@/lib/composerFill";
import { plainNote } from "./workText";
import { since } from "./stage";
import { FitLines } from "./FitLines";
import { askForms } from "./choiceFit";
import { fitWhat } from "./NeedsSummary";
import { Isolated } from "./Isolated";
import { ComposerFill } from "./ComposerFill";

const POLL_MS = 400;
const SETTLE_MS = 1000;
const SHOW_BY_MS = 4000;
const QUESTION_FORMS = [220, 180, 150, 120];

function flat(text: string): string {
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

function chatOffers(entry: AskStripEntry): boolean {
  if (entry.messageSeq === undefined || !entry.options.length) return false;
  const shown = askCardAnswers(entry.messageSeq);
  if (!shown?.length) return false;
  const wanted = entry.options.map(option => flat(option).slice(0, 14));
  return shown.some(text => wanted.some(head => head && flat(text).startsWith(head)));
}

interface Place { left: number; width: number }

function samePlace(a: Place | null, b: Place | null): boolean {
  return !!a && !!b && Math.abs(a.left - b.left) < 1 && Math.abs(a.width - b.width) < 1;
}

function overlayOpen(): boolean {
  return !!document.querySelector('[role="dialog"][aria-modal="true"], [role="menu"], [role="listbox"]');
}

export function AskStrip() {
  const entry = useSyncExternalStore(subscribeAskStrip, currentAskStrip, () => null);
  const { threadId } = useBbContext();
  const composers = useComposers();
  const here = !!entry && threadId === entry.threadId;
  const [place, setPlace] = useState<Place | null>(null);
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  const [offered, setOffered] = useState(false);
  const [ready, setReady] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [picked, setPicked] = useState<string | null>(null);
  const seen = useRef<string | null>(null);
  const marker = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!entry) { seen.current = null; return; }
    if (here) { seen.current = entry.key; return; }
    if (seen.current === entry.key) clearAskStrip(entry.key);
  }, [entry, here]);
  useEffect(() => { setPicked(null); }, [entry?.key]);
  useLayoutEffect(() => {
    if (!entry || !here) { setPlace(null); setReady(false); return; }
    let timer = 0;
    const armed = Date.now();
    let lastOffer: boolean | null = null;
    let offerSince = armed;
    let shown = false;
    const slot = document.createElement("div");
    slot.className = "radar-ask-strip-slot";
    const scope = marker.current?.closest("[data-bb-plugin]")?.getAttribute("data-bb-plugin");
    if (scope) slot.setAttribute("data-bb-plugin", scope);
    const measure = () => {
      const footer = footerNode();
      const column = chatFooter();
      if (footer && slot.parentElement !== footer) footer.insertBefore(slot, footer.firstChild);
      setHost(footer ? slot : null);
      const next = column ? { left: column.left - column.footerLeft, width: column.width } : null;
      setPlace(prev => samePlace(prev, next) ? prev : next);
      const offers = chatOffers(entry);
      if (offers !== lastOffer) { lastOffer = offers; offerSince = Date.now(); }
      setOffered(offers);
      const landed = entry.messageSeq === undefined || askMessageShown(entry.messageSeq);
      if (!shown && (Date.now() - armed > SHOW_BY_MS || landed && Date.now() - offerSince >= SETTLE_MS)) shown = true;
      setReady(shown);
      setNow(Date.now());
      timer = window.setTimeout(measure, POLL_MS);
    };
    measure();
    addEventListener("resize", measure);
    return () => { clearTimeout(timer); removeEventListener("resize", measure); slot.remove(); setHost(null); };
  }, [entry, here]);
  const composer = entry && here ? composers.find(c => c.scope.kind === "thread" && c.scope.threadId === entry.threadId) ?? null : null;
  useEffect(() => {
    if (!entry || !composer) return;
    return composer.onSubmitted(() => clearAskStrip(entry.key));
  }, [composer, entry]);
  const visible = !!entry && here && !!place && !!host && ready && !offered;
  useEffect(() => {
    if (!visible || !entry) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || overlayOpen()) return;
      clearAskStrip(entry.key);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [visible, entry]);
  const base = <><span ref={marker} hidden /><ComposerFill /></>;
  if (!visible || !entry || !place || !host) return base;
  const age = entry.askedAt !== undefined ? since(entry.askedAt, now) : "";
  const asked = `${entry.botName} asked${age ? age === "now" ? " just now" : ` ${age} ago` : ""}`;
  const hint = entry.options.length ? "Answer here or in the chat" : "Type your answer below";
  const choose = (option: string) => {
    setPicked(option);
    requestFill(entry.threadId, option, entry.options);
  };
  return <>{base}{createPortal(<section className="radar-ask-strip" role="region" aria-label={`${asked}: ${entry.question}`}
    style={{ marginInlineStart: `${place.left}px`, width: `${place.width}px` } as CSSProperties}
    onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); clearAskStrip(entry.key); } }}>
    <header className="radar-ask-strip-head">
      <span className="radar-ask-strip-dot" aria-hidden="true" />
      <span className="radar-ask-strip-who"><b>{asked}</b><span className="radar-ask-strip-sep" aria-hidden="true"> · </span><span className="radar-ask-strip-hint">{hint}</span></span>
      <button type="button" className="radar-ask-strip-close" aria-label="Hide this question" title="Hide (Esc)" onClick={() => clearAskStrip(entry.key)}><Icon name="X" aria-hidden="true" /></button>
    </header>
    <FitLines className="radar-ask-strip-question" forms={askForms(entry.question, QUESTION_FORMS, fitWhat, entry.title, entry.options.length)} />
    {entry.options.length ? <div className="radar-ask-strip-options" role="group" aria-label={`Answers to: ${entry.question}`}>
      {entry.options.map(option => <button key={option} type="button" className="radar-ask-strip-option" aria-pressed={picked === option}
        aria-label={`Answer “${plainNote(option)}”: types it in the message box, you press send`} title="Types this answer in the message box; you press send"
        onClick={() => choose(option)}><Isolated text={plainNote(option)} /></button>)}
      {picked ? <span className="radar-ask-strip-note" role="status">Typed below · press send</span> : null}
    </div> : null}
  </section>, host)}</>;
}

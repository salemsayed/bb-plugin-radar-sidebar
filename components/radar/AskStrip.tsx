import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useBbContext, useComposers } from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import { askCardAnswers, askMessageShown, chatFooter, composerEditor, stripAnchor } from "@/lib/askLanding";
import { clearAskStrip, currentAskStrip, subscribeAskStrip, type AskStripEntry } from "@/lib/askStrip";
import { requestFill } from "@/lib/composerFill";
import { plainNote } from "./workText";
import { clockNow, since } from "./stage";
import { answerHint } from "./answerHint";
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
  const [now, setNow] = useState(clockNow);
  const [picked, setPicked] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const seen = useRef<string | null>(null);
  const marker = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!entry) { seen.current = null; return; }
    if (here) { seen.current = entry.key; return; }
    if (seen.current === entry.key) clearAskStrip(entry.key);
  }, [entry, here]);
  useEffect(() => { setPicked(null); setNote(null); }, [entry?.key]);
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
      const anchor = stripAnchor();
      const column = chatFooter();
      if (anchor && (slot.parentElement !== anchor.parent || slot.nextElementSibling !== anchor.before)) anchor.parent.insertBefore(slot, anchor.before);
      setHost(anchor ? slot : null);
      const box = slot.isConnected ? slot.getBoundingClientRect() : null;
      const next = column && box ? { left: column.left - box.left, width: column.width } : null;
      setPlace(prev => samePlace(prev, next) ? prev : next);
      const offers = chatOffers(entry);
      if (offers !== lastOffer) { lastOffer = offers; offerSince = Date.now(); }
      setOffered(offers);
      const landed = entry.messageSeq === undefined || askMessageShown(entry.messageSeq);
      if (!shown && (Date.now() - armed > SHOW_BY_MS || landed && Date.now() - offerSince >= SETTLE_MS)) shown = true;
      setReady(shown);
      setNow(clockNow());
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
  const close = (refocus: boolean) => {
    if (!entry) return;
    clearAskStrip(entry.key);
    if (refocus) requestAnimationFrame(() => { try { composer?.focus(); } catch {} });
  };
  useEffect(() => {
    if (!visible || !entry) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || overlayOpen()) return;
      const target = event.target instanceof Element ? event.target : null;
      const editor = composerEditor();
      const inComposer = !!editor && !!target && editor.contains(target);
      const typing = !!target?.closest('[contenteditable="true"], textarea, input');
      if (typing && !inComposer) return;
      close(true);
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [visible, entry, composer]);
  const base = <><span ref={marker} hidden /><ComposerFill /></>;
  if (!visible || !entry || !place || !host) return base;
  const age = entry.askedAt !== undefined ? since(entry.askedAt, now) : "";
  const asked = `${entry.botName} asked${age ? age === "now" ? " just now" : ` ${age} ago` : ""}`;
  const shown = entry.options.map(option => plainNote(option));
  const hint = shown.length ? answerHint() : "Type your answer below";
  const choose = async (label: string) => {
    if (!composer) { requestFill(entry.threadId, label, shown); return; }
    const draft = composer.text.trim();
    if (draft && !shown.includes(draft)) { setNote("Your draft is in the message box: send or clear it first"); return; }
    setPicked(label);
    setNote("Sending…");
    try {
      composer.replace({ text: label, mentions: [] });
      await new Promise(resolve => requestAnimationFrame(resolve));
      await composer.submit();
    } catch (error) {
      setPicked(null);
      setNote(error instanceof Error && error.message ? error.message : "Not sent");
    }
  };
  return <>{base}{createPortal(<section className="radar-ask-strip" role="region" aria-label={`${asked}: ${entry.question}`}
    style={{ marginInlineStart: `${place.left}px`, width: `${place.width}px` } as CSSProperties}
    onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); close(true); } }}>
    <header className="radar-ask-strip-head">
      <span className="radar-ask-strip-dot" aria-hidden="true" />
      <span className="radar-ask-strip-who"><b>{asked}</b><span className="radar-ask-strip-sep" aria-hidden="true"> · </span><span className="radar-ask-strip-hint">{hint}</span></span>
      <button type="button" className="radar-ask-strip-close" aria-label="Hide this question" title="Hide (Esc)" onClick={() => close(true)}><Icon name="X" aria-hidden="true" /></button>
    </header>
    <FitLines className="radar-ask-strip-question" forms={askForms(entry.question, QUESTION_FORMS, fitWhat, entry.title, entry.options.length)} />
    {shown.length ? <div className="radar-ask-strip-options" role="group" aria-label={`Answers to: ${entry.question}`} data-count={shown.length}>
      {shown.map(label => <button key={label} type="button" className="radar-ask-strip-option" aria-pressed={picked === label} disabled={picked !== null && note === "Sending…"}
        aria-label={`Send “${label}” to ${entry.botName}`} title="Sends this reply to the bot"
        onClick={() => { void choose(label); }}><Isolated text={label} /></button>)}
    </div> : null}
    {note ? <p className="radar-ask-strip-note" role="status">{note}</p> : null}
  </section>, host)}</>;
}

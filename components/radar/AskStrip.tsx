import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { useBbContext, useComposers } from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import { askCardAnswers, chatFooter } from "@/lib/askLanding";
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
const GAP = 8;
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

interface Place { left: number; width: number; bottom: number }

function samePlace(a: Place | null, b: Place | null): boolean {
  return !!a && !!b && Math.abs(a.left - b.left) < 1 && Math.abs(a.width - b.width) < 1 && Math.abs(a.bottom - b.bottom) < 1;
}

export function AskStrip() {
  const entry = useSyncExternalStore(subscribeAskStrip, currentAskStrip, () => null);
  const { threadId } = useBbContext();
  const composers = useComposers();
  const here = !!entry && threadId === entry.threadId;
  const [place, setPlace] = useState<Place | null>(null);
  const [offered, setOffered] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [picked, setPicked] = useState<string | null>(null);
  const seen = useRef<string | null>(null);
  const root = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!entry) { seen.current = null; return; }
    if (here) { seen.current = entry.key; return; }
    if (seen.current === entry.key) clearAskStrip(entry.key);
  }, [entry, here]);
  useEffect(() => { setPicked(null); }, [entry?.key]);
  useLayoutEffect(() => {
    if (!entry || !here) { setPlace(null); return; }
    let timer = 0;
    const measure = () => {
      const footer = chatFooter();
      const next = footer ? { left: footer.left, width: footer.width, bottom: Math.max(GAP, innerHeight - footer.top + GAP) } : null;
      setPlace(prev => samePlace(prev, next) ? prev : next);
      setOffered(chatOffers(entry));
      setNow(Date.now());
      timer = window.setTimeout(measure, POLL_MS);
    };
    measure();
    addEventListener("resize", measure);
    return () => { clearTimeout(timer); removeEventListener("resize", measure); };
  }, [entry, here]);
  const composer = entry && here ? composers.find(c => c.scope.kind === "thread" && c.scope.threadId === entry.threadId) ?? null : null;
  useEffect(() => {
    if (!entry || !composer) return;
    return composer.onSubmitted(() => clearAskStrip(entry.key));
  }, [composer, entry]);
  if (!entry || !here || !place || offered) return <ComposerFill />;
  const age = entry.askedAt !== undefined ? since(entry.askedAt, now) : "";
  const asked = `${entry.botName} asked${age ? age === "now" ? " just now" : ` ${age} ago` : ""}`;
  const hint = entry.options.length ? "Answer here or in the chat" : "Type your answer below";
  const choose = (option: string) => {
    setPicked(option);
    requestFill(entry.threadId, option, entry.options);
  };
  return <><ComposerFill /><section ref={root} className="radar-ask-strip" role="region" aria-label={`${asked}: ${entry.question}`}
    style={{ left: `${place.left}px`, width: `${place.width}px`, bottom: `${place.bottom}px` } as CSSProperties}
    onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); clearAskStrip(entry.key); } }}>
    <header className="radar-ask-strip-head">
      <span className="radar-ask-strip-dot" aria-hidden="true" />
      <span className="radar-ask-strip-who"><b>{asked}</b><span aria-hidden="true"> · </span><span>{hint}</span></span>
      <button type="button" className="radar-ask-strip-close" aria-label="Hide this question" title="Hide" onClick={() => clearAskStrip(entry.key)}><Icon name="X" aria-hidden="true" /></button>
    </header>
    <FitLines className="radar-ask-strip-question" forms={askForms(entry.question, QUESTION_FORMS, fitWhat, entry.title, entry.options.length)} />
    {entry.options.length ? <div className="radar-ask-strip-options" role="group" aria-label={`Answers to: ${entry.question}`}>
      {entry.options.map(option => <button key={option} type="button" className="radar-ask-strip-option" aria-pressed={picked === option}
        aria-label={`Answer “${plainNote(option)}”: types it in the message box, you press send`} title="Types this answer in the message box; you press send"
        onClick={() => choose(option)}><Isolated text={plainNote(option)} /></button>)}
      {picked ? <span className="radar-ask-strip-note" role="status">Typed below · press send</span> : null}
    </div> : null}
  </section></>;
}

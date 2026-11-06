import { useLayoutEffect, useRef, useState } from "react";
import { Isolated } from "./Isolated";


export function AnswerLabel({ label, recommended }: { label: string; recommended?: boolean }) {
  if (!recommended) return <span className="radar-answer-text"><Isolated text={label} /></span>;
  return <span className="radar-answer-text" data-rec=""><span className="radar-answer-label"><Isolated text={label} /></span><span className="radar-answer-rec">recommended</span></span>;
}

export function answerName(label: string, recommended?: boolean): string {
  return recommended ? `“${label}” (recommended)` : `“${label}”`;
}

const LOOSE_END = /^(?:and|or|but|nor|so|the|a|an|of|to|for|with|as|in|on|at|by|from|into|than|that|which|who|its|their|your|our|my|this|these|those|is|are|was|were|be|will|would|can|could|if|when|while|then)$/i;

export function fitWhole(text: string, fits: (form: string) => boolean): string {
  const words = text.split(/\s+/).filter(Boolean);
  for (let n = words.length - 1; n >= 1; n--) {
    const head = words.slice(0, n).join(" ").replace(/[\s,;:·–—-]+$/, "");
    if (LOOSE_END.test(words[n - 1]!.replace(/[^\p{L}]/gu, "")) && n > 1) continue;
    const form = `${head}\u2026`;
    if (fits(form)) return form;
  }
  return `${words[0] ?? ""}\u2026`;
}

const CLAUSE_END = /[.;:]\s+|\s+[\u2013\u2014]\s+|,\s+(?=(?:so|but|because|which|while|then|until|unless|after|before|once)\b)/g;
const TAIL_START = /^(?:offline|online|down|for|until|before|after|so|to|in|on|at|by|with|without|from|during|while|when|unless|because|or|and|then|once)$/i;
const bare = (word: string) => word.replace(/[^\p{L}\p{N}']/gu, "");

export function impactForms(text: string): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  const forms: { text: string; clause: boolean }[] = [];
  for (const match of clean.matchAll(CLAUSE_END)) {
    const head = clean.slice(0, match.index).replace(/[\s,;:·–—-]+$/, "");
    if (head.split(" ").length >= 3) forms.push({ text: `${head}\u2026`, clause: true });
  }
  const words = clean.replace(/[.!\s]+$/, "").split(" ");
  for (let tail = 2; tail <= Math.min(8, words.length - 4); tail++) {
    if (!TAIL_START.test(bare(words[words.length - tail]!))) continue;
    for (let head = 5; head < words.length - tail - 1; head++) {
      const last = bare(words[head - 1]!);
      if (!last || LOOSE_END.test(last)) continue;
      forms.push({ text: `${words.slice(0, head).join(" ").replace(/[,;:]+$/, "")} \u2026 ${words.slice(-tail).join(" ")}`, clause: false });
    }
  }
  return forms.sort((a, b) => b.text.length - a.text.length || Number(b.clause) - Number(a.clause)).map(form => form.text);
}

export function fitImpact(text: string, fits: (form: string) => boolean): string {
  return impactForms(text).find(fits) ?? fitWhole(text, fits);
}

export function AskImpact({ text, className }: { text?: string; className: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState<string | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) return;
    const observer = new ResizeObserver(entries => {
      const next = Math.round(entries[0]!.contentRect.width);
      setWidth(prev => Math.abs(prev - next) > 1 ? next : prev);
    });
    observer.observe(box);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const box = ref.current;
    const host = box?.parentElement;
    if (!box || !host || !text || open) { setShown(null); return; }
    const style = getComputedStyle(box);
    const lines = Number.parseInt(style.getPropertyValue("-webkit-line-clamp"), 10) || Number.parseInt(getComputedStyle(host).getPropertyValue("--impact-lines"), 10) || 1;
    const limit = lines * (Number.parseFloat(style.lineHeight) || 16) + 1;
    const probe = document.createElement("span");
    probe.className = box.className;
    probe.dir = "auto";
    probe.style.cssText = `position:absolute;visibility:hidden;pointer-events:none;left:0;top:0;display:block;width:${box.getBoundingClientRect().width}px;-webkit-line-clamp:none;line-clamp:none;overflow:visible`;
    host.appendChild(probe);
    const fits = (form: string) => { probe.textContent = form; return probe.scrollHeight <= limit; };
    const next = fits(text) ? null : fitImpact(text, fits);
    probe.remove();
    setShown(next);
  }, [text, open, width]);
  if (!text) return null;
  const toggle = (event: { stopPropagation: () => void; preventDefault: () => void }) => { event.stopPropagation(); event.preventDefault(); setOpen(value => !value); };
  return <span className={`${className} radar-impact`} data-open={open || undefined}>
    <span className="radar-impact-text" ref={ref} dir="auto" title={shown !== null ? text : undefined}><Isolated text={shown ?? text} /></span>
    {shown !== null || open ? <span role="button" tabIndex={-1} className="radar-impact-more" aria-hidden="true" onPointerDown={event => event.stopPropagation()} onClick={toggle}>{open ? "less" : "more"}</span> : null}
  </span>;
}

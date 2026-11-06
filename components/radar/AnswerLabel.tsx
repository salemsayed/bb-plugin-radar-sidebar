import { useLayoutEffect, useRef, useState } from "react";
import { Isolated } from "./Isolated";
import { fitWords } from "./FitLines";

export function AnswerLabel({ label, recommended }: { label: string; recommended?: boolean }) {
  if (!recommended) return <Isolated text={label} />;
  return <span className="radar-answer-text"><Isolated text={label} /><span className="radar-answer-rec">{"\u00a0\u00b7 recommended"}</span></span>;
}

export function answerName(label: string, recommended?: boolean): string {
  return recommended ? `“${label}” (recommended)` : `“${label}”`;
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
    const next = fits(text) ? null : fitWords(text, fits);
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

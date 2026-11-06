import { useLayoutEffect, useRef, useState } from "react";
import { Isolated } from "./Isolated";

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
  const [cut, setCut] = useState(false);
  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) return;
    const measure = () => setCut(box.scrollHeight > box.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    return () => observer.disconnect();
  }, [text, open]);
  if (!text) return null;
  const toggle = (event: { stopPropagation: () => void; preventDefault: () => void }) => { event.stopPropagation(); event.preventDefault(); setOpen(value => !value); };
  return <span className={`${className} radar-impact`} data-open={open || undefined}>
    <span className="radar-impact-text" ref={ref} dir="auto"><Isolated text={text} /></span>
    {cut || open ? <span role="button" tabIndex={-1} className="radar-impact-more" aria-hidden="true" onPointerDown={event => event.stopPropagation()} onClick={toggle}>{open ? "less" : "more"}</span> : null}
  </span>;
}

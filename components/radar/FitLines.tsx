import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Isolated } from "./Isolated";
import { keepHyphens } from "./displayText";
import { fitWhole } from "./AnswerLabel";

export function FitLines({ forms, className, dir = "auto", lead, aside, room = 0 }: { forms: readonly string[]; className?: string; dir?: "auto" | "ltr" | "rtl"; lead?: ReactNode; aside?: ReactNode; room?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const key = forms.join("\n");
  const [at, setAt] = useState(0);
  const [cut, setCut] = useState<string | null>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => { setAt(0); setCut(null); }, [key, width, room]);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || cut !== null || node.scrollHeight <= node.clientHeight + 1) return;
    if (at < forms.length - 1) { setAt(at + 1); return; }
    const host = node.parentElement;
    if (!host) return;
    const probe = node.cloneNode(false) as HTMLElement;
    probe.style.cssText = `position:absolute;visibility:hidden;pointer-events:none;left:0;top:0;width:${node.getBoundingClientRect().width}px`;
    const keep = Array.from(node.children).filter(child => child.hasAttribute("data-text")).map(child => child.cloneNode(true));
    host.appendChild(probe);
    const fits = (form: string) => { probe.replaceChildren(...keep, document.createTextNode(form)); return probe.scrollHeight <= probe.clientHeight + 1; };
    const next = fitWhole(forms[0] ?? "", fits);
    probe.remove();
    setCut(next);
  });
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(entries => {
      const next = Math.round(entries[0]!.contentRect.width);
      setWidth(prev => Math.abs(prev - next) > 1 ? next : prev);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return <span ref={ref} className={className} dir={dir}>{aside}{lead}<Isolated text={keepHyphens(cut ?? forms[Math.min(at, forms.length - 1)] ?? "")} /></span>;
}

export function cutForms(whole: string, fit: (text: string, max: number) => string, sizes: readonly number[]): string[] {
  const forms = [whole, ...sizes.map(size => fit(whole, size))];
  return forms.filter((form, i) => form && forms.indexOf(form) === i);
}

export function fitWords(text: string, fits: (form: string) => boolean): string {
  if (fits(text)) return text;
  const words = text.split(/\s+/).filter(Boolean);
  for (let n = words.length - 1; n >= 1; n--) {
    const form = `${words.slice(0, n).join(" ").replace(/[\s,;:·–—-]+$/, "")}\u2026`;
    if (fits(form)) return form;
  }
  return `${words[0] ?? ""}\u2026`;
}

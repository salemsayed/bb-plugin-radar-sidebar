import { useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Isolated } from "./Isolated";
import { keepHyphens } from "./displayText";

export function FitLines({ forms, className, dir = "auto", lead, aside }: { forms: readonly string[]; className?: string; dir?: "auto" | "ltr" | "rtl"; lead?: ReactNode; aside?: ReactNode }) {
  const ref = useRef<HTMLSpanElement>(null);
  const key = forms.join("\n");
  const [at, setAt] = useState(0);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => { setAt(0); }, [key, width]);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || at >= forms.length - 1) return;
    if (node.scrollHeight > node.clientHeight + 1) setAt(at + 1);
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
  return <span ref={ref} className={className} dir={dir}>{aside}{lead}<Isolated text={keepHyphens(forms[Math.min(at, forms.length - 1)] ?? "")} /></span>;
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

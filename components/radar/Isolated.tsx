import { Fragment } from "react";

const RTL = "\\u0590-\\u08FF\\uFB1D-\\uFDFF\\uFE70-\\uFEFF";
const RTL_RUN = new RegExp(`[${RTL}]+(?:[\\s\\u200c\\u200f.'-]+[${RTL}]+)*`, "g");
const LATIN = /[A-Za-z]/;

export function Isolated({ text }: { text: string }) {
  if (!LATIN.test(text.replace(RTL_RUN, ""))) return <>{text}</>;
  const parts: (string | { rtl: string })[] = [];
  let last = 0;
  for (const match of text.matchAll(RTL_RUN)) {
    if (match.index! > last) parts.push(text.slice(last, match.index));
    parts.push({ rtl: match[0] });
    last = match.index! + match[0].length;
  }
  if (!parts.length) return <>{text}</>;
  if (last < text.length) parts.push(text.slice(last));
  return <>{parts.map((part, i) => typeof part === "string" ? <Fragment key={i}>{part}</Fragment> : <bdi key={i} dir="rtl">{part.rtl}</bdi>)}</>;
}

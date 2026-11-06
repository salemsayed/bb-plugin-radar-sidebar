import { capitalFirst } from "./workText";

const QUOTED = /(['"‘“])(?:(?!\1).)*?(['"’”])/g;
const TRAIL_WORD = /\s+(?:on|in|at|for|with|from|before|after|to|via|by|until|instead|first|again|so|because|while|unless)\b/gi;
const SOFT_WORD = /\b(?:small|little|quick|short|simple|tiny|new)\s+/gi;
const RECOMMENDED = /\s*\((?:recommended|suggested|default|preferred)\)/gi;
const BRACKETS = /\s*\([^()]*\)/g;
const MIN_WORDS = 2;

function masked(text: string): string {
  return text.replace(QUOTED, quote => "\u0000".repeat(quote.length));
}

function softRanges(hidden: string): [number, number][] {
  return [...hidden.matchAll(SOFT_WORD)].map(match => [match.index!, match.index! + match[0].length]);
}

function lastClause(text: string, hidden: string): string {
  const comma = hidden.lastIndexOf(",");
  return comma < 0 ? text : text.slice(comma + 1);
}

function words(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function lowerLead(text: string): string {
  return /^[A-Z][a-z]/.test(text) && !/^[A-Z][a-z]+(?:\s+[A-Z]|$)/.test(text) && !/^I\b/.test(text) ? text[0]!.toLowerCase() + text.slice(1) : text;
}

function tidy(text: string): string {
  return text.replace(/\s+/g, " ").replace(/[\s,;:\-–—]+$/, "").trim();
}

export function optionCuts(option: string): string[] {
  const cuts: string[] = [];
  const push = (text: string) => { const clean = tidy(text); if (clean && words(clean) >= 1 && !cuts.includes(clean)) cuts.push(clean); };
  push(option);
  let current = tidy(option.replace(RECOMMENDED, ""));
  push(current);
  current = tidy(current.replace(BRACKETS, ""));
  push(current);
  for (let guard = 0; guard < 6; guard++) {
    const hidden = masked(current);
    const ends = [...hidden.matchAll(TRAIL_WORD)].map(match => match.index!).filter(at => words(lastClause(current.slice(0, at), hidden.slice(0, at))) >= MIN_WORDS);
    if (!ends.length) break;
    current = tidy(current.slice(0, ends[ends.length - 1]));
    push(current);
  }
  const softMask = masked(current);
  const soft = tidy(current.split("").filter((_, i) => !softRanges(softMask).some(([from, to]) => i >= from && i < to)).join(""));
  push(soft);
  current = soft || current;
  const hidden = masked(current);
  const comma = hidden.indexOf(",");
  if (comma > 0 && words(current.slice(0, comma)) >= 1) push(current.slice(0, comma));
  return cuts;
}

export interface Choice { options: string[] }

export function splitChoice(question: string, count = 0): Choice | null {
  const head = question.split(" · ")[0]!.trim();
  if (!/\?\s*$/.test(head)) return null;
  const body = head.replace(/\?\s*$/, "");
  const hidden = masked(body).replace(/\([^()]*\)/g, part => "\u0000".repeat(part.length));
  const ors = [...hidden.matchAll(/,?\s+or\s+/gi)];
  if (!ors.length) return null;
  const last = ors[ors.length - 1]!;
  const before = body.slice(0, last.index!);
  const after = body.slice(last.index! + last[0].length);
  if (words(after) < 1 || words(before) < 1) return null;
  const firsts = masked(before).replace(/\([^()]*\)/g, part => "\u0000".repeat(part.length));
  const commas = [...firsts.matchAll(/,\s+/g)].map(match => match.index!);
  const verbish = (text: string) => /^[A-Za-z]/.test(text.trim());
  if (count >= 3 && commas.length >= 1 && ors.length === 1) {
    const parts: string[] = [];
    let from = 0;
    for (const at of commas) { parts.push(before.slice(from, at)); from = at + 2; }
    parts.push(before.slice(from));
    if (parts.every(part => words(part) <= 6 && verbish(part))) return { options: [...parts.map(tidy), tidy(after)] };
  }
  return { options: [tidy(before), tidy(after)] };
}

function joined(options: readonly string[]): string {
  const said = options.map((option, i) => i === 0 ? capitalFirst(option) : lowerLead(option));
  const last = said.pop()!;
  return `${said.join(", ")}, or ${last}?`;
}

export function choiceForms(question: string, title = "", count = 0): string[] {
  const choice = splitChoice(question, count);
  if (!choice) return [];
  const head = question.split(" · ")[0]!.trim();
  const forms: string[] = [head];
  if (choice.options.length === 2) {
    const [first, second] = choice.options.map(optionCuts) as [string[], string[]];
    const pairs: string[] = [];
    for (const a of first) for (const b of second) pairs.push(joined([a, b]));
    pairs.sort((x, y) => y.length - x.length);
    forms.push(...pairs);
  } else {
    const cuts = choice.options.map(optionCuts);
    const longest = joined(choice.options.map((option, i) => cuts[i]![Math.min(1, cuts[i]!.length - 1)] ?? option));
    const shortest = joined(cuts.map(list => list[list.length - 1]!));
    forms.push(longest, shortest);
    const topic = title.trim();
    const heads = cuts.slice(0, 2).map(list => list[list.length - 1]!);
    const more = choice.options.length - 2;
    forms.push(`${topic ? `${topic}: ${lowerLead(heads[0]!)}` : capitalFirst(heads[0]!)}, ${lowerLead(heads[1]!)}, or ${more === 1 ? "1 more" : `${more} more`}?`);
    if (topic) forms.push(`${topic}: ${choice.options.length} choices`);
  }
  return forms.filter((form, i) => form && forms.indexOf(form) === i);
}

export function isChoice(question: string, count = 0): boolean {
  return splitChoice(question, count) !== null;
}

export function shortChoice(question: string, max: number, title = "", count = 0): string {
  const forms = choiceForms(question, title, count);
  return forms.find(form => form.length <= max) ?? forms[forms.length - 1] ?? question;
}

const NEW_CLAUSE = /,\s+(?:and|but|so|then)\s+(?=(?:I|I'll|I'd|I've|we|we'll|then|after that)\b)|[;:]\s+|\s+[\u2013\u2014]\s+|,?\s+(?=(?:because|since|when|while|after|before|until|once|unless|given|so that)\s)/gi;

export function questionCuts(what: string): string[] {
  const head = what.split(" \u00b7 ")[0]!.trim();
  if (!/\?\s*$/.test(head)) return [];
  const body = head.replace(/\?\s*$/, "");
  const hidden = masked(body).replace(/\([^()]*\)/g, part => "\u0000".repeat(part.length));
  const cuts = [...hidden.matchAll(NEW_CLAUSE)].map(match => match.index!).filter(at => words(body.slice(0, at)) >= 3);
  return [...new Set(cuts.reverse().map(at => `${tidy(body.slice(0, at))}?`))];
}

export function askForms(what: string, sizes: readonly number[], fit: (text: string, max: number) => string, title = "", count = 0): string[] {
  const choices = choiceForms(what, title, count);
  if (!choices.length) {
    const forms = [what, ...questionCuts(what), ...sizes.map(size => fit(what, size))];
    return forms.filter((form, i) => form && forms.indexOf(form) === i);
  }
  const forms = [what, ...choices];
  return forms.filter((form, i) => form && forms.indexOf(form) === i);
}

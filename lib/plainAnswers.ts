const VERBS = new Set(("accept add answer apply approve archive ask assign back book bring buy buzz build call cancel change check clean clear close confirm continue create cut deploy disable drop email enable file finish fix fold follow give go hold install keep land leave let make mark merge move notify open order park pause pay ping post proceed prune publish pull push rebase reboot record reject release reload remove rename renew reopen reply reschedule reset restart restore resume retry revert review roll rollback rerun re-run re-arm rearm run schedule send set share ship show skip split start stop switch sync take tell test text try turn unassign undo uninstall update upgrade use verify wait wrap write").split(" "));
const WH = /^(?:who|whom|whose|what|which|when|where|why|how)\b/i;
const WH_END = /\b(?:what|which|who|whom|where|when|how)\s*$/i;
const AUX = /^(?:did|do|does|is|are|was|were|has|have|had|will|would|could|can|shall|should|may|might|must|any|anything)\b/i;
const ASK_ME = /^(?:(?:should|shall|may|can|could)\s+(?:i|we)|(?:do\s+you\s+)?want\s+(?:me|us)\s+to|(?:is\s+it\s+)?(?:ok|okay|fine|good)\s+(?:for\s+(?:me|us)\s+)?to|go\s+ahead\s+and|go\s+to)\s+(?:also\s+)?/i;
const LEAD = /^(?:decision needed|question|quick question|your call|one question)\s*[:—–-]\s*/i;
const TOPIC = /^([^:?]{2,40}):\s+(?=\S)/;
const NEW_CLAUSE = /,\s+(?:and|but|so|then)\s+(?=(?:I|I'll|I'd|I've|we|we'll|then|after that)\b)|[;:]\s+|\s+[–—]\s+|,?\s+(?=(?:because|since|given|so that|as long as)\s)/gi;
const SOFT_CUT = /,?\s+(?=(?:when|while|after|before|until|once|unless|if|for|with|so)\s)/gi;
const YOU = /\b(?:you|your|yours)\b/i;
const YOU_DO = /^(?:can|could|will|would)\s+you\s+(?:please\s+)?/i;
const MAX = 48;
const SHORT = 28;

const tidy = (text: string) => text.replace(/\s+/g, " ").replace(/^[\s"'“‘]+|[\s,;:.!"'”’]+$/g, "").trim();
const hide = (text: string) => text.replace(/\([^()]*\)|"[^"]*"|“[^”]*”|'[^']*'/g, part => "\u0000".repeat(part.length));
const cap = (text: string) => text ? text[0]!.toUpperCase() + text.slice(1) : text;
const lowLead = (text: string) => /^[A-Z][a-z]/.test(text) && !/^I\b/.test(text) ? text[0]!.toLowerCase() + text.slice(1) : text;
const words = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;
const count = (text: string, mark: RegExp) => text.match(mark)?.length ?? 0;
const sound = (option: string) => /^\p{L}/u.test(option) && count(option, /\(/g) === count(option, /\)/g) && count(option, /"/g) % 2 === 0 && count(option, /\u201c/g) === count(option, /\u201d/g);

function lastQuestion(text: string): string {
  const flat = text.replace(/```[\s\S]*?```/g, " ").replace(/\*\*|__|`/g, "").replace(/\s+·\s+/g, ". ").replace(/\s+/g, " ").trim();
  const end = flat.lastIndexOf("?");
  if (end < 0) return "";
  const before = flat.slice(0, end);
  const start = Math.max(...[...before.matchAll(/[.!?]\s+(?=\S)/g)].map(m => m.index! + m[0].length), 0);
  return flat.slice(start, end).trim();
}

function swapPeople(text: string): string {
  const map: Record<string, string> = { your: "my", yours: "mine", you: "me", my: "your", mine: "yours", me: "you" };
  return text.replace(/\b(your|yours|you|my|mine|me)\b/gi, word => map[word.toLowerCase()]!);
}

function clauseHead(text: string): string {
  const at = [...hide(text).matchAll(NEW_CLAUSE)].map(m => m.index!).find(i => words(text.slice(0, i)) >= 2);
  return at === undefined ? text : text.slice(0, at);
}

function softCut(text: string, fits: (head: string) => boolean): string {
  const ends = [...hide(text).matchAll(SOFT_CUT)].map(m => m.index!).filter(i => words(text.slice(0, i)) >= 2 && fits(text.slice(0, i)));
  return ends.length ? tidy(text.slice(0, ends[ends.length - 1])) : "";
}

const RECOMMEND = /\s*\((?:my\s+|our\s+|the\s+)?(?:recommended|recommendation|suggested|suggestion|default|preferred|pick)\)/gi;
const RECOMMENDED = new RegExp(RECOMMEND.source, "i");
const settle = (text: string) => tidy(text).replace(/\s+(?:right\s+)?now$/i, "");

function andHead(text: string, speaker: boolean): string {
  const at = hide(text).search(/,?\s+and\s+/);
  if (at <= 0 || words(text.slice(0, at)) < 2) return "";
  const head = settle(text.slice(0, at));
  return head.length <= MAX && (speaker || !YOU.test(head)) ? head : "";
}

function fitted(text: string, speaker: boolean, clause = false): string {
  const base = settle(clauseHead(text).replace(RECOMMEND, "").replace(/\s+\([^()]*\)/g, ""));
  let out = base;
  if (!speaker && YOU.test(out)) out = softCut(out, head => !YOU.test(head));
  if (out.length > MAX) out = softCut(out, head => head.length <= MAX);
  if (clause && (!out || out.length > MAX)) out = andHead(base, speaker);
  return out.length <= MAX ? out : "";
}

function eitherOr(body: string): string[] | null {
  const hidden = hide(body);
  const ors = [...hidden.matchAll(/,?\s+or\s+/gi)];
  if (!ors.length) return null;
  const last = ors[ors.length - 1]!;
  const after = tidy(body.slice(last.index! + last[0].length)).replace(/\s+(?:for|in|on|with|of)\s+(?:this|that|it|now|them|these|those)$/i, "");
  if (/^(?:not|no|nothing|neither)\b/i.test(after)) return null;
  const asked = ASK_ME.test(body);
  if (ors.length > 1 || AUX.test(after) || /^want\b/i.test(body) || AUX.test(body) && !asked) return [];
  const yes = /^yes,\s+/i.exec(body)?.[0] ?? "";
  const before = tidy(body.slice(yes.length, last.index!).replace(ASK_ME, ""));
  if (/,\s/.test(hide(before))) return [];
  const people = (option: string) => asked ? swapPeople(option) : option;
  const pair = [fitted(people(before), asked, true), fitted(people(after), asked, true)];
  if (pair.some(option => option.length < 3 || !sound(option))) return [];
  const lead = pair[0]!.split(/\s+/)[0]!.toLowerCase();
  const next = pair[1]!.split(/\s+/)[0]!.toLowerCase();
  const subject = /^(?:i|i'll|i'd|i'm|we|we'll|you|you'll|it|it's|let|let's|leave|not|no|keep)\b/i.test(pair[1]!);
  if (VERBS.has(lead) && !VERBS.has(next) && !subject && words(pair[0]!) >= 2 && !new RegExp(`\\b${lead}\\b`, "i").test(pair[1]!)) pair[1] = `${lead} ${pair[1]}`;
  const answers = [yes ? `Yes, ${lowLead(pair[0]!)}` : cap(pair[0]!), cap(pair[1]!)];
  return RECOMMENDED.test(after) && !RECOMMENDED.test(before) && !yes ? [answers[1]!, answers[0]!] : answers;
}

const TAIL = /\s+(?:to|for|on|in|into|onto|from|at|by|with|via|before|after|when|while|until|once|so|as)\s+[\s\S]*$/i;

function firstAction(action: string, speaker: boolean): string {
  return actionParts(action, speaker).yes;
}

function actionParts(action: string, speaker: boolean): { yes: string; no: string } {
  const whole = fitted(lowLead(action), speaker);
  if (whole && words(whole) >= 2 && sound(whole)) return { yes: whole, no: whole };
  const plain = action.replace(/\s*\([^()]*\)/g, "");
  const at = hide(plain).search(/,?\s+and\s+/);
  if (at <= 0) return { yes: "", no: "" };
  const head = fitted(lowLead(plain.slice(0, at)), speaker);
  if (!head || words(head) < 2 || !sound(head)) return { yes: "", no: "" };
  const rest = plain.slice(at).replace(/^,?\s+and\s+/i, "");
  if (!/^(?:i|i'll|i'd|we|we'll|then)\b/i.test(rest)) {
    const second = tidy(rest.replace(TAIL, ""));
    const both = `${head} and ${second}`;
    if (words(second) >= 1 && words(second) <= 4 && !YOU.test(second) && both.length <= MAX && sound(both)) return { yes: both, no: head };
  }
  return { yes: head, no: head };
}

export function plainAnswers(question: string): string[] {
  let body = lastQuestion(question);
  for (let guard = 0; guard < 3; guard++) {
    const lead = LEAD.exec(body) ?? TOPIC.exec(body);
    if (!lead) break;
    body = body.slice(lead[0].length);
  }
  if (!body || WH.test(body) || WH_END.test(body)) return [];
  const choice = eitherOr(body);
  if (choice) return choice.length === 2 && choice[0]!.toLowerCase() !== choice[1]!.toLowerCase() ? choice : [];
  const yours = YOU_DO.exec(body);
  if (yours) {
    const task = swapPeople(body.slice(yours[0].length));
    const full = firstAction(task, true);
    const did = full.length > SHORT ? softCut(full, head => head.length <= SHORT && words(head) >= 2) || full : full;
    const word = task.split(/\s+/)[0]!.toLowerCase();
    if (did && VERBS.has(word)) return [`Yes, I'll ${did}`, `No, I won't ${did}`];
  }
  const asked = ASK_ME.exec(body);
  const first = body.split(/\s+/)[0]!.toLowerCase().replace(/[^a-z-]/g, "");
  const action = asked ? swapPeople(body.slice(asked[0].length)) : VERBS.has(first) ? body : "";
  if (!action) return AUX.test(body) || words(body) >= 2 ? ["Yes", "No"] : [];
  const parts = actionParts(action, !!asked);
  if (!parts.yes) return ["Yes", "No"];
  const short = (text: string) => text.length > SHORT ? softCut(text, head => head.length <= SHORT && words(head) >= 2) || text : text;
  return [`Yes, ${short(parts.yes)}`, `No, don't ${short(parts.no)}`];
}

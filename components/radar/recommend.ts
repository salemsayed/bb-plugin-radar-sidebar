const MARK = /\s*\((?:my recommendation|recommended|suggested|preferred|default|my pick|i recommend(?: this)?)\)/i;
const MARKS = new RegExp(MARK.source, "gi");
const STOP = new Set(["the", "a", "an", "it", "its", "to", "and", "or", "of", "for", "on", "in", "at", "my", "your", "i", "you", "we", "be", "is", "this", "that", "with", "when", "then", "so", "do", "don't", "yes", "no", "not", "now", "only"]);

export function hasMark(text: string): boolean {
  return MARK.test(text);
}

export function withoutMarks(text: string): string {
  return text.replace(MARKS, "").replace(/\s+([,?.])/g, "$1").replace(/\s{2,}/g, " ").trim();
}

function tokens(text: string): string[] {
  return text.toLowerCase().replace(/[^\p{L}\p{N}:']+/gu, " ").split(" ").filter(word => word.length >= 2 && !STOP.has(word));
}

function bestMatch(options: readonly string[], hint: string): string | undefined {
  const wanted = new Set(tokens(hint));
  if (!wanted.size) return undefined;
  const scored = options.map(option => {
    const own = tokens(option);
    const hits = own.filter(word => wanted.has(word)).length;
    return { option, hits, share: own.length ? hits / own.length : 0 };
  }).sort((a, b) => b.hits - a.hits || b.share - a.share);
  const [first, second] = scored;
  if (!first || first.hits === 0) return undefined;
  if (second && second.hits === first.hits && second.share === first.share) return undefined;
  return first.share >= 0.5 || first.hits >= 2 ? first.option : undefined;
}

function markedPart(question: string): string | undefined {
  const head = question.split(" · ")[0]!;
  const parts = head.replace(/\?\s*$/, "").split(/,?\s+or\s+/i);
  return parts.find(part => MARK.test(part));
}

export function recommendedOption(options: readonly string[], question = "", advice = ""): string | undefined {
  if (options.length < 2) return undefined;
  const marked = options.filter(option => MARK.test(option));
  if (marked.length === 1) return marked[0];
  const part = markedPart(question);
  if (part) {
    const plain = options.map(withoutMarks);
    const hit = bestMatch(plain, part);
    return hit === undefined ? undefined : options[plain.indexOf(hit)];
  }
  return advice ? bestMatch(options, advice) : undefined;
}

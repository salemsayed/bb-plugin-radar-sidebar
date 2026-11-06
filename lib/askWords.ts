export interface AskWords { asked?: string; consequence?: string; advice?: string }

const DECISION = /\bdecision needed\s*[:\u2013\u2014-]\s*([^?]{6,300}\?)/i;
const LEAD_TAG = /^(?:decision needed|question|decision)\s*[:\u2013\u2014-]\s*/i;
const IMPACT = [
  /\b(?:takes?|taking|knocks?|puts?|brings?)\b[^.?!]{0,80}\b(?:offline|down)\b/i,
  /\b(?:goes|go|going|will be|would be|stays?)\s+(?:offline|down)\b/i,
  /\b(?:downtime|outage)\b/i,
  /\bcan(?:no|')t be undone\b|\birreversible\b|\bpermanently (?:delete|remove|erase)/i,
  /\b(?:costs?|charges?|will charge|bills?)\b[^.?!]{0,40}(?:EGP|USD|\$|\u20ac|\u00a3)\s?\d/i,
];
const ADVICE = /\b(?:I(?:'d| would)? recommend|I suggest|my recommendation(?: is)?|recommended)\s*:?\s+([^.;\n]{2,120})/i;

function proseLines(text: string): string[] {
  return text.replace(/```[\s\S]*?```/g, "\n").split(/\r?\n/)
    .map(line => line.replace(/^[\s#>*\-\u2022]+/, "").replace(/\*\*|__|`/g, "").trim())
    .filter(line => line && !/^::[a-z]/i.test(line) && !/^\u21a9/.test(line));
}

function proseSentences(lines: readonly string[]): string[] {
  return lines.flatMap(line => line.split(/(?<=[.!?])\s+(?=[A-Z\u201c"(])/)).map(part => part.trim()).filter(Boolean);
}

export function askWords(text: string): AskWords {
  const lines = proseLines(text);
  const decided = lines.map(line => DECISION.exec(line)?.[1]?.trim()).find(Boolean);
  const sentences = proseSentences(lines);
  const asked = (decided ?? sentences.filter(sentence => /\?$/.test(sentence) && sentence.length >= 12).at(-1))?.replace(LEAD_TAG, "");
  const consequence = sentences.find(sentence => sentence !== asked && !/\?$/.test(sentence) && sentence.length <= 220 && IMPACT.some(pattern => pattern.test(sentence)))?.replace(/^[^:]{3,40}:\s+(?=[A-Z])/, "");
  const advice = ADVICE.exec(lines.join(" "))?.[1]?.trim();
  return {
    ...(asked ? { asked: asked[0]!.toUpperCase() + asked.slice(1) } : {}),
    ...(consequence ? { consequence } : {}),
    ...(advice ? { advice } : {}),
  };
}

import { Isolated } from "./Isolated";

export function AnswerLabel({ label, recommended }: { label: string; recommended?: boolean }) {
  if (!recommended) return <Isolated text={label} />;
  return <span className="radar-answer-text"><Isolated text={label} /><span className="radar-answer-rec">{"\u00a0\u00b7 recommended"}</span></span>;
}

export function answerName(label: string, recommended?: boolean): string {
  return recommended ? `“${label}” (recommended)` : `“${label}”`;
}

export function AskImpact({ text, className }: { text?: string; className: string }) {
  if (!text) return null;
  return <span className={className} dir="auto"><Isolated text={text} /></span>;
}

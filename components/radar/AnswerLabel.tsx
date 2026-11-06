import { Isolated } from "./Isolated";

export function AnswerLabel({ label, recommended }: { label: string; recommended?: boolean }) {
  return <>
    <Isolated text={label} />
    {recommended ? <span className="radar-answer-rec"> · recommended</span> : null}
  </>;
}

export function answerName(label: string, recommended?: boolean): string {
  return recommended ? `“${label}” (recommended)` : `“${label}”`;
}

export function AskImpact({ text, className }: { text?: string; className: string }) {
  if (!text) return null;
  return <span className={className} dir="auto"><Isolated text={text} /></span>;
}

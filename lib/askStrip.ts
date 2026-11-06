export interface AskStripEntry {
  key: string;
  threadId: string;
  messageSeq?: number;
  question: string;
  title?: string;
  options: string[];
  botName: string;
  askedAt?: number;
}

let current: AskStripEntry | null = null;
const listeners = new Set<() => void>();

function changed() {
  for (const listener of listeners) listener();
}

export function armAskStrip(entry: AskStripEntry): void {
  current = entry;
  changed();
}

export function clearAskStrip(key?: string): void {
  if (!current || key !== undefined && current.key !== key) return;
  current = null;
  changed();
}

export function currentAskStrip(): AskStripEntry | null {
  return current;
}

export function subscribeAskStrip(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function askStripTop(): number | null {
  const node = document.querySelector<HTMLElement>(".radar-ask-strip");
  if (!node) return null;
  const box = node.getBoundingClientRect();
  return box.height > 0 ? box.top : null;
}

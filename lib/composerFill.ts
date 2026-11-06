const KEEP_MS = 15_000;

export type FillRequest = { threadId: string; text: string; at: number };

let pending: FillRequest | null = null;
const listeners = new Set<() => void>();

export function requestFill(threadId: string, text: string): void {
  pending = { threadId, text, at: Date.now() };
  for (const listener of listeners) listener();
}

export function pendingFill(): FillRequest | null {
  if (pending && Date.now() - pending.at > KEEP_MS) pending = null;
  return pending;
}

export function clearFill(request: FillRequest): void {
  if (pending === request) pending = null;
  for (const listener of listeners) listener();
}

export function subscribeFill(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

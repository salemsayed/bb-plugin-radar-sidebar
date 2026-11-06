export function coarsePointer(): boolean {
  return typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
}

export function answerHint(): string {
  return coarsePointer() ? "Tap an answer to send it" : "Click an answer to send it";
}

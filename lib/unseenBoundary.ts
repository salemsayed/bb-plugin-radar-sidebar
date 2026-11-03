export type MessageRow = { kind: string; messageSeq?: number; children?: readonly MessageRow[] | null };
export type UnseenBoundary = { firstSeq: number; count: number };
export function unseenBoundary(point: number | null, rows: readonly MessageRow[]): UnseenBoundary | null {
  if (point === null) return null;
  const sequences = new Set<number>();
  const visit = (rows: readonly MessageRow[]) => {
    for (const row of rows) {
      if (row.kind === "conversation" && row.messageSeq !== undefined && row.messageSeq > point) sequences.add(row.messageSeq);
      if (row.children) visit(row.children);
    }
  };
  visit(rows);
  return sequences.size ? { firstSeq: Math.min(...sequences), count: sequences.size } : null;
}

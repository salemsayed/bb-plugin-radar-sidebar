export const ROW = "[data-timeline-row-id]";
const ROWS = `${ROW}, [data-notification-thread]`;
const USER_SEED = /^[^:]+:user-seed:(\d+)(?:-\d+)?$/;
const FIBER_DEPTH = 6;

type RowData = { id?: unknown; threadId?: unknown; kind?: unknown; messageSeq?: unknown };
type Fiber = { memoizedProps?: { row?: RowData } | null; return?: Fiber | null };
type Expando = Record<string, unknown>;
type RowInfo = { thread: string | null; seq: number };

let propsKey: string | null = null;
let fiberKey: string | null = null;

function reactKey(el: HTMLElement, known: string | null, prefix: string) {
  if (known && known in el) return known;
  return Object.keys(el).find(name => name.startsWith(prefix)) ?? null;
}

function rowData(el: HTMLElement, id: string): RowData | null {
  try {
    propsKey = reactKey(el, propsKey, "__reactProps$");
    const props = propsKey ? (el as unknown as Expando)[propsKey] as { children?: unknown } | undefined : undefined;
    for (const child of [props?.children].flat()) {
      const row = (child as { props?: { row?: RowData } } | null)?.props?.row;
      if (row && row.id === id) return row;
    }
    fiberKey = reactKey(el, fiberKey, "__reactFiber$");
    let fiber = fiberKey ? (el as unknown as Expando)[fiberKey] as Fiber | undefined ?? null : null;
    for (let depth = 0; fiber && depth < FIBER_DEPTH; fiber = fiber.return ?? null, depth++) {
      const row = fiber.memoizedProps?.row;
      if (row && row.id === id) return row;
    }
  } catch {}
  return null;
}

const positive = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : 0;

function read(el: HTMLElement): RowInfo {
  const id = el.dataset.timelineRowId;
  const row = id ? rowData(el, id) : null;
  if (row) return { thread: typeof row.threadId === "string" ? row.threadId : null, seq: row.kind === "conversation" ? positive(row.messageSeq) : 0 };
  if (el.dataset.notificationThread !== undefined) return { thread: el.dataset.notificationThread || null, seq: positive(Number(el.dataset.notificationMessage)) };
  if (!id || id.includes(":child:")) return { thread: null, seq: 0 };
  return { thread: id.split(":")[0] || null, seq: positive(Number(USER_SEED.exec(id)?.[1])) };
}

export function rowThread(el: HTMLElement) {
  return read(el).thread;
}

export function rowSeq(el: HTMLElement) {
  return read(el).seq;
}

function isMessage(info: RowInfo, threadId?: string) {
  return info.seq > 0 && (threadId === undefined || info.thread === threadId);
}

export function messageRows(threadId?: string, root: ParentNode = document) {
  return Array.from(root.querySelectorAll<HTMLElement>(ROWS)).filter(el => isMessage(read(el), threadId));
}

export function messageRowsWithSeq(seq: number) {
  return Array.from(document.querySelectorAll<HTMLElement>(ROWS)).filter(el => read(el).seq === seq);
}

export function closestMessageRow(node: Element, threadId?: string) {
  for (let el = node.closest<HTMLElement>(ROWS); el; el = el.parentElement?.closest<HTMLElement>(ROWS) ?? null) {
    const info = read(el);
    if (info.seq > 0) return isMessage(info, threadId) ? el : null;
  }
  return null;
}

export function firstMessageRow(root: ParentNode) {
  for (const el of root.querySelectorAll<HTMLElement>(ROWS)) if (read(el).seq > 0) return el;
  return null;
}

export function threadOfRows(root: ParentNode) {
  const first = root.querySelector<HTMLElement>(ROWS);
  return first ? read(first).thread : null;
}

export function threadRows(threadId: string) {
  const id = CSS.escape(threadId);
  return `[data-notification-thread="${id}"], [data-timeline-row-id^="${id}:"]`;
}
